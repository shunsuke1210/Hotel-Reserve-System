import { ApiErrorSchema, ERROR_HTTP_STATUS, type ErrorCode } from '@hotel/contracts';
import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  UseGuards,
  type CanActivate,
  type INestApplication,
} from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BusinessError } from '../shared/errors/business-error.js';
import { AllowAnonymous } from '../shared/session/auth.decorators.js';
import { createTestListenerApp } from './listener-app.js';

/**
 * 常に拒否する確認（フレームワークの ForbiddenException の変換を確かめる）。
 * 役割の判定そのもの（RolesGuard）は shared/session/session.integration.test.ts で確かめる
 */
class DenyAllGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

/** テストのためだけに、例外を投げる URL を用意する（社内用 API でもログインせずに呼べるようにする） */
@AllowAnonymous()
@Controller('test-errors')
class ErrorTestController {
  @Get('business/:code')
  business(@Param('code') code: string): never {
    throw new BusinessError(code as ErrorCode, { details: { field: 'arrivalDate' } });
  }

  @Get('unexpected')
  unexpected(): never {
    throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret');
  }

  @Get('guarded')
  @UseGuards(DenyAllGuard)
  guarded(): string {
    return 'should not be reached';
  }

  @Post('echo')
  echo(@Body() body: unknown): unknown {
    return body;
  }
}

describe('業務エラーを契約のエラーの形（ApiError）に変換する', () => {
  let guest: INestApplication;
  let staff: INestApplication;

  beforeAll(async () => {
    guest = await createTestListenerApp('guest', { controllers: [ErrorTestController] });
    staff = await createTestListenerApp('staff', { controllers: [ErrorTestController] });
  });
  afterAll(async () => {
    await guest?.close();
    await staff?.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('[2.4] 社内用 API で権限の確認に拒否された操作は、403・FORBIDDEN・「権限がありません」を返す', async () => {
    const res = await request(staff.getHttpServer()).get('/api/staff/test-errors/guarded');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ code: 'FORBIDDEN', message: '権限がありません' });
  });

  it('[2.4] FORBIDDEN の業務エラーも、403 と「権限がありません」を返す', async () => {
    const res = await request(staff.getHttpServer()).get(
      '/api/staff/test-errors/business/FORBIDDEN',
    );
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN', message: '権限がありません' });
  });

  it.each<[ErrorCode]>([
    ['HOLD_EXPIRED'],
    ['UNSETTLED_BALANCE'],
    ['PAYMENT_DECLINED'],
    ['RATE_LIMITED'],
  ])(
    '業務エラー %s は、公開用・社内用のどちらでも契約の HTTP ステータスと ApiError の形で返す',
    async (code) => {
      for (const [app, prefix] of [
        [guest, '/api/guest'],
        [staff, '/api/staff'],
      ] as const) {
        const res = await request(app.getHttpServer()).get(
          `${prefix}/test-errors/business/${code}`,
        );
        expect(res.status).toBe(ERROR_HTTP_STATUS[code]);
        expect(ApiErrorSchema.parse(res.body)).toEqual(res.body);
        expect(res.body).toMatchObject({ code, details: { field: 'arrivalDate' } });
        expect(res.headers['content-type']).toMatch(/^application\/json/);
      }
    },
  );

  it('想定外の例外は INTERNAL（500）を返し、例外の内容を応答に含めず、要求 ID とともにサーバーのログに残す', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const res = await request(guest.getHttpServer()).get('/api/guest/test-errors/unexpected');
    expect(res.status).toBe(500);
    expect(ApiErrorSchema.parse(res.body)).toEqual(res.body);
    expect(res.body.code).toBe('INTERNAL');
    expect(res.text).not.toContain('secret');
    expect(res.text).not.toContain('10.0.0.5');
    expect(res.text).not.toContain('ECONNREFUSED');

    expect(errorLog).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errorLog.mock.calls[0]);
    expect(logged).toContain(res.headers['x-request-id']);
    expect(logged).toContain('ECONNREFUSED');
  });

  it('JSON の形式の誤った要求の本文は、VALIDATION_FAILED（400）を返す', async () => {
    const res = await request(guest.getHttpServer())
      .post('/api/guest/test-errors/echo')
      .set('Content-Type', 'application/json')
      .send('{"email": "taro@example.com",');
    expect(res.status).toBe(400);
    expect(ApiErrorSchema.parse(res.body).code).toBe('VALIDATION_FAILED');
    expect(res.text).not.toContain('taro@example.com');
  });
});
