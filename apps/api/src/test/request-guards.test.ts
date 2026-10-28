// 待ち受け口に共通の、要求の確認（他サイトからの要求の拒否・ログインの確認の順序・文言の言語）を、
// データベースなしで確かめる。セッションをデータベースに保存して使う確認は session.integration.test.ts で行う。
import { ApiErrorSchema } from '@hotel/contracts';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
  type INestApplication,
} from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BusinessError } from '../shared/errors/business-error.js';
import { errorMessage } from '../shared/errors/error-messages.js';
import { AllowAnonymous, MemberOnly, RequireRole } from '../shared/session/auth.decorators.js';
import { SESSION_COOKIE_NAMES } from '../shared/session/session-cookie.js';
import { generateSessionToken } from '../shared/session/session-token.js';
import { CSRF_HEADERS } from './auth/sessions.js';
import { createTestListenerApp, MemoryRequestLogSink } from './listener-app.js';

const calls = { guest: 0, staff: 0 };

@Controller('test-guards')
class GuestGuardTestController {
  @Get('public')
  read(): { ok: true } {
    return { ok: true };
  }

  @Post('public')
  @HttpCode(200)
  create(): { ok: true } {
    calls.guest += 1;
    return { ok: true };
  }

  @Put('public')
  replace(): { ok: true } {
    calls.guest += 1;
    return { ok: true };
  }

  @Patch('public')
  update(): { ok: true } {
    calls.guest += 1;
    return { ok: true };
  }

  @Delete('public')
  remove(): { ok: true } {
    calls.guest += 1;
    return { ok: true };
  }

  @Get('booking-window')
  bookingWindow(): never {
    throw new BusinessError('OUT_OF_BOOKING_WINDOW');
  }

  @MemberOnly()
  @Get('member')
  member(): { ok: true } {
    return { ok: true };
  }
}

@Controller('test-guards')
class StaffGuardTestController {
  @AllowAnonymous()
  @Post('anonymous')
  @HttpCode(200)
  anonymous(): { ok: true } {
    calls.staff += 1;
    return { ok: true };
  }

  @Get('any-staff')
  anyStaff(): { ok: true } {
    return { ok: true };
  }

  @RequireRole('FRONT')
  @Get('front')
  front(): { ok: true } {
    return { ok: true };
  }

  @RequireRole('FRONT')
  @Post('front')
  frontWrite(): { ok: true } {
    calls.staff += 1;
    return { ok: true };
  }
}

describe('要求の確認（データベースを使わない部分）', () => {
  const guestLog = new MemoryRequestLogSink();
  let guest: INestApplication;
  let staff: INestApplication;

  beforeAll(async () => {
    guest = await createTestListenerApp('guest', {
      controllers: [GuestGuardTestController],
      logSink: guestLog,
    });
    staff = await createTestListenerApp('staff', { controllers: [StaffGuardTestController] });
  });
  afterAll(async () => {
    await guest?.close();
    await staff?.close();
  });
  beforeEach(() => {
    calls.guest = 0;
    calls.staff = 0;
    guestLog.entries.length = 0;
  });

  describe('他サイトからの要求の拒否（独自のヘッダー X-Requested-With: XMLHttpRequest。設計の補足 L-3）', () => {
    it.each(['post', 'put', 'patch', 'delete'] as const)(
      '[TC-MB-139] 公開用 API で、独自のヘッダーのない状態を変える要求（%s）は FORBIDDEN（403）で、処理を行わない',
      async (method) => {
        const res = await request(guest.getHttpServer())[method]('/api/guest/test-guards/public');
        expect(res.status).toBe(403);
        expect(ApiErrorSchema.parse(res.body).code).toBe('FORBIDDEN');
        expect(calls.guest).toBe(0);

        const allowed = await request(guest.getHttpServer())
          [method]('/api/guest/test-guards/public')
          .set(CSRF_HEADERS);
        expect(allowed.status).toBe(200);
        expect(calls.guest).toBe(1);
      },
    );

    it('[L-3] 値が XMLHttpRequest でなければ拒否する', async () => {
      const res = await request(guest.getHttpServer())
        .post('/api/guest/test-guards/public')
        .set('X-Requested-With', 'fetch');
      expect(res.status).toBe(403);
      expect(calls.guest).toBe(0);
    });

    it('[L-3] 状態を変えない要求（GET・HEAD）は、独自のヘッダーがなくても受け付ける', async () => {
      expect(
        (await request(guest.getHttpServer()).get('/api/guest/test-guards/public')).status,
      ).toBe(200);
      expect(
        (await request(guest.getHttpServer()).head('/api/guest/test-guards/public')).status,
      ).toBe(200);
    });

    it('[TC-MB-206][2.4] 社内用 API でも、独自のヘッダーのない状態を変える要求は FORBIDDEN（「権限がありません」）', async () => {
      const res = await request(staff.getHttpServer()).post('/api/staff/test-guards/anonymous');
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ code: 'FORBIDDEN', message: '権限がありません' });
      expect(calls.staff).toBe(0);

      const allowed = await request(staff.getHttpServer())
        .post('/api/staff/test-guards/anonymous')
        .set(CSRF_HEADERS);
      expect(allowed.status).toBe(200);
      expect(calls.staff).toBe(1);
    });

    it('[TC-MB-200] 存在しない URL への状態を変える要求は、独自のヘッダーがなくても NOT_FOUND（404）', async () => {
      const onGuest = await request(guest.getHttpServer()).post('/api/staff/auth/login');
      expect(onGuest.status).toBe(404);
      expect(onGuest.body.code).toBe('NOT_FOUND');
      const onStaff = await request(staff.getHttpServer()).post('/api/staff/no-such-api');
      expect(onStaff.status).toBe(404);
    });
  });

  describe('ログインの確認', () => {
    it('[TC-MB-193][2.4] 社内用 API はログインしていなければ UNAUTHENTICATED（401）で、役割が必要な操作でも FORBIDDEN にしない', async () => {
      for (const path of ['/api/staff/test-guards/any-staff', '/api/staff/test-guards/front']) {
        const res = await request(staff.getHttpServer()).get(path);
        expect(res.status).toBe(401);
        expect(ApiErrorSchema.parse(res.body).code).toBe('UNAUTHENTICATED');
      }
      const write = await request(staff.getHttpServer())
        .post('/api/staff/test-guards/front')
        .set(CSRF_HEADERS);
      expect(write.status).toBe(401);
      expect(calls.staff).toBe(0);
    });

    it('[L-3] 独自のヘッダーの確認はログインの確認より先に行う（他サイトからの要求でセッションを延ばさない）', async () => {
      const res = await request(staff.getHttpServer()).post('/api/staff/test-guards/front');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('[2.2] 社内用の稼働確認はログインせずに使える', async () => {
      expect((await request(staff.getHttpServer()).get('/api/staff/health')).status).toBe(200);
    });

    it('[1.10] 公開用 API の会員だけの操作は、ログインしていなければ UNAUTHENTICATED（401）', async () => {
      const res = await request(guest.getHttpServer()).get('/api/guest/test-guards/member');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('[TC-MB-204] 公開用 API はスタッフのセッションの Cookie を読まない（UNAUTHENTICATED）', async () => {
      const res = await request(guest.getHttpServer())
        .get('/api/guest/test-guards/member')
        .set('Cookie', `${SESSION_COOKIE_NAMES.STAFF}=${generateSessionToken()}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('ログインしていない要求は、要求のログの利用者の種類が ANONYMOUS', async () => {
      await request(guest.getHttpServer()).get('/api/guest/test-guards/public');
      await expect.poll(() => guestLog.entries.length).toBe(1);
      expect(guestLog.entries[0]?.userType).toBe('ANONYMOUS');
    });
  });

  describe('ApiError.message の言語（設計の補足 L-11）', () => {
    it.each([
      ['ko', 'ko'],
      ['en-US,en;q=0.9', 'en'],
      ['zh-TW', 'zh-Hant'],
      ['zh-Hans', 'zh-Hans'],
      [undefined, 'ja'],
    ] as const)(
      '[TC-MB-284][16.2] ログインしていない宿泊客は Accept-Language（%s）の言語（%s）の文言になる',
      async (header, locale) => {
        const req = request(guest.getHttpServer()).get('/api/guest/test-guards/booking-window');
        const res = header === undefined ? await req : await req.set('Accept-Language', header);
        expect(res.status).toBe(422);
        expect(res.body).toEqual({
          code: 'OUT_OF_BOOKING_WINDOW',
          message: errorMessage('OUT_OF_BOOKING_WINDOW', locale),
        });
      },
    );

    it('[16.2] 公開用 API の存在しない URL と、他サイトからの要求の拒否も、選んだ言語の文言になる', async () => {
      const notFound = await request(guest.getHttpServer())
        .get('/api/guest/no-such-page')
        .set('Accept-Language', 'en');
      expect(notFound.body).toEqual({
        code: 'NOT_FOUND',
        message: errorMessage('NOT_FOUND', 'en'),
      });

      const forbidden = await request(guest.getHttpServer())
        .post('/api/guest/test-guards/public')
        .set('Accept-Language', 'ko');
      expect(forbidden.body).toEqual({
        code: 'FORBIDDEN',
        message: errorMessage('FORBIDDEN', 'ko'),
      });
    });

    it('[TC-MB-302][16.6] 社内用 API は Accept-Language にかかわらず日本語の文言', async () => {
      const unauthenticated = await request(staff.getHttpServer())
        .get('/api/staff/test-guards/front')
        .set('Accept-Language', 'en');
      expect(unauthenticated.body).toEqual({
        code: 'UNAUTHENTICATED',
        message: errorMessage('UNAUTHENTICATED', 'ja'),
      });

      const forbidden = await request(staff.getHttpServer())
        .post('/api/staff/test-guards/anonymous')
        .set('Accept-Language', 'en');
      expect(forbidden.body).toEqual({ code: 'FORBIDDEN', message: '権限がありません' });
    });
  });
});
