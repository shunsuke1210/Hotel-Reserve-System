// 前後の客の間の清掃時間の判定（design.md P-11 の TURNOVER_GAP、要件 10.11・10.12、brief.md FC-03・CT-09）。
//
// 同じ部屋の同じ日に、前の客のチェックアウト時刻（既定 12:00、レイトならその時刻）から次の客のチェックイン時刻
// （既定 15:00、アーリーならその時刻）までの空きが2時間未満なら、清掃時間の不足（お知らせ）とする。ちょうど2時間は
// 不足ではない。時刻が逆転（チェックアウトがチェックインより後）しても不足とする。
//
// domain の純粋な関数：データベースと時計を使わない。部屋の夜の客（room_nights）の読み込みとお知らせの作成は
// modules/notices の NoticeService が行う。
//   - 前の客：判定する日の前日の夜にその部屋に泊まる客。次の客：判定する日の夜にその部屋に泊まる客
//   - 同じ滞在（予約の部屋）が両方の夜に泊まるなら、入れ替わりがないので判定しない
//   - レイトは前の客の予約の出発日、アーリーは次の客の予約の到着日だけに当てる（途中で部屋を移った客は既定の時刻）
//
// 時刻は、その日の 0:00 からの分（整数）で表す。この仕組みの時刻は時単位（レイト 13〜15時・アーリー 12〜14時）だが、
// 2時間の境目（1時間59分は不足）を分で確かめられるようにしている。
import {
  EARLY_CHECKIN_HOURS,
  LATE_CHECKOUT_HOURS,
  type EarlyCheckinHour,
  type LateCheckoutHour,
} from '@hotel/contracts';
import { addDays, CHECK_IN_HOUR, CHECK_OUT_HOUR, parseDate } from '../calendar/business-date.js';

/** 前の客のチェックアウトから次の客のチェックインまでに必要な空き（2時間。要件 10.11・10.12） */
export const MIN_TURNOVER_MINUTES = 120;

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** 前の客のチェックアウト時刻 */
export interface CheckoutTime {
  /** 0:00 からの分 */
  readonly minutes: number;
  /** レイトチェックアウトの時刻か（false は既定の 12:00） */
  readonly late: boolean;
}

/** 次の客のチェックイン時刻 */
export interface CheckinTime {
  /** 0:00 からの分 */
  readonly minutes: number;
  /** アーリーチェックインの時刻か（false は既定の 15:00） */
  readonly early: boolean;
}

/** 空きの判定 */
export interface TurnoverGapEvaluation {
  /** チェックインの時刻 − チェックアウトの時刻（分。逆転していれば負） */
  readonly gapMinutes: number;
  /** 2時間未満（清掃時間の不足）か */
  readonly insufficient: boolean;
}

const LATE_HOURS: ReadonlySet<number> = new Set(LATE_CHECKOUT_HOURS);
const EARLY_HOURS: ReadonlySet<number> = new Set(EARLY_CHECKIN_HOURS);

/** 前の客のチェックアウト時刻（レイトがなければ 12:00）。範囲の外の時刻は RangeError */
export function checkoutTimeOf(
  lateCheckoutHour: LateCheckoutHour | null | undefined,
): CheckoutTime {
  if (lateCheckoutHour === null || lateCheckoutHour === undefined) {
    return { minutes: CHECK_OUT_HOUR * MINUTES_PER_HOUR, late: false };
  }
  if (!LATE_HOURS.has(lateCheckoutHour)) {
    throw new RangeError(
      `レイトチェックアウトの時刻は ${LATE_CHECKOUT_HOURS.join('・')} 時のどれかです: ${String(lateCheckoutHour)}`,
    );
  }
  return { minutes: lateCheckoutHour * MINUTES_PER_HOUR, late: true };
}

/** 次の客のチェックイン時刻（アーリーがなければ 15:00）。範囲の外の時刻は RangeError */
export function checkinTimeOf(earlyCheckinHour: EarlyCheckinHour | null | undefined): CheckinTime {
  if (earlyCheckinHour === null || earlyCheckinHour === undefined) {
    return { minutes: CHECK_IN_HOUR * MINUTES_PER_HOUR, early: false };
  }
  if (!EARLY_HOURS.has(earlyCheckinHour)) {
    throw new RangeError(
      `アーリーチェックインの時刻は ${EARLY_CHECKIN_HOURS.join('・')} 時のどれかです: ${String(earlyCheckinHour)}`,
    );
  }
  return { minutes: earlyCheckinHour * MINUTES_PER_HOUR, early: true };
}

/**
 * チェックアウトからチェックインまでの空きが2時間未満かを判定する（ちょうど2時間は不足ではない。要件 10.12）。
 * @param checkoutMinutes 前の客のチェックアウト時刻（0:00 からの分）
 * @param checkinMinutes 次の客のチェックイン時刻（0:00 からの分）
 */
export function evaluateTurnoverGap(
  checkoutMinutes: number,
  checkinMinutes: number,
): TurnoverGapEvaluation {
  assertMinutesOfDay(checkoutMinutes, 'チェックアウト');
  assertMinutesOfDay(checkinMinutes, 'チェックイン');
  const gapMinutes = checkinMinutes - checkoutMinutes;
  return { gapMinutes, insufficient: gapMinutes < MIN_TURNOVER_MINUTES };
}

function assertMinutesOfDay(minutes: number, label: string): void {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MINUTES_PER_DAY) {
    throw new RangeError(`${label}の時刻は 0:00〜24:00 の分の整数で指定してください: ${minutes}`);
  }
}

/** 部屋のある夜に泊まる客（その夜の room_nights の行が属する予約の部屋） */
export interface NightOccupant {
  /** 滞在の識別子（予約の部屋の ID）。前の夜と同じなら、同じ客の連泊の続き */
  readonly stayId: string;
  /** 予約の到着日（YYYY-MM-DD） */
  readonly arrivalDate: string;
  /** 予約の出発日（YYYY-MM-DD） */
  readonly departureDate: string;
  readonly earlyCheckinHour: EarlyCheckinHour | null;
  readonly lateCheckoutHour: LateCheckoutHour | null;
}

/** 同じ部屋の同じ日の判定 */
export type TurnoverJudgement =
  | {
      /** 前の客と次の客の入れ替わりがない */
      readonly turnover: false;
      readonly reason: 'NO_PREVIOUS_GUEST' | 'NO_NEXT_GUEST' | 'SAME_STAY';
    }
  | {
      readonly turnover: true;
      readonly checkout: CheckoutTime;
      readonly checkin: CheckinTime;
      readonly gapMinutes: number;
      /** 2時間未満（お知らせを作る）か */
      readonly insufficient: boolean;
    };

/**
 * 部屋の date の日に、前の客（date の前日の夜の客）から次の客（date の夜の客）への入れ替わりがあれば、
 * 清掃時間が2時間未満かを判定する（要件 10.11・10.12）。
 * @param date 判定する日（YYYY-MM-DD。前の客のチェックアウトと次の客のチェックインの日）
 * @param previous date の前日の夜にその部屋に泊まる客（いなければ undefined）
 * @param next date の夜にその部屋に泊まる客（いなければ undefined）
 */
export function judgeTurnover(
  date: string,
  previous: NightOccupant | undefined,
  next: NightOccupant | undefined,
): TurnoverJudgement {
  parseDate(date);
  if (previous === undefined) return { turnover: false, reason: 'NO_PREVIOUS_GUEST' };
  if (next === undefined) return { turnover: false, reason: 'NO_NEXT_GUEST' };
  if (previous.stayId === next.stayId) return { turnover: false, reason: 'SAME_STAY' };

  const checkout = checkoutTimeOf(
    previous.departureDate === date ? previous.lateCheckoutHour : null,
  );
  const checkin = checkinTimeOf(next.arrivalDate === date ? next.earlyCheckinHour : null);
  const { gapMinutes, insufficient } = evaluateTurnoverGap(checkout.minutes, checkin.minutes);
  return { turnover: true, checkout, checkin, gapMinutes, insufficient };
}

/** 部屋に泊まる1つの夜 */
export interface OccupiedNight {
  /** 滞在の識別子（予約の部屋の ID） */
  readonly stayId: string;
  readonly roomId: string;
  /** 宿泊日（YYYY-MM-DD） */
  readonly stayDate: string;
}

/** 判定する部屋と日付 */
export interface TurnoverPoint {
  readonly roomId: string;
  /** YYYY-MM-DD */
  readonly date: string;
}

/** 夜の切れ目 */
export interface TurnoverPoints {
  /** その部屋に泊まり始める日（前の客との入れ替わり。アーリーチェックインに関係する） */
  readonly arrivals: TurnoverPoint[];
  /** その部屋を出る日（最後の夜の翌日。次の客との入れ替わり。レイトチェックアウトに関係する） */
  readonly departures: TurnoverPoint[];
}

/**
 * 滞在の夜から、清掃時間を判定する部屋・日付（夜の切れ目）を求める。滞在×部屋ごとに、続いた夜のまとまりの
 * 最初の夜の日（到着の切れ目）と、最後の夜の翌日（出発の切れ目）。同じ部屋・日付は1つにまとめ、部屋・日付の順に並べる。
 */
export function turnoverPointsOf(nights: readonly OccupiedNight[]): TurnoverPoints {
  const datesByStayRoom = new Map<string, { roomId: string; dates: Set<string> }>();
  for (const night of nights) {
    parseDate(night.stayDate);
    const key = JSON.stringify([night.stayId, night.roomId]);
    const group = datesByStayRoom.get(key) ?? { roomId: night.roomId, dates: new Set<string>() };
    group.dates.add(night.stayDate);
    datesByStayRoom.set(key, group);
  }

  const arrivals = new Map<string, TurnoverPoint>();
  const departures = new Map<string, TurnoverPoint>();
  const add = (points: Map<string, TurnoverPoint>, roomId: string, date: string): void => {
    points.set(JSON.stringify([roomId, date]), { roomId, date });
  };
  for (const { roomId, dates } of datesByStayRoom.values()) {
    for (const date of dates) {
      if (!dates.has(addDays(date, -1))) add(arrivals, roomId, date);
      const nextDate = addDays(date, 1);
      if (!dates.has(nextDate)) add(departures, roomId, nextDate);
    }
  }
  return { arrivals: sortPoints(arrivals.values()), departures: sortPoints(departures.values()) };
}

function sortPoints(points: Iterable<TurnoverPoint>): TurnoverPoint[] {
  return [...points].sort((a, b) => compareText(a.roomId, b.roomId) || compareText(a.date, b.date));
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
