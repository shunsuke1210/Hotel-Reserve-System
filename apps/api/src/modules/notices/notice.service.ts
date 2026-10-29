// お知らせ（design.md Components の NoticeService、処理仕様 P-11、Data Models notices。要件 10.8〜10.15）。
//
// お知らせは、フロントが対応して「解決」するまで残る記録（ADR-14。状態から自動では消えない。TC-OP-104・123）。
// 種類と、作る処理・重複のまとめのキー（dedupe_key）：
//   FRAGMENTED_INVENTORY  連泊できない在庫なし（空室検索・確保。5.2）       FRAG:{客室タイプの ID}:{到着日}:{出発日}
//   SPLIT_FLOORS          離れた部屋（確定・変更・移動・入れ替え。5.3・6.2・7.3） SPLIT:{予約の ID}
//   TURNOVER_GAP          清掃時間の不足（予約・変更・時間外・移動・入れ替え）   GAP:{部屋の ID}:{日付}
// 同じキーの解決していないお知らせがあれば作らない（10.9）。解決した後は同じキーで新しく作る（部分一意インデックス）。
//
// 作る処理は、業務の操作のトランザクションの中から呼ぶ（操作が取り消されれば、お知らせも残らない）：
//
//   await runInTransaction(this.prisma, async (tx) => {
//     … 予約を確定する（room_nights を BOOKED、予約を CONFIRMED に）…
//     await this.notices.checkTurnoverGapsForReservation(tx, reservationId);   // 清掃時間の判定（10.11）
//     if (selection.splitAcrossFloors && !selection.structurallyImpossible) {
//       await this.notices.recordSplitFloors(tx, reservationId);              // 離れた部屋（9.4・10.10）
//     }
//     await this.audit.record(tx, staffActor(staff), { action: 'RESERVATION_CREATE', … });
//   });
//
// - 重複は INSERT … ON CONFLICT DO NOTHING で避ける（同時に作っても未解決は1件。一意制約の違反でトランザクションが
//   中断されないので、呼び出し側の操作はそのまま続けて確定できる）
// - お知らせを作ることは、それを作った操作の一部。操作履歴は操作の1行（L-42）だけで、ここでは記録しない
// - 解決（resolve。POST /notices/{id}/resolve：7.6）は、それだけで1つの操作なので、自分のトランザクションで
//   resolved_at・resolved_by と操作履歴（NOTICE_RESOLVE）を記録する
// - 清掃時間の判定は、部屋の夜（room_nights）の前の客・次の客を読み、時刻の判定は domain/turnover の純粋な関数で行う。
//   判定の処理は変更の後に呼ぶ（同じトランザクションの中の変更を読んで判定する）
// - メッセージはスタッフ向けの日本語で、宿泊客の氏名などの個人情報を入れない（notice-messages.ts）
import {
  NOTICE_KINDS,
  type EarlyCheckinHour,
  type LateCheckoutHour,
  type NoticeKind,
  type ReservationStatus,
} from '@hotel/contracts';
import { Injectable } from '@nestjs/common';
import { addDays, parseDate } from '../../domain/calendar/business-date.js';
import {
  judgeTurnover,
  turnoverPointsOf,
  type NightOccupant,
  type TurnoverJudgement,
  type TurnoverPoint,
} from '../../domain/turnover/turnover-gap.js';
import type { AuditActor } from '../../shared/audit/audit-entry.js';
import { AuditLogService } from '../../shared/audit/audit-log.service.js';
import { BusinessClock } from '../../shared/clock/business-clock.js';
import { BusinessError } from '../../shared/errors/business-error.js';
import type { Prisma } from '../../shared/prisma/generated/client.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { runInTransaction, type TransactionClient } from '../../shared/prisma/transaction.js';
import {
  fragmentedInventoryMessage,
  splitFloorsMessage,
  turnoverGapMessage,
} from './notice-messages.js';

/**
 * お知らせを読み書きする接続。業務の操作のトランザクションの tx を渡す（トランザクションを使わない処理、
 * たとえば空室検索は PrismaService を渡してもよい）
 */
export type NoticeDb = TransactionClient;

/** 重複のまとめのキー（design.md P-11） */
export const NOTICE_DEDUPE_KEYS = {
  fragmentedInventory: (roomTypeId: string, arrivalDate: string, departureDate: string): string =>
    `FRAG:${roomTypeId}:${arrivalDate}:${departureDate}`,
  splitFloors: (reservationId: string): string => `SPLIT:${reservationId}`,
  turnoverGap: (roomId: string, date: string): string => `GAP:${roomId}:${date}`,
} as const;

/**
 * 清掃時間の判定で、部屋に泊まる客として数える予約の状態（BOOKED の夜を持つもの）。決済待ち（HOLD の夜。確定の時点で
 * 判定する）・ノーショー（客が来ていない）・取り消し・期限切れ（夜を解放済み）は数えない
 */
export const TURNOVER_GUEST_STATUSES = [
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
] as const satisfies readonly ReservationStatus[];

/** 作るお知らせ */
export interface NoticeDraft {
  kind: NoticeKind;
  dedupeKey: string;
  /** F03 のダイアログに出す本文（日本語。個人情報を入れない） */
  message: string;
  roomTypeId?: string | null;
  roomId?: string | null;
  reservationId?: string | null;
  /** 対象の期間（YYYY-MM-DD）。日程は到着日〜出発日、清掃時間は判定した日（同じ日） */
  dateFrom: string;
  dateTo: string;
}

/** 保存したお知らせ */
export interface NoticeRecord {
  id: string;
  kind: NoticeKind;
  dedupeKey: string;
  message: string;
  roomTypeId: string | null;
  roomId: string | null;
  reservationId: string | null;
  dateFrom: string;
  dateTo: string;
  createdAt: Date;
  resolvedAt: Date | null;
  /** 解決したスタッフの ID */
  resolvedBy: string | null;
}

export interface RecordNoticeResult {
  /** 新しく作ったか（false：同じキーの未解決のお知らせがすでにあったので作らなかった。10.9） */
  created: boolean;
  /** 作ったお知らせ、またはすでにあった未解決のお知らせ */
  notice: NoticeRecord;
}

/** 未解決のお知らせの一覧の1件（F03：種類・対象・作成日時・メッセージ） */
export interface OpenNotice {
  id: string;
  kind: NoticeKind;
  message: string;
  roomTypeId: string | null;
  /** 対象の客室タイプの名称（連泊できない在庫なし・離れた部屋） */
  roomTypeName: string | null;
  roomId: string | null;
  /** 対象の部屋番号（清掃時間の不足） */
  roomNumber: number | null;
  reservationId: string | null;
  /** 対象の予約番号（離れた部屋） */
  reservationNumber: string | null;
  dateFrom: string;
  dateTo: string;
  createdAt: Date;
}

export interface ResolveNoticeResult {
  /** 今回解決したか（false：すでに解決済みだったので何も変えなかった） */
  changed: boolean;
  notice: NoticeRecord;
}

/** 1つの部屋・日付の清掃時間の判定 */
export interface TurnoverGapCheck {
  roomId: string;
  /** 判定した日（YYYY-MM-DD） */
  date: string;
  judgement: TurnoverJudgement;
  /** 2時間未満のとき：作ったお知らせ、または同じ部屋・日付の未解決のお知らせ。それ以外は null */
  notice: RecordNoticeResult | null;
}

export interface TurnoverGapsForReservationOptions {
  /** 判定する予約の部屋（省略時は予約の全室。時間外を変えた部屋だけを判定するときなど） */
  reservationRoomIds?: readonly string[];
  /**
   * 判定する切れ目（省略時は BOTH）。ARRIVAL：その部屋に泊まり始める日（前の客との間。アーリーを変えたとき）、
   * DEPARTURE：その部屋を出る日（次の客との間。レイトを変えたとき）
   */
  edges?: 'ARRIVAL' | 'DEPARTURE' | 'BOTH';
}

/** 重複したときに、すでにある未解決のお知らせを読み直す回数の上限（読む前に解決された場合に作り直すため） */
const MAX_RECORD_ATTEMPTS = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: ReadonlySet<string> = new Set(NOTICE_KINDS);

const NOTICE_SELECT = {
  id: true,
  kind: true,
  dedupeKey: true,
  message: true,
  roomTypeId: true,
  roomId: true,
  reservationId: true,
  dateFrom: true,
  dateTo: true,
  createdAt: true,
  resolvedAt: true,
  resolvedBy: true,
} as const satisfies Prisma.NoticeSelect;

type NoticeRow = Prisma.NoticeGetPayload<{ select: typeof NOTICE_SELECT }>;

@Injectable()
export class NoticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: BusinessClock,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * お知らせを作る。同じ dedupe_key の未解決のお知らせがあれば作らず、それを返す（10.9）。
   * 同時に作られても未解決は1件で、一意制約の違反で呼び出し側のトランザクションを中断しない。
   * @throws RangeError 内容の形が正しくないとき（プログラムの誤り）
   */
  async record(db: NoticeDb, draft: NoticeDraft): Promise<RecordNoticeResult> {
    const data = createData(draft, this.clock.now());
    for (let attempt = 1; attempt <= MAX_RECORD_ATTEMPTS; attempt += 1) {
      // ON CONFLICT DO NOTHING：未解決の行の dedupe_key の部分一意インデックスに当たれば、何もしない
      const [created] = await db.notice.createManyAndReturn({
        data: [data],
        skipDuplicates: true,
        select: NOTICE_SELECT,
      });
      if (created !== undefined) return { created: true, notice: toRecord(created) };
      const open = await db.notice.findFirst({
        where: { dedupeKey: draft.dedupeKey, resolvedAt: null },
        select: NOTICE_SELECT,
      });
      if (open !== null) return { created: false, notice: toRecord(open) };
    }
    throw new Error(
      'お知らせを作れませんでした（同じキーの未解決のお知らせが、読み直す前に解決されることが続きました）',
    );
  }

  /**
   * 連泊できない在庫なしのお知らせ（FRAGMENTED_INVENTORY。P-02 の手順5、要件 10.8・10.9）。
   * 同じ客室タイプ・同じ日程（到着日・出発日）の未解決のお知らせがあれば作らない（室数・人数が違っても同じ）。
   */
  async recordFragmentedInventory(
    db: NoticeDb,
    input: { roomTypeId: string; arrivalDate: string; departureDate: string },
  ): Promise<RecordNoticeResult> {
    assertStayDates(input.arrivalDate, input.departureDate);
    const roomType = await db.roomType.findUnique({
      where: { id: input.roomTypeId },
      select: { nameJa: true },
    });
    if (roomType === null) throw new RangeError('お知らせの客室タイプがありません');
    return this.record(db, {
      kind: 'FRAGMENTED_INVENTORY',
      dedupeKey: NOTICE_DEDUPE_KEYS.fragmentedInventory(
        input.roomTypeId,
        input.arrivalDate,
        input.departureDate,
      ),
      message: fragmentedInventoryMessage({ roomTypeName: roomType.nameJa, ...input }),
      roomTypeId: input.roomTypeId,
      dateFrom: input.arrivalDate,
      dateTo: input.departureDate,
    });
  }

  /**
   * 離れた部屋のお知らせ（SPLIT_FLOORS。P-03 の手順4・P-05 の手順2・P-09 の手順8、要件 9.4・10.10）。
   * 作るかどうか（2室以上が同じ階に収まらず、配置上は収まり得る：selectRooms の splitAcrossFloors かつ
   * structurallyImpossible でない）は呼び出し側が決める。確定の時点で作る（L-20）ので、予約番号のない予約には作らない。
   * 部屋は、呼び出し側の変更の後の、取り消していない予約の部屋の部屋番号を書く。
   */
  async recordSplitFloors(db: NoticeDb, reservationId: string): Promise<RecordNoticeResult> {
    const reservation = await db.reservation.findUnique({
      where: { id: reservationId },
      select: {
        reservationNumber: true,
        roomTypeId: true,
        arrivalDate: true,
        departureDate: true,
        rooms: { where: { cancelledAt: null }, select: { room: { select: { roomNumber: true } } } },
      },
    });
    if (reservation === null) throw new RangeError('お知らせの予約がありません');
    if (reservation.reservationNumber === null) {
      throw new Error(
        '予約番号のない（確定していない）予約には、離れた部屋のお知らせを作りません（確定の時点で作る：L-20）',
      );
    }
    const roomNumbers = reservation.rooms.flatMap((row) =>
      row.room === null ? [] : [row.room.roomNumber],
    );
    return this.record(db, {
      kind: 'SPLIT_FLOORS',
      dedupeKey: NOTICE_DEDUPE_KEYS.splitFloors(reservationId),
      message: splitFloorsMessage({
        reservationNumber: reservation.reservationNumber,
        roomNumbers,
      }),
      roomTypeId: reservation.roomTypeId,
      reservationId,
      dateFrom: fromDbDate(reservation.arrivalDate),
      dateTo: fromDbDate(reservation.departureDate),
    });
  }

  /**
   * 部屋の date の日の清掃時間を判定し、前の客のチェックアウトから次の客のチェックインまでが2時間未満なら
   * お知らせ（TURNOVER_GAP）を作る（ちょうど2時間は作らない。要件 10.11・10.12）。
   * 前の客は date の前日の夜、次の客は date の夜に、その部屋に泊まる客（TURNOVER_GUEST_STATUSES の予約の、
   * 取り消していない予約の部屋の BOOKED の夜）。変更の後に、同じトランザクションの tx を渡して呼ぶ。
   */
  async checkTurnoverGap(db: NoticeDb, roomId: string, date: string): Promise<TurnoverGapCheck> {
    const previousDate = addDays(date, -1);
    const nights = await db.roomNight.findMany({
      where: {
        roomId,
        stayDate: { in: [toDbDate(previousDate), toDbDate(date)] },
        kind: 'BOOKED',
        reservationRoom: {
          cancelledAt: null,
          reservation: { status: { in: [...TURNOVER_GUEST_STATUSES] } },
        },
      },
      select: {
        stayDate: true,
        reservationRoomId: true,
        reservationRoom: {
          select: {
            earlyCheckinHour: true,
            lateCheckoutHour: true,
            reservation: { select: { arrivalDate: true, departureDate: true } },
          },
        },
      },
    });
    const occupantOn = (stayDate: string): NightOccupant | undefined => {
      const night = nights.find((row) => fromDbDate(row.stayDate) === stayDate);
      if (night === undefined) return undefined;
      const { reservationRoom } = night;
      return {
        stayId: night.reservationRoomId,
        arrivalDate: fromDbDate(reservationRoom.reservation.arrivalDate),
        departureDate: fromDbDate(reservationRoom.reservation.departureDate),
        // 値の範囲はデータベースの CHECK 制約と judgeTurnover が確かめる
        earlyCheckinHour: reservationRoom.earlyCheckinHour as EarlyCheckinHour | null,
        lateCheckoutHour: reservationRoom.lateCheckoutHour as LateCheckoutHour | null,
      };
    };

    const judgement = judgeTurnover(date, occupantOn(previousDate), occupantOn(date));
    if (!judgement.turnover || !judgement.insufficient) {
      return { roomId, date, judgement, notice: null };
    }
    const room = await db.room.findUniqueOrThrow({
      where: { id: roomId },
      select: { roomNumber: true },
    });
    const notice = await this.record(db, {
      kind: 'TURNOVER_GAP',
      dedupeKey: NOTICE_DEDUPE_KEYS.turnoverGap(roomId, date),
      message: turnoverGapMessage({
        roomNumber: room.roomNumber,
        date,
        checkout: judgement.checkout,
        checkin: judgement.checkin,
        gapMinutes: judgement.gapMinutes,
      }),
      roomId,
      dateFrom: date,
      dateTo: date,
    });
    return { roomId, date, judgement, notice };
  }

  /** 複数の部屋・日付の清掃時間を判定する（同じ部屋・日付は1回だけ。渡した順） */
  async checkTurnoverGaps(
    db: NoticeDb,
    points: readonly TurnoverPoint[],
  ): Promise<TurnoverGapCheck[]> {
    const unique = new Map<string, TurnoverPoint>();
    for (const point of points) unique.set(JSON.stringify([point.roomId, point.date]), point);
    const checks: TurnoverGapCheck[] = [];
    // トランザクションの接続は1本なので、順に判定する
    for (const point of unique.values()) {
      checks.push(await this.checkTurnoverGap(db, point.roomId, point.date));
    }
    return checks;
  }

  /**
   * 予約の部屋の、今の夜（取り消していない予約の部屋の BOOKED の room_nights）の切れ目の清掃時間を判定する。
   * 予約の確定（5.7・7.2）・変更（6.2）・移動と入れ替え（7.3。入れ替えは両方の予約）・時間外の変更（7.5）の後に、
   * 同じトランザクションの中で呼ぶ。部屋ごとに、泊まり始める日（前の客との間）と出る日（次の客との間）を判定する。
   * 移動の後のもとの部屋は判定しない（客が減るだけで、新しく前後の客が隣り合うことはない）。
   */
  async checkTurnoverGapsForReservation(
    db: NoticeDb,
    reservationId: string,
    options: TurnoverGapsForReservationOptions = {},
  ): Promise<TurnoverGapCheck[]> {
    const { reservationRoomIds, edges = 'BOTH' } = options;
    if (reservationRoomIds !== undefined && reservationRoomIds.length === 0) return [];
    const nights = await db.roomNight.findMany({
      where: {
        kind: 'BOOKED',
        reservationRoom: {
          reservationId,
          cancelledAt: null,
          ...(reservationRoomIds === undefined ? {} : { id: { in: [...reservationRoomIds] } }),
        },
      },
      select: { reservationRoomId: true, roomId: true, stayDate: true },
    });
    const points = turnoverPointsOf(
      nights.map((night) => ({
        stayId: night.reservationRoomId,
        roomId: night.roomId,
        stayDate: fromDbDate(night.stayDate),
      })),
    );
    const selected =
      edges === 'ARRIVAL'
        ? points.arrivals
        : edges === 'DEPARTURE'
          ? points.departures
          : [...points.arrivals, ...points.departures];
    return this.checkTurnoverGaps(db, selected);
  }

  /** 解決していないお知らせの件数（チャートのベルの赤丸のバッジ。10.13） */
  countOpen(db: NoticeDb = this.prisma): Promise<number> {
    return db.notice.count({ where: { resolvedAt: null } });
  }

  /** 解決していないお知らせの一覧（新しい順。F03 の種類・対象・作成日時・メッセージ。10.14） */
  async listOpen(db: NoticeDb = this.prisma): Promise<OpenNotice[]> {
    const rows = await db.notice.findMany({
      where: { resolvedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: NOTICE_SELECT,
    });
    const roomTypeIds = distinct(rows.map((row) => row.roomTypeId));
    const roomIds = distinct(rows.map((row) => row.roomId));
    const reservationIds = distinct(rows.map((row) => row.reservationId));
    const roomTypes =
      roomTypeIds.length === 0
        ? []
        : await db.roomType.findMany({
            where: { id: { in: roomTypeIds } },
            select: { id: true, nameJa: true },
          });
    const rooms =
      roomIds.length === 0
        ? []
        : await db.room.findMany({
            where: { id: { in: roomIds } },
            select: { id: true, roomNumber: true },
          });
    const reservations =
      reservationIds.length === 0
        ? []
        : await db.reservation.findMany({
            where: { id: { in: reservationIds } },
            select: { id: true, reservationNumber: true },
          });
    const typeNames = new Map(roomTypes.map((row) => [row.id, row.nameJa]));
    const roomNumbers = new Map(rooms.map((row) => [row.id, row.roomNumber]));
    const reservationNumbers = new Map(reservations.map((row) => [row.id, row.reservationNumber]));

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as NoticeKind,
      message: row.message,
      roomTypeId: row.roomTypeId,
      roomTypeName: row.roomTypeId === null ? null : (typeNames.get(row.roomTypeId) ?? null),
      roomId: row.roomId,
      roomNumber: row.roomId === null ? null : (roomNumbers.get(row.roomId) ?? null),
      reservationId: row.reservationId,
      reservationNumber:
        row.reservationId === null ? null : (reservationNumbers.get(row.reservationId) ?? null),
      dateFrom: fromDbDate(row.dateFrom),
      dateTo: fromDbDate(row.dateTo),
      createdAt: row.createdAt,
    }));
  }

  /**
   * お知らせを解決済みにする（resolved_at・resolved_by を記録し、件数のバッジから除く。10.15）。
   * それだけで1つの操作（POST /notices/{id}/resolve：7.6）なので、自分のトランザクションで操作履歴
   * （NOTICE_RESOLVE、対象はお知らせ）を1行記録する。すでに解決済みなら何も変えず、操作履歴も残さない
   * （ボタンの二度押し・同時の解決）。
   * @param actor 解決したスタッフ（staffActor(@CurrentStaff())）
   * @throws BusinessError NOT_FOUND：お知らせがないとき（ID の形が違うときを含む）
   */
  async resolve(actor: AuditActor, noticeId: string): Promise<ResolveNoticeResult> {
    if (actor.kind !== 'STAFF') {
      throw new Error('お知らせを解決するのはスタッフの操作です（定時処理は解決しない）');
    }
    if (!UUID.test(noticeId)) throw new BusinessError('NOT_FOUND');
    const now = this.clock.now();
    return runInTransaction(this.prisma, async (tx) => {
      // 解決していない行だけを変える（同時に解決したら、後の側は 0 行になる）
      const { count } = await tx.notice.updateMany({
        where: { id: noticeId, resolvedAt: null },
        data: { resolvedAt: now, resolvedBy: actor.staffId },
      });
      const row = await tx.notice.findUnique({ where: { id: noticeId }, select: NOTICE_SELECT });
      if (row === null) throw new BusinessError('NOT_FOUND');
      if (count === 0) return { changed: false, notice: toRecord(row) };
      await this.audit.record(tx, actor, {
        action: 'NOTICE_RESOLVE',
        target: { type: 'notice', id: noticeId },
        at: now,
      });
      return { changed: true, notice: toRecord(row) };
    });
  }
}

/** 作る行の内容を確かめて組み立てる */
function createData(draft: NoticeDraft, createdAt: Date): Prisma.NoticeCreateManyInput {
  if (!KINDS.has(draft.kind)) throw new RangeError('お知らせの種類が正しくありません');
  if (draft.dedupeKey.trim() === '')
    throw new RangeError('お知らせの重複のまとめのキーがありません');
  if (draft.message.trim() === '') throw new RangeError('お知らせのメッセージがありません');
  const dateFrom = toDbDate(draft.dateFrom);
  const dateTo = toDbDate(draft.dateTo);
  if (dateTo < dateFrom) throw new RangeError('お知らせの期間の終わりが始まりより前です');
  return {
    kind: draft.kind,
    dedupeKey: draft.dedupeKey,
    message: draft.message,
    roomTypeId: draft.roomTypeId ?? null,
    roomId: draft.roomId ?? null,
    reservationId: draft.reservationId ?? null,
    dateFrom,
    dateTo,
    createdAt,
  };
}

function assertStayDates(arrivalDate: string, departureDate: string): void {
  parseDate(arrivalDate);
  parseDate(departureDate);
  if (departureDate <= arrivalDate) {
    throw new RangeError('お知らせの日程は、到着日が出発日より前でなければなりません');
  }
}

function toRecord(row: NoticeRow): NoticeRecord {
  return {
    id: row.id,
    // 値はデータベースの CHECK 制約で NOTICE_KINDS に限られる
    kind: row.kind as NoticeKind,
    dedupeKey: row.dedupeKey,
    message: row.message,
    roomTypeId: row.roomTypeId,
    roomId: row.roomId,
    reservationId: row.reservationId,
    dateFrom: fromDbDate(row.dateFrom),
    dateTo: fromDbDate(row.dateTo),
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
  };
}

/** YYYY-MM-DD → date 型の列の値（Prisma は UTC の 0:00 の Date で扱う） */
function toDbDate(date: string): Date {
  parseDate(date);
  return new Date(`${date}T00:00:00.000Z`);
}

/** date 型の列の値 → YYYY-MM-DD */
function fromDbDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function distinct(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}
