// 操作履歴の記録（AuditLogService。tasks.md 3.3）を、テスト用のデータベースと社内用の待ち受け口で確かめる。
// 本物の社内用 API（予約・チェックイン・名簿など）は後のタスクで作る。ここでは、それらと同じ使い方
// （1つの操作を1つのトランザクションで行い、その中で1行を記録する）をするテスト用の URL と定時処理を使う。
import type { RoomStatus } from '@hotel/contracts';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  type INestApplication,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listAuditLogs, countAuditLogs, personalValuesIn } from '../../test/audit.js';
import { insertStaff } from '../../test/auth/fixtures.js';
import { CSRF_HEADERS, signIn } from '../../test/auth/sessions.js';
import {
  connectPg,
  createTestDatabase,
  type TestDatabase,
} from '../../test/database/test-database.js';
import { createTestListenerApp } from '../../test/listener-app.js';
import { JobScheduler } from '../../modules/jobs/job-scheduler.js';
import { BusinessClock, FixedBusinessClock } from '../clock/business-clock.js';
import { BusinessError } from '../errors/business-error.js';
import type { ScheduledJob } from '../jobs/scheduled-job.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { runInTransaction, type TransactionClient } from '../prisma/transaction.js';
import { RequireRole } from '../session/auth.decorators.js';
import { CurrentStaff, type StaffPrincipal } from '../session/principals.js';
import { staffActor, systemActor, type AuditRoomStatusChange } from './audit-entry.js';
import { AuditLogService } from './audit-log.service.js';

const NOW = '2026-11-10T10:00:00+09:00';
const JOB_NOW = '2026-11-10T09:00:00+09:00';
const STAFF_PATH = '/api/staff';

/** 部屋の状態を変え、変化を返す（3.7 の RoomStatusService の「業務の操作からの変更」の入口に当たる部分の代わり） */
async function changeRoomStatus(
  tx: TransactionClient,
  roomId: string,
  to: RoomStatus,
  changedBy: string | null,
  at: Date,
): Promise<AuditRoomStatusChange> {
  const before = await tx.room.findUniqueOrThrow({
    where: { id: roomId },
    select: { status: true },
  });
  await tx.room.update({
    where: { id: roomId },
    data: { status: to, statusChangedAt: at, statusChangedBy: changedBy },
  });
  return { roomId, from: before.status as RoomStatus, to };
}

interface RosterEntryBody {
  familyName: string;
  givenName: string;
  address: string;
  contact: string;
  nationality?: string;
  passportNumber?: string;
}

/**
 * 社内用 API の登録・変更の操作の代わり（テスト用）。どれも、1つのトランザクションの中で変更と操作履歴の1行を記録する。
 * 本物の API は、特定期間割増（タスク 9.x）・チェックイン（8.x）・名簿（6.x）などで作る。
 */
@Controller('test-audit')
class AuditTestController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly clock: BusinessClock,
  ) {}

  /** 特定期間割増の割増率の変更。rateBp が負なら、記録の後に業務エラーで失敗する（全体が取り消される） */
  @RequireRole('FRONT')
  @Patch('special-surcharges/:id')
  async updateSurcharge(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id') id: string,
    @Body() body: { rateBp: number },
  ): Promise<{ ok: true }> {
    await runInTransaction(this.prisma, async (tx) => {
      await tx.specialSurchargePeriod.update({ where: { id }, data: { rateBp: body.rateBp } });
      await this.audit.record(tx, staffActor(staff), {
        action: 'SPECIAL_SURCHARGE_UPDATE',
        target: { type: 'special_surcharge_period', id },
        detail: { fields: ['rateBp'] },
      });
      if (body.rateBp < 0) throw new BusinessError('VALIDATION_FAILED');
    });
    return { ok: true };
  }

  /** チェックインの代わり：予約の全室を CHECKED_IN にする（部屋の状態の変化は、操作の1行の detail に入れる） */
  @RequireRole('FRONT')
  @Post('reservations/:id/check-in')
  @HttpCode(200)
  async checkIn(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id') reservationId: string,
    @Body() body: { roomIds: string[] },
  ): Promise<{ ok: true }> {
    // 部屋の状態の変更の時刻と操作履歴の時刻を、操作の1つの時刻にそろえる
    const now = this.clock.now();
    await runInTransaction(this.prisma, async (tx) => {
      const changes: AuditRoomStatusChange[] = [];
      for (const roomId of body.roomIds) {
        changes.push(await changeRoomStatus(tx, roomId, 'CHECKED_IN', staff.staffId, now));
      }
      await this.audit.record(tx, staffActor(staff), {
        action: 'CHECK_IN',
        target: { type: 'reservation', id: reservationId },
        detail: { roomStatusChanges: changes },
        at: now,
      });
    });
    return { ok: true };
  }

  /** 名簿の入力の代わり：入力の値（個人情報）は記録せず、入力した項目の名前と対象の ID だけを記録する */
  @RequireRole('FRONT')
  @Put('reservations/:id/roster')
  async saveRoster(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id') reservationId: string,
    @Body() body: { entries: RosterEntryBody[] },
  ): Promise<{ ok: true }> {
    await runInTransaction(this.prisma, async (tx) => {
      await this.audit.record(tx, staffActor(staff), {
        action: 'ROSTER_UPDATE',
        target: { type: 'reservation', id: reservationId },
        detail: { fields: body.entries.flatMap((entry) => Object.keys(entry)) },
      });
    });
    return { ok: true };
  }
}

describe('操作履歴の記録（AuditLogService）', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let audit: AuditLogService;
  const clock = new FixedBusinessClock(NOW);
  const staffIds: Record<'S001' | 'S101' | 'S201', string> = { S001: '', S101: '', S201: '' };
  let roomTypeId: string;
  let roomNumber = 500;

  /** 定時処理の代わり：対象の部屋ごとに状態を変え、対象1件につき1行を記録する。failRoomIds の部屋は記録の後に失敗する */
  const jobTargets = { roomIds: [] as string[], failRoomIds: new Set<string>() };
  const roomStatusJob: ScheduledJob = {
    name: 'test-audit-room-status',
    schedule: '0 9 * * *',
    async execute(ctx) {
      await ctx.processTargets({
        kind: 'room',
        select: async () => jobTargets.roomIds,
        idOf: (roomId) => roomId,
        process: (roomId) =>
          runInTransaction(db.prisma, async (tx) => {
            const change = await changeRoomStatus(tx, roomId, 'DEPARTURE_PENDING', null, ctx.now);
            await audit.record(tx, systemActor(ctx), {
              action: 'ROOM_STATUS_CHANGE',
              target: { type: 'room', id: roomId },
              detail: { roomStatusChanges: [change] },
            });
            if (jobTargets.failRoomIds.has(roomId)) throw new Error('テスト用の失敗');
            return 'DONE' as const;
          }),
      });
    },
  };

  async function insertRoom(status: RoomStatus): Promise<string> {
    roomNumber += 1;
    const row = await db.prisma.room.create({
      data: {
        roomNumber,
        floor: 5,
        roomTypeId,
        isAccessible: false,
        status,
        statusChangedAt: new Date('2026-11-09T12:00:00+09:00'),
      },
      select: { id: true },
    });
    return row.id;
  }

  async function insertSurcharge(): Promise<string> {
    const row = await db.prisma.specialSurchargePeriod.create({
      data: {
        startDate: new Date('2026-12-29T00:00:00Z'),
        endDate: new Date('2027-01-03T00:00:00Z'),
        rateBp: 3000,
        createdBy: staffIds.S101,
      },
      select: { id: true },
    });
    return row.id;
  }

  function staffRequest(staffNumber: keyof typeof staffIds) {
    const server = app.getHttpServer();
    const cookie = signIn(app, 'STAFF', staffIds[staffNumber]);
    return {
      patch: async (path: string, body: object) =>
        request(server)
          .patch(`${STAFF_PATH}${path}`)
          .set('Cookie', await cookie)
          .set(CSRF_HEADERS)
          .send(body),
      post: async (path: string, body: object) =>
        request(server)
          .post(`${STAFF_PATH}${path}`)
          .set('Cookie', await cookie)
          .set(CSRF_HEADERS)
          .send(body),
      put: async (path: string, body: object) =>
        request(server)
          .put(`${STAFF_PATH}${path}`)
          .set('Cookie', await cookie)
          .set(CSRF_HEADERS)
          .send(body),
      delete: async (path: string) =>
        request(server)
          .delete(`${STAFF_PATH}${path}`)
          .set('Cookie', await cookie)
          .set(CSRF_HEADERS),
    };
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    for (const [staffNumber, role] of [
      ['S001', 'ADMIN'],
      ['S101', 'FRONT'],
      ['S201', 'CLEANER'],
    ] as const) {
      // ログインの API を通さない（signIn）ので、パスワードのハッシュは使わない
      staffIds[staffNumber] = await insertStaff(db.prisma, {
        staffNumber,
        role,
        passwordHash: 'unused',
      });
    }
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

    app = await createTestListenerApp('staff', {
      prisma: db.prisma,
      clock,
      controllers: [AuditTestController],
      jobs: [roomStatusJob],
    });
    audit = app.get(AuditLogService);
  });
  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });
  beforeEach(() => {
    clock.set(NOW);
    jobTargets.roomIds = [];
    jobTargets.failRoomIds = new Set();
  });

  it('[18.1][18.2 完了状態] スタッフの更新の操作の後に操作履歴が1件増え（スタッフ番号・日時・操作の内容）、その行の変更・削除はデータベースが拒否する', async () => {
    const periodId = await insertSurcharge();
    const before = await countAuditLogs(db.prisma);

    const res = await staffRequest('S101').patch(`/test-audit/special-surcharges/${periodId}`, {
      rateBp: 2500,
    });
    expect(res.status).toBe(200);

    expect(await countAuditLogs(db.prisma)).toBe(before + 1);
    const rows = await listAuditLogs(db.prisma, { targetId: periodId });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      staffId: staffIds.S101,
      actorLabel: 'S101',
      action: 'SPECIAL_SURCHARGE_UPDATE',
      targetType: 'special_surcharge_period',
      targetId: periodId,
      detail: { fields: ['rateBp'] },
      at: new Date(NOW),
    });
    // 操作した人は staff_id からもスタッフ番号が分かる
    await expect(
      db.prisma.staff.findUniqueOrThrow({ where: { id: row.staffId! } }),
    ).resolves.toMatchObject({ staffNumber: 'S101' });
    await expect(
      db.prisma.specialSurchargePeriod.findUniqueOrThrow({ where: { id: periodId } }),
    ).resolves.toMatchObject({ rateBp: 2500 });

    // アプリのデータベース利用者（API と同じ権限）：UPDATE・DELETE の権限がない（TC-MB-220・221）
    await expect(
      db.prisma.auditLog.update({ where: { id: row.id }, data: { action: 'TAMPERED' } }),
    ).rejects.toThrow(/permission denied/);
    await expect(db.prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(
      /permission denied/,
    );
    // テーブルの所有者：トリガーで拒否される（TC-MB-222・223）
    const owner = await connectPg(db.ownerUrl);
    try {
      await expect(
        owner.query(`UPDATE audit_logs SET detail = '{}'::jsonb WHERE id = $1`, [row.id]),
      ).rejects.toThrow(/audit_logs/);
      await expect(owner.query('DELETE FROM audit_logs WHERE id = $1', [row.id])).rejects.toThrow(
        /audit_logs/,
      );
    } finally {
      await owner.end();
    }
    await expect(db.prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } })).resolves.toEqual(
      row,
    );
  });

  it('[18.1] 失敗した操作は記録しない：権限がない（TC-MB-219）・記録の後の業務エラー（全体が取り消される）', async () => {
    const periodId = await insertSurcharge();
    const before = await countAuditLogs(db.prisma);

    const forbidden = await staffRequest('S201').patch(
      `/test-audit/special-surcharges/${periodId}`,
      { rateBp: 2500 },
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ code: 'FORBIDDEN' });

    const failed = await staffRequest('S101').patch(`/test-audit/special-surcharges/${periodId}`, {
      rateBp: -1,
    });
    expect(failed.status).toBe(400);
    expect(failed.body).toMatchObject({ code: 'VALIDATION_FAILED' });

    expect(await countAuditLogs(db.prisma)).toBe(before);
    await expect(
      db.prisma.specialSurchargePeriod.findUniqueOrThrow({ where: { id: periodId } }),
    ).resolves.toMatchObject({ rateBp: 3000 });
  });

  it('[18.1] 1回の要求で2室の状態が変わっても操作履歴は1行だけで、部屋の状態の変化はその行の detail に入る（L-42・TC-MB-400 の形）', async () => {
    clock.set('2026-11-10T15:00:00+09:00');
    const room501 = await insertRoom('CLEAN');
    const room502 = await insertRoom('CLEAN');
    const reservationId = randomUUID();
    const before = await countAuditLogs(db.prisma);

    const res = await staffRequest('S101').post(
      `/test-audit/reservations/${reservationId}/check-in`,
      {
        roomIds: [room501, room502],
      },
    );
    expect(res.status).toBe(200);

    expect(await countAuditLogs(db.prisma)).toBe(before + 1);
    const rows = await listAuditLogs(db.prisma, { targetId: reservationId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorLabel: 'S101',
      action: 'CHECK_IN',
      targetType: 'reservation',
      at: new Date('2026-11-10T15:00:00+09:00'),
      detail: {
        roomStatusChanges: [
          { roomId: room501, from: 'CLEAN', to: 'CHECKED_IN' },
          { roomId: room502, from: 'CLEAN', to: 'CHECKED_IN' },
        ],
      },
    });
    // 部屋の状態の変更の行を別に作らない
    expect(await countAuditLogs(db.prisma, { targetId: { in: [room501, room502] } })).toBe(0);
  });

  it('[18.3] 名簿の個人情報の値は記録せず、項目の名前と対象の ID だけを記録する（TC-MB-386 の入力）', async () => {
    const reservationId = randomUUID();
    const entries: RosterEntryBody[] = [
      {
        familyName: '佐藤',
        givenName: '一郎',
        address: '石川県金沢市広岡1-1',
        contact: '09022223333',
      },
      {
        familyName: '李',
        givenName: '明',
        address: 'Beijing 100000',
        contact: '8613800000000',
        nationality: '中国',
        passportNumber: 'E12345678',
      },
    ];

    const res = await staffRequest('S101').put(`/test-audit/reservations/${reservationId}/roster`, {
      entries,
    });
    expect(res.status).toBe(200);

    const rows = await listAuditLogs(db.prisma, { targetId: reservationId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorLabel: 'S101',
      action: 'ROSTER_UPDATE',
      targetType: 'reservation',
      targetId: reservationId,
      detail: {
        fields: ['familyName', 'givenName', 'address', 'contact', 'nationality', 'passportNumber'],
      },
    });
    const values = entries.flatMap((entry) => Object.values(entry) as string[]);
    expect(personalValuesIn(rows, [...values, '佐藤 一郎', '李 明'])).toEqual([]);
  });

  it('[18.1] 同じトランザクション（1つの操作）で2行目を記録しようとすると失敗し、操作ごと取り消される（L-42）', async () => {
    const actor = staffActor({ staffId: staffIds.S101, staffNumber: 'S101' });
    const reservationId = randomUUID();
    const before = await countAuditLogs(db.prisma);

    await expect(
      runInTransaction(db.prisma, async (tx) => {
        await audit.record(tx, actor, {
          action: 'CHECK_IN',
          target: { type: 'reservation', id: reservationId },
        });
        await audit.record(tx, actor, {
          action: 'ROOM_STATUS_CHANGE',
          target: { type: 'room', id: randomUUID() },
        });
      }),
    ).rejects.toThrow(/1行/);
    expect(await countAuditLogs(db.prisma)).toBe(before);

    // 別のトランザクション（次の操作）では、また1行を記録できる
    const id = await runInTransaction(db.prisma, (tx) =>
      audit.record(tx, actor, {
        action: 'CHECK_IN',
        target: { type: 'reservation', id: reservationId },
      }),
    );
    await expect(listAuditLogs(db.prisma, { targetId: reservationId })).resolves.toMatchObject([
      { id },
    ]);
  });

  it('[18.1] トランザクションの外（PrismaService）では記録できない（失敗した操作の行が残らないように）', async () => {
    const before = await countAuditLogs(db.prisma);
    await expect(
      audit.record(db.prisma, staffActor({ staffId: staffIds.S101, staffNumber: 'S101' }), {
        action: 'CHECK_IN',
        target: { type: 'reservation', id: randomUUID() },
      }),
    ).rejects.toThrow(/トランザクション/);
    expect(await countAuditLogs(db.prisma)).toBe(before);
  });

  it('[18.1] 定時処理は staff_id が空の「システム」として、対象1件につき1行を記録し、失敗した対象の行は残らない（TC-MB-218・401 の形）', async () => {
    clock.set(JOB_NOW);
    const rooms = [
      await insertRoom('CHECKED_IN'),
      await insertRoom('CHECKED_IN'),
      await insertRoom('CHECKED_IN'),
    ];
    jobTargets.roomIds = rooms;
    jobTargets.failRoomIds = new Set([rooms[1]!]);
    const before = await countAuditLogs(db.prisma);

    const outcome = await app.get(JobScheduler).runNow('test-audit-room-status');
    if (outcome.status !== 'FINISHED') throw new Error(`実行されていません（${outcome.status}）`);
    expect(outcome.detail.targets).toEqual({
      room: { selected: 3, done: 2, skipped: 0, failed: 1, failedTargetIds: [rooms[1]] },
    });

    expect(await countAuditLogs(db.prisma)).toBe(before + 2);
    for (const roomId of [rooms[0]!, rooms[2]!]) {
      const rows = await listAuditLogs(db.prisma, { targetId: roomId });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        staffId: null,
        actorLabel: 'SYSTEM:test-audit-room-status',
        action: 'ROOM_STATUS_CHANGE',
        targetType: 'room',
        targetId: roomId,
        at: new Date(JOB_NOW),
        detail: {
          jobRunId: outcome.runId,
          roomStatusChanges: [{ roomId, from: 'CHECKED_IN', to: 'DEPARTURE_PENDING' }],
        },
      });
    }
    // 失敗した対象は、状態の変更も操作履歴も取り消される
    expect(await countAuditLogs(db.prisma, { targetId: rooms[1]! })).toBe(0);
    await expect(
      db.prisma.room.findUniqueOrThrow({ where: { id: rooms[1]! } }),
    ).resolves.toMatchObject({ status: 'CHECKED_IN' });
  });

  it('[18.2] 社内用 API に操作履歴を変更・削除する URL はない（TC-MB-224。管理者でも 404 で、行は変わらない）', async () => {
    const id = await runInTransaction(db.prisma, (tx) =>
      audit.record(tx, staffActor({ staffId: staffIds.S101, staffNumber: 'S101' }), {
        action: 'NOTICE_RESOLVE',
        target: { type: 'notice', id: randomUUID() },
      }),
    );
    const before = await db.prisma.auditLog.findUniqueOrThrow({ where: { id } });

    const admin = staffRequest('S001');
    const patched = await admin.patch(`/audit-logs/${id}`, { action: 'TAMPERED' });
    const deleted = await admin.delete(`/audit-logs/${id}`);
    expect([patched.status, deleted.status]).toEqual([404, 404]);
    expect(patched.body).toMatchObject({ code: 'NOT_FOUND' });

    await expect(db.prisma.auditLog.findUniqueOrThrow({ where: { id } })).resolves.toEqual(before);
  });
});
