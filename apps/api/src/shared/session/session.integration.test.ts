// セッションと認証・権限の共通部品（tasks.md 3.1）を、テスト用のデータベースと、テストのためだけの URL で確かめる。
// ログイン・ログアウトの本物の API は 4.1（スタッフ）・4.3（会員）で作る。ここでは同じ部品
// （LoginAttemptLimiter・PasswordHasher・SessionService）を組み合わせたテスト用の URL を使う。
import type { StaffRole } from '@hotel/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  type INestApplication,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { insertMember, insertStaff } from '../../test/auth/fixtures.js';
import {
  CSRF_HEADERS,
  sessionCookieFrom,
  sessionSetCookie,
  sessionTokenOf,
  signIn,
} from '../../test/auth/sessions.js';
import { createTestDatabase, type TestDatabase } from '../../test/database/test-database.js';
import { createTestListenerApp, MemoryRequestLogSink } from '../../test/listener-app.js';
import { FixedBusinessClock } from '../clock/business-clock.js';
import { BusinessError } from '../errors/business-error.js';
import { errorMessage } from '../errors/error-messages.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { runInTransaction } from '../prisma/transaction.js';
import { LoginAttemptLimiter, loginAttemptKey } from '../security/login-attempt-limiter.js';
import { PasswordHasher } from '../security/password-hasher.js';
import { AllowAnonymous, MemberOnly, RequireRole } from './auth.decorators.js';
import {
  CurrentMember,
  CurrentStaff,
  findMemberPrincipal,
  type MemberPrincipal,
  type StaffPrincipal,
} from './principals.js';
import { SESSION_COOKIE_NAMES } from './session-cookie.js';
import { hashSessionToken } from './session-token.js';
import { SessionService } from './session.service.js';

const NOW = '2026-11-10T10:00:00+09:00';
const STAFF_PASSWORD = 'Staff0pass1';
const MEMBER_PASSWORD = 'Passw0rd12';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** テスト用の URL が処理まで進んだ回数（権限がなければ増えない） */
const handled = { staffFront: 0, staffAdmin: 0, memberWrite: 0 };

interface LoginBody {
  loginId: string;
  password: string;
}

/** SessionService を直接呼ぶテスト用の要求（Cookie だけを持つ） */
function fakeRequest(cookie: string): Request {
  return { headers: { cookie } } as Request;
}

/** SessionService を直接呼ぶテスト用の応答（Cookie の設定を記録する） */
function fakeResponse(): Response & { cookie: Mock } {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    getHeader: vi.fn(() => undefined),
    setHeader: vi.fn(),
    removeHeader: vi.fn(),
  } as unknown as Response & { cookie: Mock };
}

/** スタッフのログイン・ログアウトと、役割ごとの操作（テスト用。本物の API は 4.1） */
@Controller('test-session')
class StaffSessionTestController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly limiter: LoginAttemptLimiter,
    private readonly sessions: SessionService,
  ) {}

  @AllowAnonymous()
  @Post('login')
  @HttpCode(200)
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: LoginBody,
  ): Promise<{ role: string }> {
    const staff = await this.limiter.verify(
      loginAttemptKey(req, 'STAFF', body.loginId),
      async () => {
        const row = await this.prisma.staff.findUnique({ where: { staffNumber: body.loginId } });
        // 停止中のスタッフは、存在しない ID と同じ応答にする（L-9）
        const active = row?.isActive ? row : undefined;
        return (await this.hasher.verify(active?.passwordHash, body.password)) ? active : undefined;
      },
    );
    await this.sessions.start(req, res, 'STAFF', staff.id);
    return { role: staff.role };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.end(req, res, 'STAFF');
  }

  /** 役割の指定なし（清掃員以上） */
  @Get('me')
  me(@CurrentStaff() staff: StaffPrincipal): StaffPrincipal {
    return staff;
  }

  @RequireRole('FRONT')
  @Get('front')
  front(): { ok: true } {
    return { ok: true };
  }

  @RequireRole('FRONT')
  @Post('front')
  @HttpCode(200)
  frontWrite(): { ok: true } {
    handled.staffFront += 1;
    return { ok: true };
  }

  @RequireRole('ADMIN')
  @Get('admin')
  admin(): { ok: true } {
    return { ok: true };
  }

  @RequireRole('ADMIN')
  @Post('admin')
  @HttpCode(200)
  adminWrite(): { ok: true } {
    handled.staffAdmin += 1;
    return { ok: true };
  }
}

/** 会員のログイン・ログアウトと、会員だけの操作（テスト用。本物の API は 4.3・4.4） */
@Controller('test-session')
class MemberSessionTestController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly limiter: LoginAttemptLimiter,
    private readonly sessions: SessionService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: LoginBody,
  ): Promise<{ memberId: string }> {
    const member = await this.limiter.verify(
      loginAttemptKey(req, 'MEMBER', body.loginId),
      async () => {
        const row = await this.prisma.member.findFirst({
          where: { email: { equals: body.loginId, mode: 'insensitive' }, status: 'ACTIVE' },
        });
        return (await this.hasher.verify(row?.passwordHash, body.password)) ? row : undefined;
      },
    );
    await this.sessions.start(req, res, 'MEMBER', member.id);
    return { memberId: member.id };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.end(req, res, 'MEMBER');
  }

  @MemberOnly()
  @Get('me')
  me(@CurrentMember() member: MemberPrincipal): MemberPrincipal {
    return member;
  }

  @MemberOnly()
  @Post('me/consent')
  @HttpCode(200)
  write(): { ok: true } {
    handled.memberWrite += 1;
    return { ok: true };
  }

  /** ログインしていなくても使える URL（ログイン中なら会員が分かる） */
  @Get('whoami')
  whoami(@Req() req: Request): { memberId: string | null } {
    return { memberId: findMemberPrincipal(req)?.memberId ?? null };
  }

  @Get('booking-window')
  bookingWindow(): never {
    throw new BusinessError('OUT_OF_BOOKING_WINDOW');
  }
}

describe('セッションと認証・権限（tasks.md 3.1）', () => {
  const clock = new FixedBusinessClock(NOW);
  const guestLog = new MemoryRequestLogSink();
  const staffLog = new MemoryRequestLogSink();
  let db: TestDatabase;
  let guest: INestApplication;
  let staff: INestApplication;
  const ids = {} as Record<
    'S001' | 'S101' | 'S102' | 'S103' | 'S201' | 'memberA' | 'memberB' | 'memberW',
    string
  >;

  beforeAll(async () => {
    db = await createTestDatabase();
    const hasher = new PasswordHasher();
    const [staffHash, memberHash] = await Promise.all([
      hasher.hash(STAFF_PASSWORD),
      hasher.hash(MEMBER_PASSWORD),
    ]);
    const staffRows: [keyof typeof ids, StaffRole, boolean][] = [
      ['S001', 'ADMIN', true],
      ['S101', 'FRONT', true],
      ['S102', 'FRONT', false],
      ['S103', 'FRONT', true],
      ['S201', 'CLEANER', true],
    ];
    for (const [staffNumber, role, isActive] of staffRows) {
      ids[staffNumber] = await insertStaff(db.prisma, {
        staffNumber,
        role,
        isActive,
        passwordHash: staffHash,
      });
    }
    ids.memberA = await insertMember(db.prisma, {
      email: 'a@example.com',
      phone: '09011112222',
      passwordHash: memberHash,
      preferredLocale: 'ja',
    });
    ids.memberB = await insertMember(db.prisma, {
      email: 'b@example.com',
      phone: '09022223333',
      passwordHash: memberHash,
      preferredLocale: 'en',
    });
    ids.memberW = await insertMember(db.prisma, {
      email: 'w@example.com',
      phone: '09055556666',
      passwordHash: null,
      status: 'WITHDRAWN',
    });

    guest = await createTestListenerApp('guest', {
      clock,
      prisma: db.prisma,
      logSink: guestLog,
      controllers: [MemberSessionTestController],
    });
    staff = await createTestListenerApp('staff', {
      clock,
      prisma: db.prisma,
      logSink: staffLog,
      controllers: [StaffSessionTestController],
    });
  });
  afterAll(async () => {
    await guest?.close();
    await staff?.close();
    await db?.drop();
  });
  beforeEach(async () => {
    clock.set(NOW);
    await db.prisma.session.deleteMany();
    handled.staffFront = 0;
    handled.staffAdmin = 0;
    handled.memberWrite = 0;
    guestLog.entries.length = 0;
    staffLog.entries.length = 0;
  });

  const staffApi = () => request(staff.getHttpServer());
  const guestApi = () => request(guest.getHttpServer());

  async function staffLogin(loginId: string, password = STAFF_PASSWORD) {
    return staffApi()
      .post('/api/staff/test-session/login')
      .set(CSRF_HEADERS)
      .send({ loginId, password });
  }
  async function memberLogin(loginId: string, password = MEMBER_PASSWORD) {
    return guestApi()
      .post('/api/guest/test-session/login')
      .set(CSRF_HEADERS)
      .send({ loginId, password });
  }

  describe('スタッフのセッション', () => {
    it.each([
      ['S101', 'FRONT'],
      ['S201', 'CLEANER'],
      ['S001', 'ADMIN'],
    ] as const)(
      '[2.1][TC-MB-167〜169] %s でログインすると、役割 %s のセッションがデータベースにでき、ID は SHA-256 で保存する',
      async (staffNumber, role) => {
        const res = await staffLogin(staffNumber);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ role });

        const cookie = sessionCookieFrom(res, 'STAFF');
        expect(cookie).toBeDefined();
        const token = sessionTokenOf(cookie!);
        const rows = await db.prisma.session.findMany();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          id: hashSessionToken(token),
          realm: 'STAFF',
          subjectId: ids[staffNumber],
          lastSeenAt: new Date(NOW),
          expiresAt: new Date(new Date(NOW).getTime() + 12 * HOUR),
        });
        expect(rows[0]?.id).not.toBe(token);

        const me = await staffApi().get('/api/staff/test-session/me').set('Cookie', cookie!);
        expect(me.status).toBe(200);
        expect(me.body).toEqual({ staffId: ids[staffNumber], staffNumber, role });
      },
    );

    it('[TC-MB-177] スタッフのセッションの Cookie は HttpOnly・Secure・SameSite=Strict', async () => {
      const line = sessionSetCookie(await staffLogin('S101'), 'STAFF');
      expect(line).toBeDefined();
      const attributes = line!.split(';').map((part) => part.trim().toLowerCase());
      expect(attributes).toEqual(
        expect.arrayContaining([
          'httponly',
          'secure',
          'samesite=strict',
          'path=/',
          'max-age=43200',
        ]),
      );
      expect(attributes.some((a) => a.startsWith('domain='))).toBe(false);
    });

    it.each([
      ['TC-MB-174 パスワードの誤り', 'S101', 'Wrongpass99'],
      ['TC-MB-175 存在しない ID', 'S999', STAFF_PASSWORD],
      ['TC-MB-181 停止中のスタッフ', 'S102', STAFF_PASSWORD],
    ])(
      '[2.1][%s] INVALID_CREDENTIALS（401）で、同じ文言になり、セッションを作らない',
      async (_, staffNumber, password) => {
        const res = await staffLogin(staffNumber, password);
        expect(res.status).toBe(401);
        expect(res.body).toEqual({
          code: 'INVALID_CREDENTIALS',
          message: 'スタッフ番号またはパスワードが違います',
        });
        expect(sessionSetCookie(res, 'STAFF')).toBeUndefined();
        expect(await db.prisma.session.count()).toBe(0);
      },
    );

    it('[TC-MB-176] 同じ IP から同じ ID で5回失敗すると、6回目は正しいパスワードでも RATE_LIMITED（429）でセッションを作らない', async () => {
      for (const time of ['10:00:00', '10:00:10', '10:00:20', '10:00:30', '10:00:40']) {
        clock.set(`2026-11-10T${time}+09:00`);
        expect((await staffLogin('S103', 'Wrongpass99')).body.code).toBe('INVALID_CREDENTIALS');
      }
      clock.set('2026-11-10T10:00:50+09:00');
      const res = await staffLogin('S103');
      expect(res.status).toBe(429);
      expect(res.body.code).toBe('RATE_LIMITED');
      expect(sessionSetCookie(res, 'STAFF')).toBeUndefined();
      expect(await db.prisma.session.count()).toBe(0);

      // 別の ID は制限されない（TC-MB-130 と同じ考え方）
      expect((await staffLogin('S001')).status).toBe(200);
      // 最後の失敗から60秒で解除される（TC-MB-337 と同じ考え方）
      clock.set('2026-11-10T10:01:41+09:00');
      expect((await staffLogin('S103')).status).toBe(200);
    });

    it('[TC-MB-123 と同じ考え方] ログインに成功するとセッションの ID を作り直し、前の ID は使えなくなる', async () => {
      const first = sessionCookieFrom(await staffLogin('S101'), 'STAFF')!;
      const again = await staffApi()
        .post('/api/staff/test-session/login')
        .set(CSRF_HEADERS)
        .set('Cookie', first)
        .send({ loginId: 'S101', password: STAFF_PASSWORD });
      const second = sessionCookieFrom(again, 'STAFF')!;
      expect(second).not.toBe(first);

      expect((await staffApi().get('/api/staff/test-session/me').set('Cookie', first)).status).toBe(
        401,
      );
      expect(
        (await staffApi().get('/api/staff/test-session/me').set('Cookie', second)).status,
      ).toBe(200);
      expect(await db.prisma.session.count()).toBe(1);
    });

    it.each([
      ['TC-MB-178', '2026-11-09T22:01:00+09:00', 200],
      ['TC-MB-179', '2026-11-09T22:00:00+09:00', 401],
      ['TC-MB-180', '2026-11-09T21:59:00+09:00', 401],
    ])(
      '[2.1][%s] スタッフのセッションは最後の操作から12時間で失効する（最後の操作 %s、現在 10:00 → %i）',
      async (_, lastOperation, status) => {
        clock.set(lastOperation);
        const cookie = await signIn(staff, 'STAFF', ids.S101);
        clock.set(NOW);
        const res = await staffApi().get('/api/staff/test-session/front').set('Cookie', cookie);
        expect(res.status).toBe(status);
        if (status === 401) {
          expect(res.body.code).toBe('UNAUTHENTICATED');
          // 失効したセッションは消す
          expect(await db.prisma.session.count()).toBe(0);
        }
      },
    );

    it('[2.1] 期限は最後の操作から数える（操作のたびに延びる）', async () => {
      clock.set('2026-11-09T12:00:00+09:00');
      const cookie = await signIn(staff, 'STAFF', ids.S101);
      clock.set('2026-11-09T23:00:00+09:00');
      expect(
        (await staffApi().get('/api/staff/test-session/me').set('Cookie', cookie)).status,
      ).toBe(200);
      clock.set('2026-11-10T10:59:00+09:00');
      const res = await staffApi().get('/api/staff/test-session/me').set('Cookie', cookie);
      expect(res.status).toBe(200);
      // 操作のたびに Cookie も設定し直す（ブラウザの側の期限も最後の操作から数える）
      expect(sessionCookieFrom(res, 'STAFF')).toBe(cookie);
      const [row] = await db.prisma.session.findMany();
      expect(row?.lastSeenAt).toEqual(new Date('2026-11-10T10:59:00+09:00'));
      expect(row?.expiresAt).toEqual(new Date('2026-11-10T22:59:00+09:00'));
    });

    it('[2.1] ログアウトするとセッションを消し、Cookie も消す。その後の要求は UNAUTHENTICATED', async () => {
      const cookie = await signIn(staff, 'STAFF', ids.S101);
      const res = await staffApi()
        .post('/api/staff/test-session/logout')
        .set(CSRF_HEADERS)
        .set('Cookie', cookie);
      expect(res.status).toBe(204);
      expect(sessionSetCookie(res, 'STAFF')).toMatch(/expires=Thu, 01 Jan 1970/i);
      expect(await db.prisma.session.count()).toBe(0);
      expect(
        (await staffApi().get('/api/staff/test-session/me').set('Cookie', cookie)).status,
      ).toBe(401);
    });

    it('[L-28][TC-MB-352] スタッフのセッションをすべて消す処理は、同じトランザクションの中で行え、ほかのスタッフのセッションは残す', async () => {
      const s101First = await signIn(staff, 'STAFF', ids.S101);
      const s101Second = await signIn(staff, 'STAFF', ids.S101);
      const s001 = await signIn(staff, 'STAFF', ids.S001);
      const sessions = staff.get(SessionService);

      // トランザクションが取り消されたら、セッションも消えない
      const failure = new Error('停止の途中で失敗');
      await expect(
        runInTransaction(db.prisma, async (tx) => {
          await sessions.endAllFor('STAFF', ids.S101, tx);
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(
        (await staffApi().get('/api/staff/test-session/me').set('Cookie', s101First)).status,
      ).toBe(200);

      const deleted = await runInTransaction(db.prisma, (tx) =>
        sessions.endAllFor('STAFF', ids.S101, tx),
      );
      expect(deleted).toBe(2);
      for (const cookie of [s101First, s101Second]) {
        const res = await staffApi().get('/api/staff/test-session/me').set('Cookie', cookie);
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('UNAUTHENTICATED');
      }
      expect((await staffApi().get('/api/staff/test-session/me').set('Cookie', s001)).status).toBe(
        200,
      );
    });

    it('[L-9] 停止中のスタッフのセッションが残っていても受け付けず、そのセッションを消す', async () => {
      const cookie = await signIn(staff, 'STAFF', ids.S102);
      const res = await staffApi().get('/api/staff/test-session/me').set('Cookie', cookie);
      expect(res.status).toBe(401);
      expect(await db.prisma.session.count()).toBe(0);
    });

    it('[L-28][1.11] セッションを確かめている途中で、同時のログアウト・停止・退会でセッションが消されたら、ログインしていないものとして扱い、Cookie を設定し直さない', async () => {
      const sessions = staff.get(SessionService);
      const cookie = await signIn(staff, 'STAFF', ids.S101);
      const res = fakeResponse();

      // セッションを見つけた後、期限を延ばす前（利用者の確認の間）に、同時の停止でセッションが消されたことにする
      const subject = await sessions.resolve(fakeRequest(cookie), res, 'STAFF', async (id) => {
        await sessions.endAllFor('STAFF', id);
        return { staffId: id };
      });
      expect(subject).toBeUndefined();
      expect(res.cookie).not.toHaveBeenCalled();
      expect(await db.prisma.session.count()).toBe(0);

      // 対照：消されなければ利用者を返し、期限を延ばして Cookie を設定し直す
      const other = await signIn(staff, 'STAFF', ids.S001);
      const otherRes = fakeResponse();
      await expect(
        sessions.resolve(fakeRequest(other), otherRes, 'STAFF', async (id) => ({ staffId: id })),
      ).resolves.toEqual({ staffId: ids.S001 });
      expect(otherRes.cookie).toHaveBeenCalledTimes(1);
    });

    it('[TC-MB-205] 会員のセッションでは社内用 API を使えない（Cookie の名前を変えても受け付けない）', async () => {
      const memberCookie = await signIn(guest, 'MEMBER', ids.memberA);
      const asIs = await staffApi().get('/api/staff/test-session/me').set('Cookie', memberCookie);
      expect(asIs.status).toBe(401);
      expect(asIs.body.code).toBe('UNAUTHENTICATED');

      const renamed = `${SESSION_COOKIE_NAMES.STAFF}=${sessionTokenOf(memberCookie)}`;
      const res = await staffApi().get('/api/staff/test-session/me').set('Cookie', renamed);
      expect(res.status).toBe(401);
      // 会員のセッションは消さない
      expect(
        (await guestApi().get('/api/guest/test-session/me').set('Cookie', memberCookie)).status,
      ).toBe(200);
    });
  });

  describe('役割の判定（RolesGuard。役割は「その役割以上」：管理者 ＞ フロント ＞ 清掃員）', () => {
    async function as(staffNumber: 'S001' | 'S101' | 'S201'): Promise<string> {
      return signIn(staff, 'STAFF', ids[staffNumber]);
    }

    it('[2.2][2.4][TC-MB-183] 清掃員のセッションでフロント以上の操作を呼ぶと FORBIDDEN（403）「権限がありません」で、処理を行わない', async () => {
      const cleaner = await as('S201');
      const read = await staffApi().get('/api/staff/test-session/front').set('Cookie', cleaner);
      expect(read.status).toBe(403);
      expect(read.body).toEqual({ code: 'FORBIDDEN', message: '権限がありません' });

      const write = await staffApi()
        .post('/api/staff/test-session/front')
        .set(CSRF_HEADERS)
        .set('Cookie', cleaner);
      expect(write.status).toBe(403);
      expect(write.body).toEqual({ code: 'FORBIDDEN', message: '権限がありません' });
      expect(handled.staffFront).toBe(0);

      // 役割の指定がない操作（清掃員以上）は使える
      expect(
        (await staffApi().get('/api/staff/test-session/me').set('Cookie', cleaner)).status,
      ).toBe(200);
    });

    it('[2.4][2.5] 管理者だけの操作をフロントが呼ぶと FORBIDDEN（403）「権限がありません」で、処理を行わない', async () => {
      const front = await as('S101');
      const write = await staffApi()
        .post('/api/staff/test-session/admin')
        .set(CSRF_HEADERS)
        .set('Cookie', front);
      expect(write.status).toBe(403);
      expect(write.body).toEqual({ code: 'FORBIDDEN', message: '権限がありません' });
      expect(handled.staffAdmin).toBe(0);
      expect(
        (await staffApi().get('/api/staff/test-session/admin').set('Cookie', front)).status,
      ).toBe(403);

      // フロント以上の操作は使える（TC-MB-184）
      expect(
        (await staffApi().get('/api/staff/test-session/front').set('Cookie', front)).status,
      ).toBe(200);
      const frontWrite = await staffApi()
        .post('/api/staff/test-session/front')
        .set(CSRF_HEADERS)
        .set('Cookie', front);
      expect(frontWrite.status).toBe(200);
      expect(handled.staffFront).toBe(1);
    });

    it('[2.2][2.5][TC-MB-186] 管理者はすべての操作を使える', async () => {
      const admin = await as('S001');
      for (const path of ['me', 'front', 'admin']) {
        expect(
          (await staffApi().get(`/api/staff/test-session/${path}`).set('Cookie', admin)).status,
        ).toBe(200);
      }
      const write = await staffApi()
        .post('/api/staff/test-session/admin')
        .set(CSRF_HEADERS)
        .set('Cookie', admin);
      expect(write.status).toBe(200);
      expect(handled.staffAdmin).toBe(1);
    });

    it('[TC-MB-302] Accept-Language: en を付けても、FORBIDDEN の文言は日本語', async () => {
      const res = await staffApi()
        .get('/api/staff/test-session/front')
        .set('Cookie', await as('S201'))
        .set('Accept-Language', 'en');
      expect(res.body).toEqual({ code: 'FORBIDDEN', message: '権限がありません' });
    });

    it('[TC-MB-206] ログイン済みのフロントでも、独自のヘッダーのない状態を変える要求は FORBIDDEN で、処理を行わない', async () => {
      const res = await staffApi()
        .post('/api/staff/test-session/front')
        .set('Cookie', await as('S101'));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(handled.staffFront).toBe(0);
    });

    it('役割は要求ごとにデータベースから読む（役割を変えれば次の要求から反映される）', async () => {
      const cookie = await signIn(staff, 'STAFF', ids.S103);
      expect(
        (await staffApi().get('/api/staff/test-session/front').set('Cookie', cookie)).status,
      ).toBe(200);
      await db.prisma.staff.update({ where: { id: ids.S103 }, data: { role: 'CLEANER' } });
      try {
        expect(
          (await staffApi().get('/api/staff/test-session/front').set('Cookie', cookie)).status,
        ).toBe(403);
      } finally {
        await db.prisma.staff.update({ where: { id: ids.S103 }, data: { role: 'FRONT' } });
      }
    });

    it('要求のログの利用者の種類は、スタッフのセッションなら STAFF、ログインの要求は ANONYMOUS。セッションの ID はログに出さない', async () => {
      const login = await staffLogin('S201');
      const cookie = sessionCookieFrom(login, 'STAFF')!;
      await staffApi().get('/api/staff/test-session/front').set('Cookie', cookie);
      await expect.poll(() => staffLog.entries.length).toBe(2);
      expect(staffLog.entries.map((e) => [e.path, e.userType, e.result])).toEqual([
        ['/api/staff/test-session/login', 'ANONYMOUS', 'OK'],
        ['/api/staff/test-session/front', 'STAFF', 'FORBIDDEN'],
      ]);
      const text = JSON.stringify(staffLog.entries);
      expect(text).not.toContain(sessionTokenOf(cookie));
      expect(text).not.toContain(STAFF_PASSWORD);
    });
  });

  describe('会員のセッション', () => {
    it('[TC-MB-121][TC-MB-122] 会員のログインでセッションができ、Cookie は HttpOnly・Secure・SameSite=Lax', async () => {
      const res = await memberLogin('a@example.com');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ memberId: ids.memberA });

      const line = sessionSetCookie(res, 'MEMBER');
      const attributes = line!.split(';').map((part) => part.trim().toLowerCase());
      expect(attributes).toEqual(
        expect.arrayContaining(['httponly', 'secure', 'samesite=lax', 'path=/', 'max-age=604800']),
      );
      expect(sessionSetCookie(res, 'STAFF')).toBeUndefined();

      const token = sessionTokenOf(sessionCookieFrom(res, 'MEMBER')!);
      const [row] = await db.prisma.session.findMany();
      expect(row).toMatchObject({
        id: hashSessionToken(token),
        realm: 'MEMBER',
        subjectId: ids.memberA,
        expiresAt: new Date(new Date(NOW).getTime() + 7 * DAY),
      });
    });

    it('[TC-MB-123] Cookie X を付けたままもう一度ログインすると、X と異なる ID になり、X は使えなくなる', async () => {
      const x = sessionCookieFrom(await memberLogin('a@example.com'), 'MEMBER')!;
      const again = await guestApi()
        .post('/api/guest/test-session/login')
        .set(CSRF_HEADERS)
        .set('Cookie', x)
        .send({ loginId: 'a@example.com', password: MEMBER_PASSWORD });
      const y = sessionCookieFrom(again, 'MEMBER')!;
      expect(y).not.toBe(x);
      expect((await guestApi().get('/api/guest/test-session/me').set('Cookie', x)).status).toBe(
        401,
      );
      expect((await guestApi().get('/api/guest/test-session/me').set('Cookie', y)).status).toBe(
        200,
      );
    });

    it('[TC-MB-124][TC-MB-125] パスワードの誤りと存在しないメールアドレスは、同じ INVALID_CREDENTIALS と同じ文言', async () => {
      const wrong = await memberLogin('a@example.com', 'Wrongpass99');
      const unknown = await memberLogin('unknown@example.com');
      const withdrawn = await memberLogin('w@example.com');
      for (const res of [wrong, unknown, withdrawn]) {
        expect(res.status).toBe(401);
        expect(res.body).toEqual({
          code: 'INVALID_CREDENTIALS',
          message: 'メールアドレスまたはパスワードが違います',
        });
        expect(sessionSetCookie(res, 'MEMBER')).toBeUndefined();
      }
      expect(await db.prisma.session.count()).toBe(0);
    });

    it('[TC-MB-126〜128][TC-MB-130] 同じ IP とメールアドレスで5回失敗すると、6回目は RATE_LIMITED。別の ID は制限されない', async () => {
      for (const time of ['10:00:00', '10:00:10', '10:00:20', '10:00:30', '10:00:40']) {
        clock.set(`2026-11-10T${time}+09:00`);
        const res = await memberLogin('b@example.com', 'Wrongpass99');
        expect(res.body.code).toBe('INVALID_CREDENTIALS');
      }
      clock.set('2026-11-10T10:00:50+09:00');
      const limited = await memberLogin('b@example.com');
      expect(limited.status).toBe(429);
      expect(limited.body.code).toBe('RATE_LIMITED');
      expect(sessionSetCookie(limited, 'MEMBER')).toBeUndefined();
      expect(await db.prisma.session.count()).toBe(0);

      expect((await memberLogin('a@example.com')).status).toBe(200);
    });

    it('[TC-MB-133] ログアウトは 204 で、その後の会員だけの操作は UNAUTHENTICATED（401）', async () => {
      const cookie = await signIn(guest, 'MEMBER', ids.memberA);
      const res = await guestApi()
        .post('/api/guest/test-session/logout')
        .set(CSRF_HEADERS)
        .set('Cookie', cookie);
      expect(res.status).toBe(204);
      const me = await guestApi().get('/api/guest/test-session/me').set('Cookie', cookie);
      expect(me.status).toBe(401);
      expect(me.body.code).toBe('UNAUTHENTICATED');
    });

    it.each([
      ['TC-MB-134', '2026-11-10T09:59:00+09:00', 200],
      ['TC-MB-135', '2026-11-10T10:00:00+09:00', 401],
      ['TC-MB-136', '2026-11-10T10:01:00+09:00', 401],
    ])(
      '[%s] 会員のセッションは最後の操作から7日で失効する（最後の操作 2026-11-03 10:00、現在 %s → %i）',
      async (_, now, status) => {
        clock.set('2026-11-03T10:00:00+09:00');
        const cookie = await signIn(guest, 'MEMBER', ids.memberA);
        clock.set(now);
        const res = await guestApi().get('/api/guest/test-session/me').set('Cookie', cookie);
        expect(res.status).toBe(status);
        if (status === 200) {
          expect(res.body).toEqual({ memberId: ids.memberA, preferredLocale: 'ja' });
        } else {
          expect(res.body.code).toBe('UNAUTHENTICATED');
        }
      },
    );

    it('[TC-MB-137] 期限は最後の操作から数える（11-03 と 11-08 に操作し、11-14 10:00 に操作できる）', async () => {
      clock.set('2026-11-03T10:00:00+09:00');
      const cookie = await signIn(guest, 'MEMBER', ids.memberA);
      clock.set('2026-11-08T10:00:00+09:00');
      expect(
        (await guestApi().get('/api/guest/test-session/me').set('Cookie', cookie)).status,
      ).toBe(200);
      clock.set('2026-11-14T10:00:00+09:00');
      expect(
        (await guestApi().get('/api/guest/test-session/me').set('Cookie', cookie)).status,
      ).toBe(200);
    });

    it('[TC-MB-204] スタッフのセッションでは公開用 API を使えない（Cookie の名前を変えても受け付けない）', async () => {
      const staffCookie = await signIn(staff, 'STAFF', ids.S001);
      const asIs = await guestApi().get('/api/guest/test-session/me').set('Cookie', staffCookie);
      expect(asIs.status).toBe(401);
      expect(asIs.body.code).toBe('UNAUTHENTICATED');

      const renamed = `${SESSION_COOKIE_NAMES.MEMBER}=${sessionTokenOf(staffCookie)}`;
      const res = await guestApi().get('/api/guest/test-session/me').set('Cookie', renamed);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('[1.11] 退会した会員のセッションが残っていても受け付けず、そのセッションを消す', async () => {
      const cookie = await signIn(guest, 'MEMBER', ids.memberW);
      expect(
        (await guestApi().get('/api/guest/test-session/me').set('Cookie', cookie)).status,
      ).toBe(401);
      expect(await db.prisma.session.count()).toBe(0);
    });

    it('[1.10][TC-MB-165] 会員はセッションの会員として扱い、要求で別の会員を指定しても変わらない', async () => {
      const cookie = await signIn(guest, 'MEMBER', ids.memberA);
      const res = await guestApi()
        .get('/api/guest/test-session/me')
        .query({ memberId: ids.memberB })
        .set('Cookie', cookie);
      expect(res.body).toEqual({ memberId: ids.memberA, preferredLocale: 'ja' });
    });

    it('[TC-MB-139] ログイン済みでも、独自のヘッダーのない状態を変える要求は FORBIDDEN（403）で、処理を行わない', async () => {
      const cookie = await signIn(guest, 'MEMBER', ids.memberA);
      const res = await guestApi().post('/api/guest/test-session/me/consent').set('Cookie', cookie);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(handled.memberWrite).toBe(0);

      const allowed = await guestApi()
        .post('/api/guest/test-session/me/consent')
        .set(CSRF_HEADERS)
        .set('Cookie', cookie);
      expect(allowed.status).toBe(200);
      expect(handled.memberWrite).toBe(1);
    });

    it('ログインしていなくても使える URL では、ログイン中なら会員が分かり、セッションがなくても断らない', async () => {
      const cookie = await signIn(guest, 'MEMBER', ids.memberA);
      expect(
        (await guestApi().get('/api/guest/test-session/whoami').set('Cookie', cookie)).body,
      ).toEqual({ memberId: ids.memberA });
      expect((await guestApi().get('/api/guest/test-session/whoami')).body).toEqual({
        memberId: null,
      });

      clock.advance(7 * DAY);
      const expired = await guestApi().get('/api/guest/test-session/whoami').set('Cookie', cookie);
      expect(expired.status).toBe(200);
      expect(expired.body).toEqual({ memberId: null });
    });

    it('[L-11][TC-MB-282] ログイン中は、Accept-Language より会員の preferred_locale の言語で文言を作る', async () => {
      const memberB = await signIn(guest, 'MEMBER', ids.memberB); // preferred_locale=en
      const res = await guestApi()
        .get('/api/guest/test-session/booking-window')
        .set('Cookie', memberB)
        .set('Accept-Language', 'ko');
      expect(res.body).toEqual({
        code: 'OUT_OF_BOOKING_WINDOW',
        message: errorMessage('OUT_OF_BOOKING_WINDOW', 'en'),
      });

      const memberA = await signIn(guest, 'MEMBER', ids.memberA); // preferred_locale=ja
      const ja = await guestApi()
        .get('/api/guest/test-session/booking-window')
        .set('Cookie', memberA)
        .set('Accept-Language', 'en');
      expect(ja.body.message).toBe(errorMessage('OUT_OF_BOOKING_WINDOW', 'ja'));

      // ログインしていなければ Accept-Language（TC-MB-284）
      const anonymous = await guestApi()
        .get('/api/guest/test-session/booking-window')
        .set('Accept-Language', 'ko');
      expect(anonymous.body.message).toBe(errorMessage('OUT_OF_BOOKING_WINDOW', 'ko'));
    });

    it('要求のログの利用者の種類は、会員のセッションなら MEMBER。セッションの ID・メールアドレス・パスワードはログに出さない', async () => {
      const login = await memberLogin('a@example.com');
      const cookie = sessionCookieFrom(login, 'MEMBER')!;
      await guestApi().get('/api/guest/test-session/me').set('Cookie', cookie);
      await guestApi().get('/api/guest/test-session/whoami');
      await expect.poll(() => guestLog.entries.length).toBe(3);
      expect(guestLog.entries.map((e) => [e.path, e.userType])).toEqual([
        ['/api/guest/test-session/login', 'ANONYMOUS'],
        ['/api/guest/test-session/me', 'MEMBER'],
        ['/api/guest/test-session/whoami', 'ANONYMOUS'],
      ]);
      const text = JSON.stringify(guestLog.entries);
      for (const secret of [sessionTokenOf(cookie), 'a@example.com', MEMBER_PASSWORD]) {
        expect(text).not.toContain(secret);
      }
    });
  });

  it('期限の切れたセッションをまとめて消せる（ちょうど期限の時刻のものを含む。DT-M1）', async () => {
    clock.set('2026-11-09T22:00:00+09:00');
    await signIn(staff, 'STAFF', ids.S101); // 2026-11-10 10:00 に失効
    clock.set('2026-11-09T22:01:00+09:00');
    await signIn(staff, 'STAFF', ids.S001); // 2026-11-10 10:01 に失効
    clock.set(NOW);
    await expect(staff.get(SessionService).deleteExpired()).resolves.toBe(1);
    expect((await db.prisma.session.findMany()).map((row) => row.subjectId)).toEqual([ids.S001]);
  });
});
