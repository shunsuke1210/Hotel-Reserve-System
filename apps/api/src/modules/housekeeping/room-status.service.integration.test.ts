// 部屋の状態の変更（RoomStatusService。tasks.md 3.7、design.md P-12・P-10・P-13、設計の補足 L-23・L-42・DT-M14）を、
// テスト用のデータベースと社内用の待ち受け口で確かめる。
// - スタッフの手動の変更（POST /rooms/{id}/status：7.11 のコントローラーが呼ぶ）：役割のルール（canChangeManually）、
//   status_changed_at・status_changed_by と操作履歴 ROOM_STATUS_CHANGE（TC-OP-214・TC-MB-385）、同時の変更
// - 業務の操作の入口（チェックイン 7.7・チェックアウト 7.8・故障中 7.9・9:00 の処理 7.12・移動 DT-M14）：
//   呼び出し側のトランザクションの中で変え、操作履歴は書かずに変化を返す（呼び出し側の1行の detail に入る：L-42）
// HTTP の経路は、テスト用のコントローラー（7.11 の API の代わり）で、清掃員・フロントのセッションから確かめる。
// 部屋番号はテストケースの説明用の値（501 など）から始めて、テストごとに別の部屋を作る（この DB には初期データの部屋がない）。
import { ERROR_HTTP_STATUS, type RoomStatus } from '@hotel/contracts';
import { Body, Controller, type INestApplication, Param, Post } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { staffActor, systemActor } from '../../shared/audit/audit-entry.js';
import { AuditLogService } from '../../shared/audit/audit-log.service.js';
import { FixedBusinessClock } from '../../shared/clock/business-clock.js';
import { BusinessError } from '../../shared/errors/business-error.js';
import { runInTransaction, type TransactionClient } from '../../shared/prisma/transaction.js';
import { CurrentStaff, type StaffPrincipal } from '../../shared/session/principals.js';
import { countAuditLogs, listAuditLogs } from '../../test/audit.js';
import { insertStaff } from '../../test/auth/fixtures.js';
import { CSRF_HEADERS, signIn } from '../../test/auth/sessions.js';
import { createTestDatabase, type TestDatabase } from '../../test/database/test-database.js';
import { createTestListenerApp } from '../../test/listener-app.js';
import { RoomStatusService, RoomStatusTransitionError } from './room-status.service.js';

const NOW = '2026-11-10T10:00:00+09:00';
/** 部屋を作ったときの「最後に変えた時刻」（変わっていないことを確かめるため、NOW と違う値にする） */
const CREATED_AT = new Date('2026-11-09T08:00:00+09:00');

/** 7.11 の POST /rooms/{id}/status の代わり（役割の指定なし＝清掃員以上） */
@Controller('test-room-status')
class RoomStatusTestController {
  constructor(private readonly moduleRef: ModuleRef) {}

  @Post(':id')
  change(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id') roomId: string,
    @Body() body: { to: RoomStatus },
  ) {
    return this.moduleRef
      .get(RoomStatusService, { strict: false })
      .changeByStaff(staff, roomId, body.to);
  }
}

let db: TestDatabase;
let app: INestApplication;
let clock: FixedBusinessClock;
let service: RoomStatusService;
let audit: AuditLogService;
let roomTypeId: string;
let cleaner: StaffPrincipal;
let cleaner2: StaffPrincipal;
let front: StaffPrincipal;
let admin: StaffPrincipal;

beforeAll(async () => {
  db = await createTestDatabase();
  clock = new FixedBusinessClock(NOW);
  app = await createTestListenerApp('staff', {
    prisma: db.prisma,
    clock,
    controllers: [RoomStatusTestController],
  });
  service = app.get(RoomStatusService);
  audit = app.get(AuditLogService);
  const roomType = await db.prisma.roomType.create({
    data: {
      code: 'STANDARD_KING',
      nameJa: 'スタンダード キング',
      areaSqm: 20,
      bedDescriptionJa: 'キング1台',
      capacityAdults: 2,
      standardOccupancy: 2,
      displayOrder: 1,
      descriptionJa: 'テスト用',
    },
    select: { id: true },
  });
  roomTypeId = roomType.id;
  const staffOf = async (staffNumber: string, role: StaffPrincipal['role']) => {
    // ログインの API を通さない（signIn）ので、パスワードのハッシュは使わない
    const staffId = await insertStaff(db.prisma, { staffNumber, role, passwordHash: 'unused' });
    return { staffId, staffNumber, role };
  };
  cleaner = await staffOf('S201', 'CLEANER');
  cleaner2 = await staffOf('S202', 'CLEANER');
  front = await staffOf('S101', 'FRONT');
  admin = await staffOf('S001', 'ADMIN');
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

beforeEach(() => {
  clock.set(NOW);
});

let nextRoomNumber = 501;

/** 部屋を1つ作る（テストごとに別の部屋。最後に変えた時刻は CREATED_AT、変えた人は空） */
async function createRoom(status: RoomStatus): Promise<string> {
  const roomNumber = nextRoomNumber++;
  const row = await db.prisma.room.create({
    data: {
      roomNumber,
      floor: Math.floor(roomNumber / 100),
      roomTypeId,
      isAccessible: false,
      status,
      statusChangedAt: CREATED_AT,
    },
    select: { id: true },
  });
  return row.id;
}

function roomOf(roomId: string) {
  return db.prisma.room.findUniqueOrThrow({
    where: { id: roomId },
    select: { roomNumber: true, status: true, statusChangedAt: true, statusChangedBy: true },
  });
}

/** promise が失敗したときの例外（成功したらテストを失敗させる） */
async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('例外になりませんでした');
}

/** 行のロックを待っている接続の数 */
async function lockWaiterCount(): Promise<number> {
  const rows = await db.prisma.$queryRaw<{ waiting: number }[]>`
    SELECT count(*)::int AS waiting FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'`;
  return rows[0]?.waiting ?? 0;
}

/** 行のロックを待っている接続の数が count 以上になるまで待つ（同時の操作の順番を決めるため） */
async function waitForLockWaiters(count: number): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if ((await lockWaiterCount()) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`ロックを待つ接続が ${count} になりませんでした`);
}

/**
 * 部屋の行のロック（$queryRaw）の2回目の前に beforeSecondLock を待つトランザクションのクライアント
 * （1室目をロックした後、2室目をロックする前に止めて、2つの操作のロックの順番を決めるため）。ほかの操作はそのまま通す
 */
function pausingBeforeSecondLock(
  tx: TransactionClient,
  beforeSecondLock: () => Promise<void>,
): TransactionClient {
  let lockQueries = 0;
  return new Proxy(tx, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (property !== '$queryRaw' || typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        lockQueries += 1;
        if (lockQueries === 2) await beforeSecondLock();
        return (value as (...queryArgs: unknown[]) => Promise<unknown>).apply(target, args);
      };
    },
  });
}

/** 外から部屋の行をロックしておき、release() で放す（ロックを取ったら resolve する） */
async function holdRoomLock(roomId: string): Promise<{ release: () => Promise<void> }> {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked: () => void = () => undefined;
  const hasLock = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const holder = runInTransaction(db.prisma, async (tx) => {
    await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${roomId}::uuid FOR NO KEY UPDATE`;
    locked();
    await released;
  });
  await hasLock;
  return {
    release: async () => {
      release();
      await holder;
    },
  };
}

describe('スタッフの手動の変更（changeByStaff。POST /rooms/{id}/status が呼ぶ）', () => {
  it.each([
    ['TC-OP-183', 'CLEANING_READY', 'CLEANING'],
    ['TC-OP-184', 'CLEANING', 'INSPECTION'],
    ['TC-OP-185', 'INSPECTION', 'CLEAN'],
    ['TC-OP-186', 'CLEANING_READY', 'CLEAN'],
    ['TC-OP-187', 'CLEAN', 'CLEANING'],
    ['TC-OP-188', 'STAY_DIRTY', 'STAY_CLEANING'],
    ['TC-OP-189', 'STAY_CLEANING', 'STAY_INSPECTION'],
    ['TC-OP-190', 'STAY_INSPECTION', 'STAY_CLEAN'],
    ['TC-OP-191', 'STAY_DIRTY', 'STAY_CLEAN'],
    ['TC-OP-192', 'STAY_CLEAN', 'STAY_DIRTY'],
  ] as const)(
    '[12.2] %s：清掃員は同じグループの中で %s → %s に変えられる',
    async (_id, from, to) => {
      const roomId = await createRoom(from);

      const result = await service.changeByStaff(cleaner, roomId, to);

      expect(result.changed).toBe(true);
      expect(result.room).toMatchObject({ roomId, status: to, statusChangedBy: cleaner.staffId });
      await expect(roomOf(roomId)).resolves.toMatchObject({
        status: to,
        statusChangedAt: new Date(NOW),
        statusChangedBy: cleaner.staffId,
      });
      expect(await countAuditLogs(db.prisma, { targetId: roomId })).toBe(1);
    },
  );

  it('[12.7][12.3] TC-OP-200：清掃員は「来客なし」→「清掃完了」に変えられる（グループをまたぐ変更の例外）', async () => {
    const roomId = await createRoom('NO_ARRIVAL');

    const result = await service.changeByStaff(cleaner, roomId, 'CLEAN');

    expect(result.changed).toBe(true);
    await expect(roomOf(roomId)).resolves.toMatchObject({ status: 'CLEAN' });
  });

  it.each([
    ['TC-OP-193', 'CLEAN', 'STAY_CLEAN', 'CROSS_GROUP'],
    ['TC-OP-194', 'STAY_CLEAN', 'CLEAN', 'CROSS_GROUP'],
    ['TC-OP-195', 'DEPARTURE_PENDING', 'CLEANING_READY', 'CROSS_GROUP'],
    ['TC-OP-196', 'CLEAN', 'CHECKED_IN', 'CROSS_GROUP'],
    ['TC-OP-197', 'STAY_DIRTY', 'DEPARTURE_PENDING', 'CROSS_GROUP'],
    ['TC-OP-198', 'CHECKED_IN', 'DEPARTURE_PENDING', 'OTHER_GROUP'],
    ['TC-OP-199', 'NO_ARRIVAL', 'CLEANING_READY', 'NO_ARRIVAL_ONLY_TO_CLEAN'],
    ['TC-OP-201', 'OUT_OF_ORDER', 'CLEAN', 'OUT_OF_ORDER'],
    ['TC-OP-202', 'CLEAN', 'OUT_OF_ORDER', 'OUT_OF_ORDER'],
    ['TC-OP-272', 'OUT_OF_ORDER', 'CHECKED_IN', 'OUT_OF_ORDER'],
    ['TC-OP-273', 'NO_ARRIVAL', 'DEPARTURE_PENDING', 'NO_ARRIVAL_ONLY_TO_CLEAN'],
  ] as const)(
    '[12.2][12.3] %s：清掃員の %s → %s は STATUS_TRANSITION_NOT_ALLOWED（%s）で、状態も記録も変わらない',
    async (_id, from, to, reason) => {
      const roomId = await createRoom(from);

      const error = await errorOf(service.changeByStaff(cleaner, roomId, to));

      expect(error).toBeInstanceOf(BusinessError);
      expect(error).toMatchObject({
        code: 'STATUS_TRANSITION_NOT_ALLOWED',
        details: { reason, from, to },
      });
      expect(ERROR_HTTP_STATUS[(error as BusinessError).code]).toBe(422);
      await expect(roomOf(roomId)).resolves.toMatchObject({
        status: from,
        statusChangedAt: CREATED_AT,
        statusChangedBy: null,
      });
      // 失敗した操作は記録しない（TC-MB-219）
      expect(await countAuditLogs(db.prisma, { targetId: roomId })).toBe(0);
    },
  );

  it.each([
    ['TC-OP-207', 'FRONT', 'DEPARTURE_PENDING', 'CLEANING_READY'],
    ['TC-OP-208', 'FRONT', 'CLEANING_READY', 'DEPARTURE_PENDING'],
    ['TC-OP-209', 'FRONT', 'NO_ARRIVAL', 'CLEANING_READY'],
    ['TC-OP-210', 'FRONT', 'STAY_CLEAN', 'CHECKED_IN'],
    ['TC-OP-211', 'ADMIN', 'CLEAN', 'STAY_DIRTY'],
    ['TC-OP-274', 'FRONT', 'CHECKED_IN', 'DEPARTURE_PENDING'],
  ] as const)(
    '[12.4] %s：%s はグループをまたいで・「その他」の中で %s → %s に変えられる',
    async (_id, role, from, to) => {
      const staff = role === 'ADMIN' ? admin : front;
      const roomId = await createRoom(from);

      const result = await service.changeByStaff(staff, roomId, to);

      expect(result.changed).toBe(true);
      await expect(roomOf(roomId)).resolves.toMatchObject({
        status: to,
        statusChangedBy: staff.staffId,
      });
    },
  );

  it('[12.4][L-23] TC-OP-212：フロントでも故障中には変えられない（STATUS_TRANSITION_NOT_ALLOWED。故障中の期間もできない）', async () => {
    const roomId = await createRoom('CLEAN');

    const error = await errorOf(service.changeByStaff(front, roomId, 'OUT_OF_ORDER'));

    expect(error).toMatchObject({
      code: 'STATUS_TRANSITION_NOT_ALLOWED',
      details: { reason: 'OUT_OF_ORDER' },
    });
    await expect(roomOf(roomId)).resolves.toMatchObject({ status: 'CLEAN' });
    expect(await db.prisma.outOfOrderPeriod.count({ where: { roomId } })).toBe(0);
  });

  it('[12.4][L-23] TC-OP-213：フロントでも故障中から清掃完了には戻せない（STATUS_TRANSITION_NOT_ALLOWED）', async () => {
    const roomId = await createRoom('OUT_OF_ORDER');

    const error = await errorOf(service.changeByStaff(admin, roomId, 'CLEAN'));

    expect(error).toMatchObject({
      code: 'STATUS_TRANSITION_NOT_ALLOWED',
      details: { reason: 'OUT_OF_ORDER' },
    });
    await expect(roomOf(roomId)).resolves.toMatchObject({ status: 'OUT_OF_ORDER' });
  });

  it('[12.2][18.1] TC-OP-214：変更の時刻と変えた人を rooms に、スタッフ番号・日時・内容を操作履歴に1行だけ記録する', async () => {
    const roomId = await createRoom('CLEANING_READY');
    clock.set('2026-11-10T10:15:30+09:00');
    const before = await countAuditLogs(db.prisma);

    const result = await service.changeByStaff(cleaner, roomId, 'CLEANING');

    const at = new Date('2026-11-10T10:15:30+09:00');
    const room = await roomOf(roomId);
    expect(room).toEqual({
      roomNumber: room.roomNumber,
      status: 'CLEANING',
      statusChangedAt: at,
      statusChangedBy: cleaner.staffId,
    });
    expect(result).toEqual({
      changed: true,
      room: {
        roomId,
        roomNumber: room.roomNumber,
        status: 'CLEANING',
        statusChangedAt: at,
        statusChangedBy: cleaner.staffId,
      },
    });
    expect(await countAuditLogs(db.prisma)).toBe(before + 1);
    const rows = await listAuditLogs(db.prisma, { targetId: roomId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      staffId: cleaner.staffId,
      actorLabel: 'S201',
      action: 'ROOM_STATUS_CHANGE',
      targetType: 'room',
      targetId: roomId,
      at,
      detail: { roomStatusChanges: [{ roomId, from: 'CLEANING_READY', to: 'CLEANING' }] },
    });
  });

  it('[12.4][18.1] TC-MB-385：フロントのグループをまたぐ変更（チェックアウト待ち → 清掃可）も、操作履歴に残る', async () => {
    const roomId = await createRoom('DEPARTURE_PENDING');

    await service.changeByStaff(front, roomId, 'CLEANING_READY');

    const rows = await listAuditLogs(db.prisma, { targetId: roomId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      staffId: front.staffId,
      actorLabel: 'S101',
      action: 'ROOM_STATUS_CHANGE',
      at: new Date(NOW),
      detail: {
        roomStatusChanges: [{ roomId, from: 'DEPARTURE_PENDING', to: 'CLEANING_READY' }],
      },
    });
  });

  it('同じ状態への変更（ボタンの二度押しなど）は、何も変えずに成功する（changed: false。時刻・変えた人・操作履歴は変わらない）', async () => {
    const roomId = await createRoom('CLEANING');

    const result = await service.changeByStaff(cleaner, roomId, 'CLEANING');

    expect(result).toMatchObject({
      changed: false,
      room: { roomId, status: 'CLEANING', statusChangedAt: CREATED_AT, statusChangedBy: null },
    });
    await expect(roomOf(roomId)).resolves.toMatchObject({
      status: 'CLEANING',
      statusChangedAt: CREATED_AT,
      statusChangedBy: null,
    });
    expect(await countAuditLogs(db.prisma, { targetId: roomId })).toBe(0);
  });

  it('ない部屋・UUID でない ID は NOT_FOUND', async () => {
    await expect(
      errorOf(service.changeByStaff(front, randomUUID(), 'CLEAN')),
    ).resolves.toMatchObject({ code: 'NOT_FOUND' });
    await expect(errorOf(service.changeByStaff(front, '501', 'CLEAN'))).resolves.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('部屋の状態でない値は VALIDATION_FAILED で、何も変えない', async () => {
    const roomId = await createRoom('CLEAN');

    const error = await errorOf(service.changeByStaff(front, roomId, 'DIRTY' as RoomStatus));

    expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(roomOf(roomId)).resolves.toMatchObject({ status: 'CLEAN' });
  });

  it('同じ部屋を2人が同時に変えると、行のロックで1つずつ行われ、後の変更は先の変更の後の状態から変える', async () => {
    const roomId = await createRoom('CLEANING_READY');
    const lock = await holdRoomLock(roomId);

    const first = service.changeByStaff(cleaner, roomId, 'CLEANING');
    const second = service.changeByStaff(cleaner2, roomId, 'INSPECTION');
    await waitForLockWaiters(2);
    await lock.release();
    const results = await Promise.all([first, second]);

    expect(results.map((result) => result.changed)).toEqual([true, true]);
    const changes = (await listAuditLogs(db.prisma, { targetId: roomId })).map(
      (row) =>
        (row.detail as { roomStatusChanges: { from: RoomStatus; to: RoomStatus }[] })
          .roomStatusChanges[0]!,
    );
    expect(changes).toHaveLength(2);
    // 先に行われた変更は清掃可から、後の変更は先の変更の後の状態から（両方が清掃可から変えたことにならない）
    const earlier = changes.find((change) => change.from === 'CLEANING_READY');
    const later = changes.find((change) => change !== earlier);
    expect(earlier).toBeDefined();
    expect(later?.from).toBe(earlier?.to);
    await expect(roomOf(roomId)).resolves.toMatchObject({ status: later?.to });
  });
});

describe('業務の操作の入口（applyOperation。チェックイン・チェックアウト・故障中・9:00 の処理が呼ぶ）', () => {
  it('[11.3][L-42] TC-MB-373：チェックインの処理の中で 清掃完了 → チェックイン済み にし、呼び出し側の操作履歴の1行の detail に入る', async () => {
    const roomId = await createRoom('CLEAN');
    const reservationId = randomUUID();
    const at = new Date('2026-11-10T15:00:00+09:00');
    const before = await countAuditLogs(db.prisma);

    const changes = await runInTransaction(db.prisma, async (tx) => {
      const result = await service.applyOperation(
        tx,
        staffActor(front),
        'CHECK_IN',
        [{ roomId, to: 'CHECKED_IN' }],
        { at },
      );
      await audit.record(tx, staffActor(front), {
        action: 'CHECK_IN',
        target: { type: 'reservation', id: reservationId },
        detail: { roomStatusChanges: result },
        at,
      });
      return result;
    });

    expect(changes).toEqual([{ roomId, from: 'CLEAN', to: 'CHECKED_IN' }]);
    await expect(roomOf(roomId)).resolves.toMatchObject({
      status: 'CHECKED_IN',
      statusChangedAt: at,
      statusChangedBy: front.staffId,
    });
    // 操作履歴は1行だけ増え、部屋の状態の変更の行を別に作らない
    expect(await countAuditLogs(db.prisma)).toBe(before + 1);
    expect(await countAuditLogs(db.prisma, { targetId: roomId })).toBe(0);
    const rows = await listAuditLogs(db.prisma, { targetId: reservationId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      staffId: front.staffId,
      actorLabel: 'S101',
      action: 'CHECK_IN',
      targetType: 'reservation',
      at,
      detail: { roomStatusChanges: [{ roomId, from: 'CLEAN', to: 'CHECKED_IN' }] },
    });
  });

  it('[11.3][L-42] TC-MB-400：2室のチェックインでも操作履歴は1行で、2室の変更がその detail に入る', async () => {
    const roomA = await createRoom('CLEAN');
    const roomB = await createRoom('CLEAN');
    const reservationId = randomUUID();

    await runInTransaction(db.prisma, async (tx) => {
      const changes = await service.applyOperation(tx, staffActor(front), 'CHECK_IN', [
        { roomId: roomA, to: 'CHECKED_IN' },
        { roomId: roomB, to: 'CHECKED_IN' },
      ]);
      await audit.record(tx, staffActor(front), {
        action: 'CHECK_IN',
        target: { type: 'reservation', id: reservationId },
        detail: { roomStatusChanges: changes },
      });
    });

    const rows = await listAuditLogs(db.prisma, { targetId: reservationId });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toEqual({
      roomStatusChanges: [
        { roomId: roomA, from: 'CLEAN', to: 'CHECKED_IN' },
        { roomId: roomB, from: 'CLEAN', to: 'CHECKED_IN' },
      ],
    });
    await expect(roomOf(roomA)).resolves.toMatchObject({ status: 'CHECKED_IN' });
    await expect(roomOf(roomB)).resolves.toMatchObject({ status: 'CHECKED_IN' });
  });

  it('[L-42] 入口は自分では操作履歴を書かない（呼び出し側がその後に1行を記録できる）', async () => {
    const roomId = await createRoom('CLEAN');
    const before = await countAuditLogs(db.prisma);

    await runInTransaction(db.prisma, (tx) =>
      service.applyOperation(tx, staffActor(front), 'CHECK_IN', [{ roomId, to: 'CHECKED_IN' }]),
    );

    expect(await countAuditLogs(db.prisma)).toBe(before);
    await expect(roomOf(roomId)).resolves.toMatchObject({ status: 'CHECKED_IN' });
  });

  it('業務の操作のトランザクションの外（PrismaService）から呼ぶと断る', async () => {
    const roomId = await createRoom('CLEAN');

    await expect(
      service.applyOperation(db.prisma, staffActor(front), 'CHECK_IN', [
        { roomId, to: 'CHECKED_IN' },
      ]),
    ).rejects.toThrow(/トランザクション/);
    await expect(roomOf(roomId)).resolves.toMatchObject({ status: 'CLEAN' });
  });

  it('[11.2] チェックイン：清掃完了でない部屋があれば ROOM_NOT_CLEAN で、ほかの部屋も変えない', async () => {
    const clean = await createRoom('CLEAN');
    const cleaning = await createRoom('CLEANING');
    const cleaningRoom = await roomOf(cleaning);

    const error = await errorOf(
      runInTransaction(db.prisma, (tx) =>
        service.applyOperation(tx, staffActor(front), 'CHECK_IN', [
          { roomId: clean, to: 'CHECKED_IN' },
          { roomId: cleaning, to: 'CHECKED_IN' },
        ]),
      ),
    );

    expect(error).toBeInstanceOf(BusinessError);
    expect(error).toMatchObject({
      code: 'ROOM_NOT_CLEAN',
      details: { roomId: cleaning, roomNumber: cleaningRoom.roomNumber, status: 'CLEANING' },
    });
    await expect(roomOf(clean)).resolves.toMatchObject({ status: 'CLEAN' });
    await expect(roomOf(cleaning)).resolves.toMatchObject({ status: 'CLEANING' });
  });

  it('[DT-M14] チェックイン後の故障による移動：移し先の清掃完了の部屋をチェックイン済みにする（清掃完了でなければ ROOM_NOT_CLEAN）', async () => {
    const target = await createRoom('CLEAN');
    const notClean = await createRoom('INSPECTION');

    const changes = await runInTransaction(db.prisma, (tx) =>
      service.applyOperation(tx, staffActor(front), 'ROOM_MOVE', [
        { roomId: target, to: 'CHECKED_IN' },
      ]),
    );
    expect(changes).toEqual([{ roomId: target, from: 'CLEAN', to: 'CHECKED_IN' }]);

    await expect(
      errorOf(
        runInTransaction(db.prisma, (tx) =>
          service.applyOperation(tx, staffActor(front), 'ROOM_MOVE', [
            { roomId: notClean, to: 'CHECKED_IN' },
          ]),
        ),
      ),
    ).resolves.toMatchObject({ code: 'ROOM_NOT_CLEAN' });
  });

  it('[11.8][13.6] TC-MB-374：チェックアウト：チェックアウト待ち・チェックイン済み・連泊グループ → 清掃可、今日から故障中の部屋 → 故障中、故障中の部屋はそのまま', async () => {
    const departurePending = await createRoom('DEPARTURE_PENDING');
    const stayCleaning = await createRoom('STAY_CLEANING');
    const checkedIn = await createRoom('CHECKED_IN');
    const outOfOrder = await createRoom('OUT_OF_ORDER');

    const changes = await runInTransaction(db.prisma, (tx) =>
      service.applyOperation(tx, staffActor(front), 'CHECK_OUT', [
        { roomId: departurePending, to: 'CLEANING_READY' },
        { roomId: stayCleaning, to: 'CLEANING_READY' },
        { roomId: checkedIn, to: 'OUT_OF_ORDER' },
        { roomId: outOfOrder, to: 'OUT_OF_ORDER' },
      ]),
    );

    // 変わらなかった部屋（故障中のまま）は返さない
    expect(changes).toEqual([
      { roomId: departurePending, from: 'DEPARTURE_PENDING', to: 'CLEANING_READY' },
      { roomId: stayCleaning, from: 'STAY_CLEANING', to: 'CLEANING_READY' },
      { roomId: checkedIn, from: 'CHECKED_IN', to: 'OUT_OF_ORDER' },
    ]);
    await expect(roomOf(outOfOrder)).resolves.toMatchObject({
      status: 'OUT_OF_ORDER',
      statusChangedAt: CREATED_AT,
    });
    await expect(roomOf(checkedIn)).resolves.toMatchObject({ status: 'OUT_OF_ORDER' });
  });

  it('チェックアウト：P-12 にない変更（清掃完了 → 清掃可）を求めたら呼び出し側の誤り（RoomStatusTransitionError）で、何も変えない', async () => {
    const departurePending = await createRoom('DEPARTURE_PENDING');
    const clean = await createRoom('CLEAN');

    const error = await errorOf(
      runInTransaction(db.prisma, (tx) =>
        service.applyOperation(tx, staffActor(front), 'CHECK_OUT', [
          { roomId: departurePending, to: 'CLEANING_READY' },
          { roomId: clean, to: 'CLEANING_READY' },
        ]),
      ),
    );

    expect(error).toBeInstanceOf(RoomStatusTransitionError);
    expect(error).toMatchObject({
      operation: 'CHECK_OUT',
      roomId: clean,
      from: 'CLEAN',
      to: 'CLEANING_READY',
    });
    await expect(roomOf(departurePending)).resolves.toMatchObject({
      status: 'DEPARTURE_PENDING',
    });
  });

  it('[13.1][13.4][13.7] 故障中の設定はどの状態からでも（役割のルールを通さない）、修理の完了は故障中 → 清掃完了だけ', async () => {
    const staying = await createRoom('CHECKED_IN');

    const started = await runInTransaction(db.prisma, (tx) =>
      service.applyOperation(tx, staffActor(front), 'OUT_OF_ORDER_START', [
        { roomId: staying, to: 'OUT_OF_ORDER' },
      ]),
    );
    expect(started).toEqual([{ roomId: staying, from: 'CHECKED_IN', to: 'OUT_OF_ORDER' }]);

    const ended = await runInTransaction(db.prisma, (tx) =>
      service.applyOperation(tx, staffActor(front), 'OUT_OF_ORDER_END', [
        { roomId: staying, to: 'CLEAN' },
      ]),
    );
    expect(ended).toEqual([{ roomId: staying, from: 'OUT_OF_ORDER', to: 'CLEAN' }]);
    await expect(roomOf(staying)).resolves.toMatchObject({
      status: 'CLEAN',
      statusChangedBy: front.staffId,
    });

    const notOutOfOrder = await createRoom('CHECKED_IN');
    await expect(
      errorOf(
        runInTransaction(db.prisma, (tx) =>
          service.applyOperation(tx, staffActor(front), 'OUT_OF_ORDER_END', [
            { roomId: notOutOfOrder, to: 'CLEAN' },
          ]),
        ),
      ),
    ).resolves.toBeInstanceOf(RoomStatusTransitionError);
  });

  it('[12.5][12.6] 9:00 の処理：定時処理として変え（変えた人は空）、清掃有（連泊）のままの部屋は変えない。定時処理の1行の detail に入る', async () => {
    const departing = await createRoom('CHECKED_IN');
    const notCleaned = await createRoom('STAY_DIRTY');
    const noShow = await createRoom('CLEAN');
    const ctx = { job: 'morning-status', runId: randomUUID() };
    const at = new Date('2026-11-11T09:00:00+09:00');

    const results = [];
    for (const [roomId, to] of [
      [departing, 'DEPARTURE_PENDING'],
      [notCleaned, 'STAY_DIRTY'],
      [noShow, 'NO_ARRIVAL'],
    ] as const) {
      results.push(
        await runInTransaction(db.prisma, async (tx) => {
          const changes = await service.applyOperation(
            tx,
            systemActor(ctx),
            'MORNING_STATUS',
            [{ roomId, to }],
            { at },
          );
          if (changes.length > 0) {
            await audit.record(tx, systemActor(ctx), {
              action: 'ROOM_STATUS_CHANGE',
              target: { type: 'room', id: roomId },
              detail: { roomStatusChanges: changes },
              at,
            });
          }
          return changes;
        }),
      );
    }

    expect(results).toEqual([
      [{ roomId: departing, from: 'CHECKED_IN', to: 'DEPARTURE_PENDING' }],
      [],
      [{ roomId: noShow, from: 'CLEAN', to: 'NO_ARRIVAL' }],
    ]);
    await expect(roomOf(departing)).resolves.toMatchObject({
      status: 'DEPARTURE_PENDING',
      statusChangedAt: at,
      statusChangedBy: null,
    });
    await expect(roomOf(notCleaned)).resolves.toMatchObject({
      status: 'STAY_DIRTY',
      statusChangedAt: CREATED_AT,
    });
    const rows = await listAuditLogs(db.prisma, { targetId: departing });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      staffId: null,
      actorLabel: 'SYSTEM:morning-status',
      action: 'ROOM_STATUS_CHANGE',
      detail: {
        roomStatusChanges: [{ roomId: departing, from: 'CHECKED_IN', to: 'DEPARTURE_PENDING' }],
        jobRunId: ctx.runId,
      },
    });
    expect(await countAuditLogs(db.prisma, { targetId: notCleaned })).toBe(0);
  });

  it('操作した人の種類が操作に合わなければ断る（9:00 の処理は定時処理、ほかはスタッフ）', async () => {
    const roomId = await createRoom('CHECKED_IN');
    const ctx = { job: 'morning-status', runId: randomUUID() };

    await expect(
      runInTransaction(db.prisma, (tx) =>
        service.applyOperation(tx, staffActor(front), 'MORNING_STATUS', [
          { roomId, to: 'DEPARTURE_PENDING' },
        ]),
      ),
    ).rejects.toThrow(Error);
    await expect(
      runInTransaction(db.prisma, (tx) =>
        service.applyOperation(tx, systemActor(ctx), 'CHECK_OUT', [
          { roomId, to: 'CLEANING_READY' },
        ]),
      ),
    ).rejects.toThrow(Error);
    await expect(roomOf(roomId)).resolves.toMatchObject({ status: 'CHECKED_IN' });
  });

  it('その操作が変える先でない状態・同じ部屋の重複・UUID でない部屋の ID は RangeError、ない部屋は Error', async () => {
    const roomId = await createRoom('CLEAN');
    const run = (changes: { roomId: string; to: RoomStatus }[]) =>
      runInTransaction(db.prisma, (tx) =>
        service.applyOperation(tx, staffActor(front), 'CHECK_IN', changes),
      );

    await expect(run([{ roomId, to: 'STAY_DIRTY' }])).rejects.toThrow(RangeError);
    await expect(
      run([
        { roomId, to: 'CHECKED_IN' },
        { roomId, to: 'CHECKED_IN' },
      ]),
    ).rejects.toThrow(RangeError);
    await expect(run([{ roomId: '501', to: 'CHECKED_IN' }])).rejects.toThrow(RangeError);
    await expect(run([{ roomId: randomUUID(), to: 'CHECKED_IN' }])).rejects.toThrow(Error);
    await expect(run([])).resolves.toEqual([]);
    await expect(roomOf(roomId)).resolves.toMatchObject({ status: 'CLEAN' });
  });
});

describe('部屋の行のロック（lockRooms）と、手動の変更との順番', () => {
  it('呼び出し側が判定のために今の状態をロックして読める', async () => {
    const roomA = await createRoom('CLEAN');
    const roomB = await createRoom('STAY_DIRTY');

    const locked = await runInTransaction(db.prisma, (tx) => service.lockRooms(tx, [roomB, roomA]));

    expect(locked.get(roomA)).toMatchObject({ roomId: roomA, status: 'CLEAN' });
    expect(locked.get(roomB)).toMatchObject({ roomId: roomB, status: 'STAY_DIRTY' });
    await expect(
      runInTransaction(db.prisma, (tx) => service.lockRooms(tx, [randomUUID()])),
    ).rejects.toThrow(Error);
  });

  it('[11.3][12.3] チェックインの処理が部屋をロックしている間の、清掃員の古い画面からの変更（清掃完了 → 清掃中）は、チェックインの後の状態で判定されて断られる', async () => {
    const roomId = await createRoom('CLEAN');
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const hasLock = new Promise<void>((resolve) => {
      locked = resolve;
    });

    const checkIn = runInTransaction(db.prisma, async (tx) => {
      const statuses = await service.lockRooms(tx, [roomId]);
      locked();
      await released;
      expect(statuses.get(roomId)?.status).toBe('CLEAN');
      const changes = await service.applyOperation(tx, staffActor(front), 'CHECK_IN', [
        { roomId, to: 'CHECKED_IN' },
      ]);
      await audit.record(tx, staffActor(front), {
        action: 'CHECK_IN',
        target: { type: 'reservation', id: randomUUID() },
        detail: { roomStatusChanges: changes },
      });
    });
    await hasLock;
    const stale = errorOf(service.changeByStaff(cleaner, roomId, 'CLEANING'));
    await waitForLockWaiters(1);
    release();
    await checkIn;

    await expect(stale).resolves.toMatchObject({
      code: 'STATUS_TRANSITION_NOT_ALLOWED',
      details: { from: 'CHECKED_IN', to: 'CLEANING' },
    });
    await expect(roomOf(roomId)).resolves.toMatchObject({ status: 'CHECKED_IN' });
  });

  it('2つの操作が同じ2室を逆の順番（[A, B] と [B, A]）で求めても、部屋の ID の順にロックするのでデッドロックにならず、両方とも成功する', async () => {
    const roomA = await createRoom('CHECKED_IN');
    const roomB = await createRoom('CHECKED_IN');
    // 1室目をロックした操作を、もう一方も1室目をロックするか、もう一方がロックを待つまで止めてから2室目へ進める。
    // 求めた順にロックすると、[A, B] の操作が A を、[B, A] の操作が B を持ったまま互いの部屋を待ち、
    // PostgreSQL がデッドロックとして片方を失敗させる。ID の順なら、後の操作は1室目のロックを待つだけになる
    const firstLocked = new Set<string>();
    const barrier = (me: string, other: string) => async (): Promise<void> => {
      firstLocked.add(me);
      for (let attempt = 0; attempt < 500; attempt += 1) {
        if (firstLocked.has(other) || (await lockWaiterCount()) >= 1) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('もう一方の操作が、1室目のロックにもロックの待ちにも進みませんでした');
    };
    const checkOut = (me: string, other: string, roomIds: readonly string[]) =>
      runInTransaction(db.prisma, (tx) =>
        service.applyOperation(
          pausingBeforeSecondLock(tx, barrier(me, other)),
          staffActor(front),
          'CHECK_OUT',
          roomIds.map((roomId) => ({ roomId, to: 'CLEANING_READY' as const })),
        ),
      );

    const results = await Promise.allSettled([
      checkOut('AB', 'BA', [roomA, roomB]),
      checkOut('BA', 'AB', [roomB, roomA]),
    ]);

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const changeCounts = results
      .map((result) => (result.status === 'fulfilled' ? result.value.length : -1))
      .sort((a, b) => a - b);
    // 先の操作が2室を清掃可にし、後の操作はもう清掃可なので何も変えない
    expect(changeCounts).toEqual([0, 2]);
    await expect(roomOf(roomA)).resolves.toMatchObject({ status: 'CLEANING_READY' });
    await expect(roomOf(roomB)).resolves.toMatchObject({ status: 'CLEANING_READY' });
  });

  it('部屋をロックしている間も、その部屋を参照する行（故障中の期間など）の追加は待たされない（外部キーの確認と衝突しない FOR NO KEY UPDATE）', async () => {
    const roomId = await createRoom('CLEAN');
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const hasLock = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = runInTransaction(db.prisma, async (tx) => {
      await service.lockRooms(tx, [roomId]);
      locked();
      await released;
    });
    await hasLock;

    const insert = db.prisma.outOfOrderPeriod
      .create({
        data: {
          roomId,
          startDate: new Date('2026-11-20T00:00:00Z'),
          endDate: new Date('2026-11-21T00:00:00Z'),
          reason: 'テスト',
          createdBy: front.staffId,
        },
      })
      .then(() => 'INSERTED' as const);
    let polling = true;
    const blocked = (async () => {
      while (polling) {
        if ((await lockWaiterCount()) >= 1) return 'BLOCKED' as const;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return 'NOT_BLOCKED' as const;
    })();
    const first = await Promise.race([insert, blocked]);
    polling = false;
    release();
    await holder;
    await insert;
    await blocked;

    // FOR UPDATE なら、外部キーの確認（FOR KEY SHARE）がロックを待ち、追加はロックを放すまで終わらない
    expect(first).toBe('INSERTED');
  });
});

describe('HTTP の経路（7.11 の POST /rooms/{id}/status の代わりのテスト用コントローラー）', () => {
  async function post(staffId: string, roomId: string, to: RoomStatus) {
    const cookie = await signIn(app, 'STAFF', staffId);
    return request(app.getHttpServer())
      .post(`/api/staff/test-room-status/${roomId}`)
      .set('Cookie', cookie)
      .set(CSRF_HEADERS)
      .send({ to });
  }

  it('[3.7 完了状態] 清掃員が「その他」グループの中の変更（チェックイン済み → チェックアウト待ち）を求めると 422 で断られ、業務の操作からの「清掃完了 → チェックイン済み」は記録つきで反映される', async () => {
    // 清掃員の「その他」の中の変更（TC-OP-198）
    const occupied = await createRoom('CHECKED_IN');
    const before = await countAuditLogs(db.prisma);

    const rejected = await post(cleaner.staffId, occupied, 'DEPARTURE_PENDING');

    expect(rejected.status).toBe(422);
    expect(rejected.body).toMatchObject({
      code: 'STATUS_TRANSITION_NOT_ALLOWED',
      message:
        '「その他」のグループ（チェックイン済み・チェックアウト待ち・来客なし・故障中）の中の変更は、フロント以上が行います',
      details: { reason: 'OTHER_GROUP', from: 'CHECKED_IN', to: 'DEPARTURE_PENDING' },
    });
    await expect(roomOf(occupied)).resolves.toMatchObject({ status: 'CHECKED_IN' });
    expect(await countAuditLogs(db.prisma)).toBe(before);

    // 業務の操作（チェックイン）からの 清掃完了 → チェックイン済み
    const clean = await createRoom('CLEAN');
    const reservationId = randomUUID();
    await runInTransaction(db.prisma, async (tx) => {
      const changes = await service.applyOperation(tx, staffActor(front), 'CHECK_IN', [
        { roomId: clean, to: 'CHECKED_IN' },
      ]);
      await audit.record(tx, staffActor(front), {
        action: 'CHECK_IN',
        target: { type: 'reservation', id: reservationId },
        detail: { roomStatusChanges: changes },
      });
    });

    await expect(roomOf(clean)).resolves.toMatchObject({
      status: 'CHECKED_IN',
      statusChangedAt: new Date(NOW),
      statusChangedBy: front.staffId,
    });
    expect(await countAuditLogs(db.prisma)).toBe(before + 1);
    const rows = await listAuditLogs(db.prisma, { targetId: reservationId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorLabel: 'S101',
      action: 'CHECK_IN',
      detail: { roomStatusChanges: [{ roomId: clean, from: 'CLEAN', to: 'CHECKED_IN' }] },
    });
  });

  it('[12.4] フロントのセッションでは、グループをまたぐ変更が 201 で反映される', async () => {
    const roomId = await createRoom('DEPARTURE_PENDING');

    const res = await post(front.staffId, roomId, 'CLEANING_READY');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      changed: true,
      room: { roomId, status: 'CLEANING_READY', statusChangedBy: front.staffId },
    });
    await expect(roomOf(roomId)).resolves.toMatchObject({ status: 'CLEANING_READY' });
  });
});
