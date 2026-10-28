// 団体の判定（GroupEvaluator。design.md Components and Interfaces、処理仕様 P-08、設計の補足 DT-M32・L-41、
// brief.md PY-14・PY-14a・PY-14b）。
//
// 確定・変更する予約と、同じ会員のほかの予約から、その予約の最大室数（max_room_count）と is_group、
// 合算によって団体にするほかの予約を決める。入力だけから結果が決まる純粋な関数で、データベースと現在時刻を使わない。
// 確定・変更のたびに呼び、確保の時点では呼ばない（P-04 手順5、P-05、L-41）。同じ会員の予約を集めること（別の会員の
// 予約は渡さない。PY-14b）、行のロック、is_group・max_room_count の保存は呼び出し側（5.x・6.x のサービス）が行う。
// is_group を false に戻す結果は返さない（一度 true になったら戻さない。8.7）。
import { RESERVATION_STATUSES, type ReservationStatus } from '@hotel/contracts';
import { parseDate } from '../calendar/business-date.js';

/** 団体になる室数（1つの予約の最大室数、または同じ会員の予約の夜ごとの合計。8.7・8.8、brief.md PY-14） */
export const GROUP_MIN_ROOM_COUNT = 5;

/**
 * 同じ会員の合算の対象とする予約の状態（確定済み・滞在中・チェックアウト済み・ノーショー。8.8、DT-M32）。
 * 決済待ち・キャンセル済み・期限切れは含めない（決済待ちの予約は確定した時点で判定する）
 */
export const GROUP_AGGREGATED_STATUSES: readonly ReservationStatus[] = [
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'NO_SHOW',
];

/** 夜ごとの合算に使う、予約の宿泊する夜と室数 */
export interface GroupStay {
  /** 宿泊する夜（YYYY-MM-DD。出発日は含まない。context.md「夜」） */
  nights: readonly string[];
  /** 今の室数（取り消していない部屋の数。1以上） */
  roomCount: number;
}

/** 確定・変更する予約（変更した後の夜と室数、変更の前の max_room_count と is_group） */
export interface GroupTarget extends GroupStay {
  id: string;
  /** 変更の前の max_room_count（確保の時点は0。L-41） */
  maxRoomCount: number;
  /** 変更の前の is_group */
  isGroup: boolean;
}

/** 同じ会員のほかの予約（対象の予約を除く。状態を問わず渡してよく、合算の対象はここで選ぶ） */
export interface MemberReservation extends GroupStay {
  id: string;
  status: ReservationStatus;
  isGroup: boolean;
}

export interface GroupEvaluation {
  /** 対象の予約の新しい max_room_count（変更の前の値と今の室数の大きいほう。8.7） */
  maxRoomCount: number;
  /** 対象の予約の新しい is_group（変更の前に true なら true のまま） */
  isGroup: boolean;
  /** 対象の予約の夜ごとの、対象と夜が重なる合算の対象の予約の室数の合計の最大（8.8） */
  peakNightlyRoomCount: number;
  /**
   * is_group を true に変えるほかの予約の ID（入力の順）。夜ごとの合計の最大が5以上のときの、対象の予約と夜が1泊でも
   * 重なる合算の対象の予約のうち、今 is_group が false のもの（8.8、P-08）
   */
  othersToMarkAsGroup: string[];
}

export interface GroupEvaluator {
  /**
   * 同じ会員の、夜が重なる予約の室数を夜ごとに合算し、最大が5室以上かを判定する（design.md の形）。
   * others は合算の対象の予約（状態は呼び出し側で選んだもの）で、対象の夜と重ならない予約は足さない
   */
  isGroup(target: GroupStay, others: readonly GroupStay[]): boolean;
  /** 確定・変更した予約の max_room_count・is_group と、合算で団体にするほかの予約を決める（P-08） */
  evaluate(target: GroupTarget, others: readonly MemberReservation[]): GroupEvaluation;
}

const AGGREGATED_STATUSES: ReadonlySet<string> = new Set(GROUP_AGGREGATED_STATUSES);
const KNOWN_STATUSES: ReadonlySet<string> = new Set(RESERVATION_STATUSES);

/**
 * 対象の予約の夜ごとに、対象の室数と、その夜に泊まるほかの予約の室数を足した合計の最大（8.8）。
 * 対象の夜だけを数える（各予約の夜は連続し、室数は夜によらないので、対象と重なる予約の合計が最も大きい夜は
 * 必ず対象の夜のどれかになる）。夜・室数の誤りは RangeError
 */
export function peakNightlyRoomCount(target: GroupStay, others: readonly GroupStay[]): number {
  const targetNights = validatedNights(target, '対象の予約');
  validateRoomCount(target.roomCount, '対象の予約');
  const roomsByNight = new Map<string, number>(
    [...targetNights].map((night) => [night, target.roomCount]),
  );
  for (const [index, stay] of others.entries()) {
    const label = `ほかの予約（${index + 1}件目）`;
    const nights = validatedNights(stay, label);
    validateRoomCount(stay.roomCount, label);
    for (const night of nights) {
      const rooms = roomsByNight.get(night);
      if (rooms !== undefined) roomsByNight.set(night, rooms + stay.roomCount);
    }
  }
  return Math.max(...roomsByNight.values());
}

/** 夜ごとの合計の最大が5室以上か（design.md GroupEvaluator.isGroup。8.8） */
export function isGroupByNightlySum(target: GroupStay, others: readonly GroupStay[]): boolean {
  return peakNightlyRoomCount(target, others) >= GROUP_MIN_ROOM_COUNT;
}

/**
 * 確定・変更した予約の団体の判定（P-08）。
 * - max_room_count ＝ 変更の前の max_room_count と今の室数の大きいほう（確保の時点の0から、確定で室数になる。L-41）。
 *   5以上なら団体（8.7、PY-14）
 * - 同じ会員のほかの予約のうち、合算の対象の状態（DT-M32）で、対象の予約と夜が1泊でも重なる予約を集め、対象の夜ごとに
 *   室数を足す。最大が5以上なら、対象と集めた予約すべてを団体にする（8.8、PY-14a）
 * - 変更の前に is_group が true の予約（対象・ほかの予約とも）は true のまま（8.7）
 *
 * 夜がない・日付の誤り・同じ夜の重複・1以上の整数でない室数・0以上の整数でない max_room_count・対象の予約自身や
 * 同じ予約の重複・予約の状態でない値は RangeError（呼び出し側の誤り）。
 */
export function evaluateGroup(
  target: GroupTarget,
  others: readonly MemberReservation[],
): GroupEvaluation {
  if (!Number.isInteger(target.maxRoomCount) || target.maxRoomCount < 0) {
    throw new RangeError(
      `max_room_count は0以上の整数で指定してください: ${String(target.maxRoomCount)}`,
    );
  }
  validateOtherReservations(target, others);

  const targetNights = validatedNights(target, '対象の予約');
  const aggregated = others.filter(
    (reservation) =>
      AGGREGATED_STATUSES.has(reservation.status) &&
      reservation.nights.some((night) => targetNights.has(night)),
  );
  const peak = peakNightlyRoomCount(target, aggregated);
  const groupBySum = peak >= GROUP_MIN_ROOM_COUNT;
  const maxRoomCount = Math.max(target.maxRoomCount, target.roomCount);

  return {
    maxRoomCount,
    isGroup: target.isGroup || maxRoomCount >= GROUP_MIN_ROOM_COUNT || groupBySum,
    peakNightlyRoomCount: peak,
    othersToMarkAsGroup: groupBySum
      ? aggregated.filter((reservation) => !reservation.isGroup).map(({ id }) => id)
      : [],
  };
}

export const groupEvaluator: GroupEvaluator = {
  isGroup: isGroupByNightlySum,
  evaluate: evaluateGroup,
};

/** ほかの予約の ID・状態・夜・室数を確かめる（合算の対象でない予約も、入力の誤りは見逃さない） */
function validateOtherReservations(
  target: GroupTarget,
  others: readonly MemberReservation[],
): void {
  const ids = new Set<string>([target.id]);
  for (const [index, reservation] of others.entries()) {
    const label = `ほかの予約（${index + 1}件目）`;
    if (ids.has(reservation.id)) {
      throw new RangeError(`${label}が対象の予約か、ほかの予約と重複しています: ${reservation.id}`);
    }
    ids.add(reservation.id);
    if (!KNOWN_STATUSES.has(reservation.status)) {
      throw new RangeError(
        `${label}の状態が予約の状態ではありません: ${String(reservation.status)}`,
      );
    }
    validatedNights(reservation, label);
    validateRoomCount(reservation.roomCount, label);
  }
}

/** 宿泊する夜を確かめて集合にする（1泊以上・YYYY-MM-DD の存在する日付・重複なし） */
function validatedNights(stay: GroupStay, label: string): ReadonlySet<string> {
  if (stay.nights.length === 0) throw new RangeError(`${label}に宿泊する夜がありません`);
  for (const night of stay.nights) parseDate(night);
  const nights = new Set(stay.nights);
  if (nights.size !== stay.nights.length) {
    throw new RangeError(`${label}の宿泊する夜が重複しています`);
  }
  return nights;
}

function validateRoomCount(roomCount: number, label: string): void {
  if (!Number.isInteger(roomCount) || roomCount < 1) {
    throw new RangeError(`${label}の室数は1以上の整数で指定してください: ${String(roomCount)}`);
  }
}
