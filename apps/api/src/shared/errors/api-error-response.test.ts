import {
  ApiErrorSchema,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  FORBIDDEN_MESSAGE,
  type ErrorCode,
  type Result,
} from '@hotel/contracts';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { toApiErrorResponse } from './api-error-response.js';
import { BusinessError, unwrapResult } from './business-error.js';

describe('toApiErrorResponse（例外を契約のエラーの形に変換する）', () => {
  it.each(ERROR_CODES)('業務エラー %s は、契約の HTTP ステータスと ApiError の形になる', (code) => {
    const { status, body } = toApiErrorResponse(new BusinessError(code));
    expect(status).toBe(ERROR_HTTP_STATUS[code]);
    expect(ApiErrorSchema.parse(body)).toEqual(body);
    expect(body.code).toBe(code);
    expect(body.message.length).toBeGreaterThan(0);
  });

  it('業務エラーの文言と補足情報（details）をそのまま返す', () => {
    const error = new BusinessError('HOLD_EXPIRED', {
      message: '確保の期限が切れました',
      details: { reservationId: 'r-1', remaining: 0, retryable: false },
    });
    expect(toApiErrorResponse(error)).toEqual({
      status: 409,
      body: {
        code: 'HOLD_EXPIRED',
        message: '確保の期限が切れました',
        details: { reservationId: 'r-1', remaining: 0, retryable: false },
      },
    });
  });

  it('[2.4] FORBIDDEN は 403 で、文言は常に「権限がありません」になる', () => {
    expect(toApiErrorResponse(new BusinessError('FORBIDDEN'))).toEqual({
      status: 403,
      body: { code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE },
    });
    expect(
      toApiErrorResponse(new BusinessError('FORBIDDEN', { message: 'Forbidden resource' })).body
        .message,
    ).toBe('権限がありません');
  });

  it.each<[string, HttpException, number, ErrorCode]>([
    [
      '400 Bad Request',
      new BadRequestException('Unexpected token } in JSON'),
      400,
      'VALIDATION_FAILED',
    ],
    ['401 Unauthorized', new UnauthorizedException(), 401, 'UNAUTHENTICATED'],
    ['403 Forbidden', new ForbiddenException('Forbidden resource'), 403, 'FORBIDDEN'],
    ['404 Not Found', new NotFoundException('Cannot GET /api/staff/health'), 404, 'NOT_FOUND'],
    ['429 Too Many Requests', new HttpException('ThrottlerException', 429), 429, 'RATE_LIMITED'],
    ['413 Payload Too Large', new PayloadTooLargeException(), 400, 'VALIDATION_FAILED'],
    ['415 Unsupported Media Type', new UnsupportedMediaTypeException(), 400, 'VALIDATION_FAILED'],
    ['503 Service Unavailable', new ServiceUnavailableException(), 500, 'INTERNAL'],
  ])(
    'フレームワークの例外（%s）は、対応するエラーコードと契約の HTTP ステータスになる',
    (_, exception, status, code) => {
      const response = toApiErrorResponse(exception);
      expect(response.status).toBe(status);
      expect(response.status).toBe(ERROR_HTTP_STATUS[code]);
      expect(response.body.code).toBe(code);
      expect(ApiErrorSchema.parse(response.body)).toEqual(response.body);
    },
  );

  it('フレームワークの例外の英語の文言（URL などを含む）を応答に含めない', () => {
    const { body } = toApiErrorResponse(new NotFoundException('Cannot GET /api/staff/health'));
    expect(JSON.stringify(body)).not.toContain('Cannot GET');
    expect(JSON.stringify(body)).not.toContain('/api/staff');
  });

  it('[2.4] 権限の確認で拒否された例外（403）は、FORBIDDEN と「権限がありません」になる', () => {
    expect(toApiErrorResponse(new ForbiddenException('Forbidden resource'))).toEqual({
      status: 403,
      body: { code: 'FORBIDDEN', message: '権限がありません' },
    });
  });

  it.each<[string, unknown]>([
    ['Error', new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret')],
    ['TypeError', new TypeError("Cannot read properties of undefined (reading 'secret')")],
    ['文字列', 'secret string'],
    ['null', null],
  ])('想定外の例外（%s）は INTERNAL（500）にし、例外の内容を返さない', (_, exception) => {
    const { status, body } = toApiErrorResponse(exception);
    expect(status).toBe(500);
    expect(ApiErrorSchema.parse(body)).toEqual(body);
    expect(body.code).toBe('INTERNAL');
    expect(body.details).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
  });
});

describe('unwrapResult（業務の処理の結果を値またはエラーにする）', () => {
  it('成功なら値を返す', () => {
    const result: Result<{ id: string }> = { ok: true, value: { id: 'r-1' } };
    expect(unwrapResult(result)).toEqual({ id: 'r-1' });
  });

  it('失敗なら、エラーコードと補足情報を持つ BusinessError を投げる', () => {
    const result: Result<number, 'NO_AVAILABILITY'> = {
      ok: false,
      error: 'NO_AVAILABILITY',
      details: { roomTypeId: 'twin' },
    };
    let thrown: unknown;
    try {
      unwrapResult(result);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BusinessError);
    expect(toApiErrorResponse(thrown)).toEqual({
      status: 409,
      body: {
        code: 'NO_AVAILABILITY',
        message: expect.any(String),
        details: { roomTypeId: 'twin' },
      },
    });
  });
});
