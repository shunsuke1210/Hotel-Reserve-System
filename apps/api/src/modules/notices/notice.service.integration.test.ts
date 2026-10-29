// お知らせの記録・重複のまとめ・解決と、清掃時間の判定（NoticeService。tasks.md 3.6、design.md P-11）を、
// テスト用のデータベースと社内用の待ち受け口で確かめる。
// 予約・変更・時間外・移動・入れ替えの各操作からの呼び出し（TC-OP-116〜120・300・301）は、それぞれのタスクと 7.6 で
// 確かめる。ここでは、その操作の後の部屋の夜（room_nights）と時間外の値を直接作り、判定の処理を呼ぶ。
// 部屋番号はテストケースの説明用の値（501 など）をそのまま使う（この DB には初期データの部屋がない）。
import type { NoticeKind, ReservationStatus } from '@hotel/contracts';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../../domain/calendar/business-date.js';
import { staffActor } from '../../shared/audit/audit-entry.js';
import { FixedBusinessClock } from '../../shared/clock/business-clock.js';
import { BusinessError } from '../../shared/errors/business-error.js';
import { runInTransaction } from '../../shared/prisma/transaction.js';
import { countAuditLogs, listAuditLogs } from '../../test/audit.js';
import { insertStaff } from '../../test/auth/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../../test/database/test-database.js';
import { createTestListenerApp } from '../../test/listener-app.js';
import { NoticeService } from './notice.service.js';

const NOW = '2026-11-10T10:00:00+09:00';
const DATE = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

let db: TestDatabase;
let app: INestApplication;
let clock: FixedBusinessClock;
let notices: NoticeService;
let standardKingId: string;
let suiteId: string;
let frontStaff: { staffId: string; staffNumber: string };

beforeAll(async () => {
  db = await createTestDatabase();
  clock = new FixedBusinessClock(NOW);
  app = await createTestListenerApp('staff', { prisma: db.prisma, clock });
  notices = app.get(NoticeService);
  standardKingId = await createRoomType('STANDARD_KING', 'スタンダード キング');
  suiteId = await createRoomType('SUITE', 'スイート');
  const staffId = await insertStaff(db.prisma, {
    staffNumber: 'S101',
    role: 'FRONT',
    passwordHash: 'argon2id$dummy',
  });
  frontStaff = { staffId, staffNumber: 'S101' };
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

beforeEach(async () => {
  clock.set(NOW);
  await db.prisma.notice.deleteMany();
});

async function createRoomType(code: string, nameJa: string): Promise<string> {
  const row = await db.prisma.roomType.create({
    data: {
      code,
      nameJa,
      areaSqm: 25,
      bedDescriptionJa: 'ベッド',
      capacityAdults: 3,
      standardOccupancy: 2,
      displayOrder: 1,
      descriptionJa: '説明',
    },
    select: { id: true },
  });
  return row.id;
}

/** 部屋（番号は呼び出し側が重ならないように決める） */
async function createRoom(roomNumber: number, roomTypeId = standardKingId): Promise<string> {
  const row = await db.prisma.room.create({
    data: {
      roomNumber,
      floor: Math.floor(roomNumber / 100),
      roomTypeId,
      isAccessible: false,
      status: 'CLEAN',
      statusChangedAt: new Date(NOW),
    },
    select: { id: true },
  });
  return row.id;
}

/** テストごとに別の部屋を使う（お知らせの重複のまとめがほかのテストにかからないように） */
let nextRoomNumber = 701;
const newRoom = (): Promise<string> => createRoom(nextRoomNumber++);

interface StayInput {
  arrival: string;
  departure: string;
  early?: 12 | 13 | 14 | null;
  late?: 13 | 14 | 15 | null;
  /** 予約の状態（既定は CONFIRMED） */
  status?: ReservationStatus;
  /** 予約の到着日・出発日（省略時は arrival・departure。部屋を途中で移った滞在などで、この部屋の夜と違うとき） */
  reservationArrival?: string;
  reservationDeparture?: string;
  /** 予約の部屋を取り消し済みにする */
  roomCancelled?: boolean;
}

interface Stay {
  reservationId: string;
  reservationRoomId: string;
}

/** 部屋に滞在を1つ作る（予約・予約の部屋・夜ごとの room_nights。状態が PENDING_PAYMENT なら HOLD） */
async function createStay(roomId: string, input: StayInput): Promise<Stay> {
  const status = input.status ?? 'CONFIRMED';
  const reservation = await db.prisma.reservation.create({
    data: {
      reservationNumber:
        status === 'PENDING_PAYMENT'
          ? null
          : randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase(),
      memberId: null,
      channel: 'FRONT',
      status,
      paymentMethod: 'PAY_AT_HOTEL',
      roomTypeId: standardKingId,
      arrivalDate: DATE(input.reservationArrival ?? input.arrival),
      departureDate: DATE(input.reservationDeparture ?? input.departure),
      adults: 2,
      children: 0,
      infants: 0,
      breakfastAdults: 0,
      breakfastChildren: 0,
      breakfastInfants: 0,
      earlyBird: false,
      isGroup: false,
      maxRoomCount: 1,
      bookerIsGuest: true,
      companionsOnSite: false,
      version: 1,
    },
    select: { id: true },
  });
  const reservationRoom = await db.prisma.reservationRoom.create({
    data: {
      reservationId: reservation.id,
      roomId,
      currentRoomTypeId: standardKingId,
      earlyCheckinHour: input.early ?? null,
      lateCheckoutHour: input.late ?? null,
      cancelledAt: input.roomCancelled ? new Date(NOW) : null,
    },
    select: { id: true },
  });
  await addNights(reservationRoom.id, roomId, input.arrival, input.departure, status);
  return { reservationId: reservation.id, reservationRoomId: reservationRoom.id };
}

async function addNights(
  reservationRoomId: string,
  roomId: string,
  from: string,
  to: string,
  status: ReservationStatus = 'CONFIRMED',
): Promise<void> {
  const data = [];
  for (let date = from; date < to; date = addDays(date, 1)) {
    data.push({
      reservationRoomId,
      roomId,
      stayDate: DATE(date),
      kind: status === 'PENDING_PAYMENT' ? 'HOLD' : 'BOOKED',
    });
  }
  await db.prisma.roomNight.createMany({ data });
}

const openCount = (where: { dedupeKey?: string; kind?: NoticeKind } = {}): Promise<number> =>
  db.prisma.notice.count({ where: { ...where, resolvedAt: null } });

describe('[10.8][10.9] 連泊できない在庫なしのお知らせ（FRAGMENTED_INVENTORY）と重複のまとめ', () => {
  const stay = { arrivalDate: '2026-12-01', departureDate: '2026-12-03' };

  it('[10.8][10.9] TC-RS-173・179・180：同じ客室タイプ・同じ日程を2回作ろうとしても、未解決は1件のまま', async () => {
    const first = await notices.recordFragmentedInventory(db.prisma, {
      roomTypeId: suiteId,
      ...stay,
    });
    expect(first.created).toBe(true);
    expect(first.notice).toMatchObject({
      kind: 'FRAGMENTED_INVENTORY',
      dedupeKey: `FRAG:${suiteId}:2026-12-01:2026-12-03`,
      message: 'スイート 12/1〜12/3：各夜に空室はありますが、連泊できる部屋がありません',
      roomTypeId: suiteId,
      roomId: null,
      reservationId: null,
      dateFrom: '2026-12-01',
      dateTo: '2026-12-03',
      createdAt: new Date(NOW),
      resolvedAt: null,
      resolvedBy: null,
    });

    clock.advance(60_000);
    const second = await notices.recordFragmentedInventory(db.prisma, {
      roomTypeId: suiteId,
      ...stay,
    });
    expect(second).toEqual({ created: false, notice: first.notice });
    expect(await openCount({ kind: 'FRAGMENTED_INVENTORY' })).toBe(1);
    expect(await notices.countOpen()).toBe(1);
  });

  it('[10.9] TC-RS-181：日程が違えば別のお知らせになる（同じタイプでも）。タイプが違っても別', async () => {
    await notices.recordFragmentedInventory(db.prisma, { roomTypeId: suiteId, ...stay });
    const otherDates = await notices.recordFragmentedInventory(db.prisma, {
      roomTypeId: suiteId,
      arrivalDate: '2026-11-30',
      departureDate: '2026-12-03',
    });
    const otherType = await notices.recordFragmentedInventory(db.prisma, {
      roomTypeId: standardKingId,
      ...stay,
    });
    expect(otherDates.created).toBe(true);
    expect(otherType.created).toBe(true);
    expect(await notices.countOpen()).toBe(3);
  });

  it('[10.9][10.15] TC-RS-182：解決した後は、同じ客室タイプ・日程で新しいお知らせを作る（未解決は1件）', async () => {
    const first = await notices.recordFragmentedInventory(db.prisma, {
      roomTypeId: suiteId,
      ...stay,
    });
    await notices.resolve(staffActor(frontStaff), first.notice.id);

    const again = await notices.recordFragmentedInventory(db.prisma, {
      roomTypeId: suiteId,
      ...stay,
    });
    expect(again.created).toBe(true);
    expect(again.notice.id).not.toBe(first.notice.id);
    expect(await openCount({ kind: 'FRAGMENTED_INVENTORY' })).toBe(1);
    expect(await db.prisma.notice.count({ where: { dedupeKey: first.notice.dedupeKey } })).toBe(2);
  });

  it('[10.9] TC-RS-183：同じお知らせを2つのトランザクションが同時に作っても、未解決は1件だけ（どちらも失敗しない）', async () => {
    let releaseFirst: () => void = () => undefined;
    const firstMayCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstRecorded: () => void = () => undefined;
    const firstHasRecorded = new Promise<void>((resolve) => {
      firstRecorded = resolve;
    });

    const first = runInTransaction(db.prisma, async (tx) => {
      const result = await notices.recordFragmentedInventory(tx, { roomTypeId: suiteId, ...stay });
      firstRecorded();
      await firstMayCommit;
      return result;
    });
    await firstHasRecorded;
    // 2つ目は、1つ目が確定するまで一意のインデックスで待たされ、確定した後に「作らない」になる
    const second = runInTransaction(db.prisma, (tx) =>
      notices.recordFragmentedInventory(tx, { roomTypeId: suiteId, ...stay }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    releaseFirst();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.created).toBe(true);
    expect(secondResult).toEqual({ created: false, notice: firstResult.notice });
    expect(await openCount({ kind: 'FRAGMENTED_INVENTORY' })).toBe(1);
  });

  it('[10.9] 呼び出し側のトランザクションの中で重複しても、トランザクションは中断されず、続きの変更とともに確定できる', async () => {
    const committedBefore = await notices.recordFragmentedInventory(db.prisma, {
      roomTypeId: suiteId,
      ...stay,
    });

    const results = await runInTransaction(db.prisma, async (tx) => {
      const duplicateOfCommitted = await notices.recordFragmentedInventory(tx, {
        roomTypeId: suiteId,
        ...stay,
      });
      const created = await notices.recordFragmentedInventory(tx, {
        roomTypeId: standardKingId,
        ...stay,
      });
      const duplicateInSameTx = await notices.recordFragmentedInventory(tx, {
        roomTypeId: standardKingId,
        ...stay,
      });
      // 重複の後も、同じトランザクションで別の行を書ける（一意制約の違反でトランザクションが中断されていない）
      const later = await notices.recordFragmentedInventory(tx, {
        roomTypeId: standardKingId,
        arrivalDate: '2026-12-10',
        departureDate: '2026-12-12',
      });
      return { duplicateOfCommitted, created, duplicateInSameTx, later };
    });

    expect(results.duplicateOfCommitted).toEqual({
      created: false,
      notice: committedBefore.notice,
    });
    expect(results.created.created).toBe(true);
    expect(results.duplicateInSameTx).toEqual({ created: false, notice: results.created.notice });
    expect(results.later.created).toBe(true);
    expect(await notices.countOpen()).toBe(3);
  });

  it('[10.9] お知らせは呼び出し側のトランザクションと一緒に取り消される（失敗した操作のお知らせは残らない）', async () => {
    await expect(
      runInTransaction(db.prisma, async (tx) => {
        await notices.recordFragmentedInventory(tx, { roomTypeId: suiteId, ...stay });
        throw new BusinessError('NO_AVAILABILITY');
      }),
    ).rejects.toMatchObject({ code: 'NO_AVAILABILITY' });
    expect(await notices.countOpen()).toBe(0);
  });

  it('到着日が出発日より前でなければ RangeError（プログラムの誤り）', async () => {
    await expect(
      notices.recordFragmentedInventory(db.prisma, {
        roomTypeId: suiteId,
        arrivalDate: '2026-12-03',
        departureDate: '2026-12-03',
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('[10.10] 離れた部屋のお知らせ（SPLIT_FLOORS）と重複のまとめ', () => {
  async function splitReservation(): Promise<{ reservationId: string; number: string }> {
    const room501 = await createRoom(nextRoomNumber++);
    const room601 = await createRoom(nextRoomNumber++);
    const first = await createStay(room501, { arrival: '2026-11-10', departure: '2026-11-11' });
    const secondRoom = await db.prisma.reservationRoom.create({
      data: {
        reservationId: first.reservationId,
        roomId: room601,
        currentRoomTypeId: standardKingId,
      },
      select: { id: true },
    });
    await addNights(secondRoom.id, room601, '2026-11-10', '2026-11-11');
    const reservation = await db.prisma.reservation.findUniqueOrThrow({
      where: { id: first.reservationId },
      select: { reservationNumber: true },
    });
    return { reservationId: first.reservationId, number: reservation.reservationNumber ?? '' };
  }

  it('[10.10] TC-OP-097・103：予約番号と部屋を記載し、同じ予約で2回作ろうとしても未解決は1件のまま', async () => {
    const { reservationId, number } = await splitReservation();
    const rooms = await db.prisma.reservationRoom.findMany({
      where: { reservationId },
      select: { room: { select: { roomNumber: true } } },
    });
    const roomNumbers = rooms.map((row) => row.room?.roomNumber ?? 0).sort((a, b) => a - b);

    const first = await notices.recordSplitFloors(db.prisma, reservationId);
    expect(first.created).toBe(true);
    expect(first.notice).toMatchObject({
      kind: 'SPLIT_FLOORS',
      dedupeKey: `SPLIT:${reservationId}`,
      message: `予約 ${number}：2室が同じ階に収まらず、離れた階の部屋になっています（${roomNumbers.join('・')}号室）`,
      roomTypeId: standardKingId,
      roomId: null,
      reservationId,
      dateFrom: '2026-11-10',
      dateTo: '2026-11-11',
    });

    const second = await notices.recordSplitFloors(db.prisma, reservationId);
    expect(second.created).toBe(false);
    expect(await openCount({ kind: 'SPLIT_FLOORS' })).toBe(1);

    // TC-OP-105：解決した後は新しいお知らせ
    await notices.resolve(staffActor(frontStaff), first.notice.id);
    const third = await notices.recordSplitFloors(db.prisma, reservationId);
    expect(third.created).toBe(true);
    expect(await openCount({ kind: 'SPLIT_FLOORS' })).toBe(1);
  });

  it('[10.10] 確定していない（予約番号のない）予約には作らない（L-20：確定の時点で作る）', async () => {
    const room = await newRoom();
    const hold = await createStay(room, {
      arrival: '2026-11-10',
      departure: '2026-11-11',
      status: 'PENDING_PAYMENT',
    });
    await expect(notices.recordSplitFloors(db.prisma, hold.reservationId)).rejects.toThrow(
      /予約番号/,
    );
    expect(await notices.countOpen()).toBe(0);
  });
});

describe('[10.11][10.12] 清掃時間の不足のお知らせ（TURNOVER_GAP）', () => {
  // test-cases 05 の 2.8 の前提：前の客 P（11/11〜11/12）、次の客 N（11/12〜11/13）。判定する日は 11/12
  const TURNOVER_DATE = '2026-11-12';

  async function previousAndNext(
    roomId: string,
    late: StayInput['late'],
    early: StayInput['early'],
  ): Promise<{ previous: Stay; next: Stay }> {
    const previous = await createStay(roomId, {
      arrival: '2026-11-11',
      departure: TURNOVER_DATE,
      late,
    });
    const next = await createStay(roomId, {
      arrival: TURNOVER_DATE,
      departure: '2026-11-13',
      early,
    });
    return { previous, next };
  }

  it.each([
    { id: 'TC-OP-106', late: null, early: null, gap: 180, created: false },
    { id: 'TC-OP-107', late: null, early: 14, gap: 120, created: false },
    { id: 'TC-OP-108', late: null, early: 13, gap: 60, created: true },
    { id: 'TC-OP-109', late: 14, early: null, gap: 60, created: true },
    { id: 'TC-OP-110', late: 15, early: 13, gap: -120, created: true },
    { id: 'TC-OP-111', late: 13, early: null, gap: 120, created: false },
    { id: 'TC-OP-112', late: 13, early: 14, gap: 60, created: true },
    { id: 'TC-OP-113', late: null, early: 12, gap: 0, created: true },
  ] as const)(
    '[10.11][10.12] $id：レイト $late・アーリー $early → 空き $gap 分、お知らせ $created',
    async ({ late, early, gap, created }) => {
      const roomId = await newRoom();
      await previousAndNext(roomId, late, early);

      const result = await runInTransaction(db.prisma, (tx) =>
        notices.checkTurnoverGap(tx, roomId, TURNOVER_DATE),
      );

      expect(result.judgement).toMatchObject({ turnover: true, gapMinutes: gap });
      expect(result.notice?.created ?? false).toBe(created);
      expect(await openCount({ dedupeKey: `GAP:${roomId}:${TURNOVER_DATE}` })).toBe(
        created ? 1 : 0,
      );
    },
  );

  it('[10.11] TC-OP-115：部屋・日付・両方の時刻を記載したお知らせを作る', async () => {
    const room501 = await createRoom(501);
    await previousAndNext(room501, 14, null);

    const result = await notices.checkTurnoverGap(db.prisma, room501, TURNOVER_DATE);

    expect(result.notice?.created).toBe(true);
    expect(result.notice?.notice).toMatchObject({
      kind: 'TURNOVER_GAP',
      dedupeKey: `GAP:${room501}:2026-11-12`,
      message:
        '501号室 11/12：前の客のレイトチェックアウト 14:00 から次の客のチェックイン 15:00 まで1時間しかありません',
      roomTypeId: null,
      roomId: room501,
      reservationId: null,
      dateFrom: '2026-11-12',
      dateTo: '2026-11-12',
      resolvedAt: null,
    });
  });

  it('[10.11] TC-OP-114：次の客が別の日に着くなら作らない（同じ日ではない）', async () => {
    const roomId = await newRoom();
    await createStay(roomId, { arrival: '2026-11-11', departure: TURNOVER_DATE, late: 15 });
    await createStay(roomId, { arrival: '2026-11-13', departure: '2026-11-14', early: 12 });

    const checks = await notices.checkTurnoverGaps(db.prisma, [
      { roomId, date: TURNOVER_DATE },
      { roomId, date: '2026-11-13' },
    ]);
    expect(checks.map((check) => check.judgement)).toEqual([
      { turnover: false, reason: 'NO_NEXT_GUEST' },
      { turnover: false, reason: 'NO_PREVIOUS_GUEST' },
    ]);
    expect(await notices.countOpen()).toBe(0);
  });

  it('[10.11] TC-OP-124：前の夜に客がいなければ作らない', async () => {
    const roomId = await newRoom();
    await createStay(roomId, { arrival: TURNOVER_DATE, departure: '2026-11-13', early: 12 });

    const result = await notices.checkTurnoverGap(db.prisma, roomId, TURNOVER_DATE);
    expect(result).toMatchObject({
      judgement: { turnover: false, reason: 'NO_PREVIOUS_GUEST' },
      notice: null,
    });
  });

  it('[10.11] 連泊の途中の日は、同じ客が泊まり続けるので作らない', async () => {
    const roomId = await newRoom();
    await createStay(roomId, {
      arrival: '2026-11-11',
      departure: '2026-11-14',
      early: 12,
      late: 15,
    });

    const result = await notices.checkTurnoverGap(db.prisma, roomId, TURNOVER_DATE);
    expect(result.judgement).toEqual({ turnover: false, reason: 'SAME_STAY' });
    expect(await notices.countOpen()).toBe(0);
  });

  it('[10.11] 泊まる客は確定済み・チェックイン済み・チェックアウト済みの予約の夜だけ（決済待ち・ノーショー・取り消した部屋は数えない）', async () => {
    const holdNext = await newRoom();
    await createStay(holdNext, { arrival: '2026-11-11', departure: TURNOVER_DATE, late: 15 });
    await createStay(holdNext, {
      arrival: TURNOVER_DATE,
      departure: '2026-11-13',
      early: 12,
      status: 'PENDING_PAYMENT',
    });

    const noShowPrevious = await newRoom();
    await createStay(noShowPrevious, {
      arrival: '2026-11-11',
      departure: TURNOVER_DATE,
      late: 15,
      status: 'NO_SHOW',
    });
    await createStay(noShowPrevious, {
      arrival: TURNOVER_DATE,
      departure: '2026-11-13',
      early: 12,
    });

    const cancelledRoom = await newRoom();
    await createStay(cancelledRoom, {
      arrival: '2026-11-11',
      departure: TURNOVER_DATE,
      late: 15,
      roomCancelled: true,
    });
    await createStay(cancelledRoom, { arrival: TURNOVER_DATE, departure: '2026-11-13', early: 12 });

    const checkedOutThenCheckedIn = await newRoom();
    await createStay(checkedOutThenCheckedIn, {
      arrival: '2026-11-11',
      departure: TURNOVER_DATE,
      late: 15,
      status: 'CHECKED_OUT',
    });
    await createStay(checkedOutThenCheckedIn, {
      arrival: TURNOVER_DATE,
      departure: '2026-11-13',
      early: 12,
      status: 'CHECKED_IN',
    });

    const checks = await notices.checkTurnoverGaps(db.prisma, [
      { roomId: holdNext, date: TURNOVER_DATE },
      { roomId: noShowPrevious, date: TURNOVER_DATE },
      { roomId: cancelledRoom, date: TURNOVER_DATE },
      { roomId: checkedOutThenCheckedIn, date: TURNOVER_DATE },
    ]);
    expect(checks.map((check) => check.judgement)).toEqual([
      { turnover: false, reason: 'NO_NEXT_GUEST' },
      { turnover: false, reason: 'NO_PREVIOUS_GUEST' },
      { turnover: false, reason: 'NO_PREVIOUS_GUEST' },
      expect.objectContaining({ turnover: true, gapMinutes: -180, insufficient: true }),
    ]);
    expect(await notices.countOpen()).toBe(1);
  });

  it('[10.11] 呼び出し側のトランザクションの中で変えた時間外の値で判定する（変更の後に同じ tx で呼ぶ）', async () => {
    const roomId = await newRoom();
    const { next } = await previousAndNext(roomId, null, null);

    await runInTransaction(db.prisma, async (tx) => {
      await tx.reservationRoom.update({
        where: { id: next.reservationRoomId },
        data: { earlyCheckinHour: 13 },
      });
      const result = await notices.checkTurnoverGap(tx, roomId, TURNOVER_DATE);
      expect(result.notice?.created).toBe(true);
    });
    expect(await openCount({ dedupeKey: `GAP:${roomId}:${TURNOVER_DATE}` })).toBe(1);
  });

  it('[10.11] TC-OP-121・122・123：未解決の間は1件にまとめ、解決した後は新しく作り、条件がなくなっても自動では解決しない', async () => {
    const roomId = await newRoom();
    const { next } = await previousAndNext(roomId, null, 13);
    const key = `GAP:${roomId}:${TURNOVER_DATE}`;
    const first = await notices.checkTurnoverGap(db.prisma, roomId, TURNOVER_DATE);
    expect(first.notice?.created).toBe(true);

    // TC-OP-121：アーリーを 12:00 に変えても、未解決のお知らせがあるので作らない（メッセージは最初のまま）
    await db.prisma.reservationRoom.update({
      where: { id: next.reservationRoomId },
      data: { earlyCheckinHour: 12 },
    });
    const merged = await notices.checkTurnoverGap(db.prisma, roomId, TURNOVER_DATE);
    expect(merged.notice).toEqual({ created: false, notice: first.notice?.notice });
    expect(await openCount({ dedupeKey: key })).toBe(1);

    // TC-OP-123：アーリーを「なし」にして空きが3時間になっても、未解決のお知らせはそのまま
    await db.prisma.reservationRoom.update({
      where: { id: next.reservationRoomId },
      data: { earlyCheckinHour: null },
    });
    const cleared = await notices.checkTurnoverGap(db.prisma, roomId, TURNOVER_DATE);
    expect(cleared.judgement).toMatchObject({ insufficient: false, gapMinutes: 180 });
    expect(cleared.notice).toBeNull();
    expect(await openCount({ dedupeKey: key })).toBe(1);

    // TC-OP-122：解決した後に、アーリー 12:00 で判定し直すと新しいお知らせ
    await notices.resolve(staffActor(frontStaff), first.notice?.notice.id ?? '');
    await db.prisma.reservationRoom.update({
      where: { id: next.reservationRoomId },
      data: { earlyCheckinHour: 12 },
    });
    const again = await notices.checkTurnoverGap(db.prisma, roomId, TURNOVER_DATE);
    expect(again.notice?.created).toBe(true);
    expect(again.notice?.notice.message).toContain('次の客のアーリーチェックイン 12:00');
    expect(await openCount({ dedupeKey: key })).toBe(1);
  });

  it('[10.11] レイトは前の客の出発日だけに当てる（途中で別の部屋へ移った客は 12:00 に出る）', async () => {
    const roomId = await newRoom();
    // 前の客は予約の出発日が 11/14 で、11/12 の夜から別の部屋へ移った（この部屋の夜は 11/11 まで）
    await createStay(roomId, {
      arrival: '2026-11-11',
      departure: TURNOVER_DATE,
      reservationDeparture: '2026-11-14',
      late: 15,
    });
    await createStay(roomId, { arrival: TURNOVER_DATE, departure: '2026-11-13' });

    const result = await notices.checkTurnoverGap(db.prisma, roomId, TURNOVER_DATE);
    expect(result.judgement).toMatchObject({
      checkout: { minutes: 12 * 60, late: false },
      gapMinutes: 180,
      insufficient: false,
    });
  });

  describe('予約の部屋の夜の切れ目をまとめて判定する（checkTurnoverGapsForReservation）', () => {
    // 部屋：P（11/11〜11/12・レイト14:00）→ X（11/12〜11/14・アーリー13:00・レイト13:00）→ Q（11/14〜11/15・アーリー14:00）
    async function threeStays(): Promise<{ roomId: string; target: Stay }> {
      const roomId = await newRoom();
      await createStay(roomId, { arrival: '2026-11-11', departure: '2026-11-12', late: 14 });
      const target = await createStay(roomId, {
        arrival: '2026-11-12',
        departure: '2026-11-14',
        early: 13,
        late: 13,
      });
      await createStay(roomId, { arrival: '2026-11-14', departure: '2026-11-15', early: 14 });
      return { roomId, target };
    }

    it('[10.11] 予約の確定・変更・移動の後：到着の日と出発の日の両方を判定する', async () => {
      const { roomId, target } = await threeStays();

      const checks = await runInTransaction(db.prisma, (tx) =>
        notices.checkTurnoverGapsForReservation(tx, target.reservationId),
      );

      expect(
        checks.map(({ roomId: room, date, judgement }) => ({ room, date, judgement })),
      ).toEqual([
        {
          room: roomId,
          date: '2026-11-12',
          judgement: expect.objectContaining({ gapMinutes: -60, insufficient: true }),
        },
        {
          room: roomId,
          date: '2026-11-14',
          judgement: expect.objectContaining({ gapMinutes: 60, insufficient: true }),
        },
      ]);
      expect(await openCount({ kind: 'TURNOVER_GAP' })).toBe(2);
    });

    it('[10.11] 時間外の変更の後：アーリーなら到着の日だけ、レイトなら出発の日だけを判定できる', async () => {
      const { roomId, target } = await threeStays();

      const arrivals = await notices.checkTurnoverGapsForReservation(
        db.prisma,
        target.reservationId,
        { edges: 'ARRIVAL', reservationRoomIds: [target.reservationRoomId] },
      );
      expect(arrivals.map((check) => [check.roomId, check.date])).toEqual([[roomId, '2026-11-12']]);
      expect(await openCount({ kind: 'TURNOVER_GAP' })).toBe(1);

      const departures = await notices.checkTurnoverGapsForReservation(
        db.prisma,
        target.reservationId,
        { edges: 'DEPARTURE' },
      );
      expect(departures.map((check) => [check.roomId, check.date])).toEqual([
        [roomId, '2026-11-14'],
      ]);
      expect(await openCount({ kind: 'TURNOVER_GAP' })).toBe(2);

      // ほかの予約の部屋だけを指定すれば、何も判定しない
      const none = await notices.checkTurnoverGapsForReservation(db.prisma, target.reservationId, {
        reservationRoomIds: [randomUUID()],
      });
      expect(none).toEqual([]);
    });

    it('同じ部屋・日付を2回指定しても1回だけ判定する', async () => {
      const { roomId } = await threeStays();
      const checks = await notices.checkTurnoverGaps(db.prisma, [
        { roomId, date: '2026-11-12' },
        { roomId, date: '2026-11-12' },
      ]);
      expect(checks).toHaveLength(1);
    });
  });
});

describe('[10.13][10.14][10.15] 未解決の件数・一覧と解決', () => {
  /** 未解決3件（3種類を1件ずつ）と解決済み2件（TC-OP-125 の前提） */
  async function fiveNotices() {
    const fragmented = await notices.recordFragmentedInventory(db.prisma, {
      roomTypeId: suiteId,
      arrivalDate: '2026-12-01',
      departureDate: '2026-12-03',
    });

    clock.advance(60_000);
    const splitRoomA = await newRoom();
    const splitRoomB = await newRoom();
    const split = await createStay(splitRoomA, { arrival: '2026-11-20', departure: '2026-11-21' });
    const splitSecond = await db.prisma.reservationRoom.create({
      data: {
        reservationId: split.reservationId,
        roomId: splitRoomB,
        currentRoomTypeId: standardKingId,
      },
      select: { id: true },
    });
    await addNights(splitSecond.id, splitRoomB, '2026-11-20', '2026-11-21');
    const splitFloors = await notices.recordSplitFloors(db.prisma, split.reservationId);

    clock.advance(60_000);
    const gapRoom = await newRoom();
    await createStay(gapRoom, { arrival: '2026-11-11', departure: '2026-11-12', late: 14 });
    await createStay(gapRoom, { arrival: '2026-11-12', departure: '2026-11-13' });
    const gap = await notices.checkTurnoverGap(db.prisma, gapRoom, '2026-11-12');

    clock.advance(60_000);
    const resolvedA = await notices.recordFragmentedInventory(db.prisma, {
      roomTypeId: standardKingId,
      arrivalDate: '2026-12-05',
      departureDate: '2026-12-07',
    });
    const resolvedB = await notices.recordFragmentedInventory(db.prisma, {
      roomTypeId: standardKingId,
      arrivalDate: '2026-12-08',
      departureDate: '2026-12-10',
    });
    await notices.resolve(staffActor(frontStaff), resolvedA.notice.id);
    await notices.resolve(staffActor(frontStaff), resolvedB.notice.id);
    clock.set(NOW);

    return {
      fragmented: fragmented.notice,
      splitFloors: splitFloors.notice,
      splitReservationId: split.reservationId,
      gap: gap.notice?.notice,
      gapRoom,
    };
  }

  it('[10.13] TC-OP-125：未解決の件数は、解決していないお知らせの数（解決済みは数えない）', async () => {
    await fiveNotices();
    expect(await notices.countOpen()).toBe(3);
  });

  it('[10.14] TC-OP-127：一覧は未解決のお知らせだけを新しい順に、種類・対象・作成日時・メッセージとともに返す', async () => {
    const { fragmented, splitFloors, splitReservationId, gap, gapRoom } = await fiveNotices();
    const reservation = await db.prisma.reservation.findUniqueOrThrow({
      where: { id: splitReservationId },
      select: { reservationNumber: true },
    });
    const gapRoomRow = await db.prisma.room.findUniqueOrThrow({
      where: { id: gapRoom },
      select: { roomNumber: true },
    });

    const list = await notices.listOpen();

    expect(list.map((notice) => notice.id)).toEqual([gap?.id, splitFloors.id, fragmented.id]);
    expect(list[0]).toEqual({
      id: gap?.id,
      kind: 'TURNOVER_GAP',
      message: gap?.message,
      roomTypeId: null,
      roomTypeName: null,
      roomId: gapRoom,
      roomNumber: gapRoomRow.roomNumber,
      reservationId: null,
      reservationNumber: null,
      dateFrom: '2026-11-12',
      dateTo: '2026-11-12',
      createdAt: new Date(new Date(NOW).getTime() + 120_000),
    });
    expect(list[1]).toMatchObject({
      kind: 'SPLIT_FLOORS',
      reservationId: splitReservationId,
      reservationNumber: reservation.reservationNumber,
      roomTypeName: 'スタンダード キング',
      createdAt: new Date(new Date(NOW).getTime() + 60_000),
    });
    expect(list[2]).toMatchObject({
      kind: 'FRAGMENTED_INVENTORY',
      roomTypeId: suiteId,
      roomTypeName: 'スイート',
      roomNumber: null,
      reservationNumber: null,
      dateFrom: '2026-12-01',
      dateTo: '2026-12-03',
      createdAt: new Date(NOW),
    });
  });

  it('[10.15] TC-OP-130・131・TC-MB-383：解決すると resolved_at・resolved_by と操作履歴1行が記録され、件数と一覧から消える', async () => {
    const { gap } = await fiveNotices();
    const auditBefore = await countAuditLogs(db.prisma, { action: 'NOTICE_RESOLVE' });
    clock.set('2026-11-10T10:30:00+09:00');

    const result = await notices.resolve(staffActor(frontStaff), gap?.id ?? '');

    expect(result.changed).toBe(true);
    expect(result.notice).toMatchObject({
      id: gap?.id,
      resolvedAt: new Date('2026-11-10T10:30:00+09:00'),
      resolvedBy: frontStaff.staffId,
    });
    const stored = await db.prisma.notice.findUniqueOrThrow({ where: { id: gap?.id ?? '' } });
    expect(stored.resolvedAt).toEqual(new Date('2026-11-10T10:30:00+09:00'));
    expect(stored.resolvedBy).toBe(frontStaff.staffId);

    const audits = await listAuditLogs(db.prisma, { targetId: gap?.id ?? '' });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      staffId: frontStaff.staffId,
      actorLabel: 'S101',
      action: 'NOTICE_RESOLVE',
      targetType: 'notice',
      targetId: gap?.id,
      at: new Date('2026-11-10T10:30:00+09:00'),
    });
    expect(await countAuditLogs(db.prisma, { action: 'NOTICE_RESOLVE' })).toBe(auditBefore + 1);

    expect(await notices.countOpen()).toBe(2);
    expect((await notices.listOpen()).map((notice) => notice.id)).not.toContain(gap?.id);
  });

  it('[10.15] 解決済みのお知らせをもう一度解決しても変わらない（最初の解決の時刻・人のまま、操作履歴も増えない）', async () => {
    const { fragmented } = await fiveNotices();
    const first = await notices.resolve(staffActor(frontStaff), fragmented.id);
    const otherStaffId = await insertStaff(db.prisma, {
      staffNumber: 'S102',
      role: 'FRONT',
      passwordHash: 'argon2id$dummy',
    });
    const auditBefore = await countAuditLogs(db.prisma);
    clock.advance(60_000);

    const second = await notices.resolve(
      staffActor({ staffId: otherStaffId, staffNumber: 'S102' }),
      fragmented.id,
    );

    expect(second).toEqual({ changed: false, notice: first.notice });
    expect(await countAuditLogs(db.prisma)).toBe(auditBefore);
  });

  it('[10.15] ないお知らせ（ID の形が違うものを含む）の解決は NOT_FOUND で、操作履歴を残さない', async () => {
    const auditBefore = await countAuditLogs(db.prisma);
    for (const id of [randomUUID(), 'not-a-uuid']) {
      const error = await notices.resolve(staffActor(frontStaff), id).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BusinessError);
      expect(error).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(await countAuditLogs(db.prisma)).toBe(auditBefore);
  });
});
