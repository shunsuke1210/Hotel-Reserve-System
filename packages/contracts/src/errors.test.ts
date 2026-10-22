import { describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  ErrorCodeSchema,
  FORBIDDEN_MESSAGE,
  type ErrorCode,
} from './errors.js';

// design.md「Error Handling > Error Categories and Responses」の表（設計の補足 L-1・L-51 で加えた行を含む）。
// 1行に2つのコードがある行は、コードごとに分けて書く。
const DESIGN_ERROR_TABLE: ReadonlyArray<readonly [string, number]> = [
  ['VALIDATION_FAILED', 400],
  ['UNAUTHENTICATED', 401],
  ['TOKEN_INVALID', 400],
  ['INVALID_CREDENTIALS', 401],
  ['EMAIL_NOT_VERIFIED', 403],
  ['FORBIDDEN', 403],
  ['NOT_FOUND', 404],
  ['EMAIL_ALREADY_REGISTERED', 409],
  ['PHONE_ALREADY_REGISTERED', 409],
  ['NO_AVAILABILITY', 409],
  ['ALREADY_CONFIRMED', 409],
  ['HOLD_ALREADY_EXISTS', 409],
  ['HOLD_EXPIRED', 409],
  ['PRICE_CHANGED', 409],
  ['QUOTE_OUTDATED', 409],
  ['ROOM_OCCUPIED', 409],
  ['ROOM_OUT_OF_ORDER', 409],
  ['EXTENSION_ROOM_UNAVAILABLE', 409],
  ['OUT_OF_BOOKING_WINDOW', 422],
  ['SAME_DAY_CUTOFF_PASSED', 422],
  ['CAPACITY_EXCEEDED', 422],
  ['ROOMS_EXCEED_ADULTS', 422],
  ['MIXED_ROOM_TYPES_NOT_ALLOWED', 422],
  ['EARLY_BIRD_REQUIRES_PREPAID', 422],
  ['TERMS_NOT_AGREED', 422],
  ['UNDER_CAPACITY_CONFIRMATION_REQUIRED', 422],
  ['UPGRADE_KIND_REQUIRED', 422],
  ['CHECKED_IN_ROOM_CHANGE_NOT_ALLOWED', 422],
  ['ROSTER_INCOMPLETE', 422],
  ['ROOM_NOT_CLEAN', 422],
  ['UNSETTLED_BALANCE', 422],
  ['STATUS_TRANSITION_NOT_ALLOWED', 422],
  ['HAS_ACTIVE_RESERVATION', 422],
  ['HAS_UNPAID_BALANCE', 422],
  ['NOT_CANCELLABLE', 422],
  ['NOT_MODIFIABLE', 422],
  ['EARLY_CHECKOUT_REQUIRED', 422],
  ['RESERVATION_STATUS_INVALID', 422],
  ['OVERLAPPING_PERIOD', 409],
  ['AMOUNT_EXCEEDS_BALANCE', 422],
  ['MEMBER_REQUIRED', 422],
  ['PAYMENT_DECLINED', 402],
  ['PAYMENT_GATEWAY_UNAVAILABLE', 503],
  ['RATE_LIMITED', 429],
  ['INTERNAL', 500],
];

describe('エラーコードと HTTP ステータス', () => {
  it('エラーコードの一覧は、設計の Error Handling の表のコードと過不足なく一致する', () => {
    const designCodes = DESIGN_ERROR_TABLE.map(([code]) => code);
    expect([...ERROR_CODES].sort()).toEqual([...designCodes].sort());
  });

  it('エラーコードの一覧に重複がない', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('HTTP ステータスの対応表は、一覧のすべてのコードを持ち、ほかのコードを持たない', () => {
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it.each(DESIGN_ERROR_TABLE)('%s は HTTP %i を返す', (code, status) => {
    expect(ERROR_HTTP_STATUS[code as ErrorCode]).toBe(status);
  });

  it('[1.10] 他人の予約・存在しない予約に返す NOT_FOUND は HTTP 404', () => {
    expect(ERROR_CODES).toContain('NOT_FOUND');
    expect(ERROR_HTTP_STATUS.NOT_FOUND).toBe(404);
  });

  it('[2.4] 役割の権限がないときの FORBIDDEN は HTTP 403 で、メッセージは「権限がありません」', () => {
    expect(ERROR_CODES).toContain('FORBIDDEN');
    expect(ERROR_HTTP_STATUS.FORBIDDEN).toBe(403);
    expect(FORBIDDEN_MESSAGE).toBe('権限がありません');
  });
});

describe('エラーコードのスキーマ', () => {
  it('一覧のすべてのコードを受け付ける', () => {
    for (const code of ERROR_CODES) {
      expect(ErrorCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it.each(['UNKNOWN_ERROR', 'not_found', 'Forbidden', '', 404])(
    '一覧にない値 %j を拒否する',
    (value) => {
      expect(ErrorCodeSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('ApiError の形', () => {
  it('[1.10] code と message だけのエラーを受け付ける', () => {
    const error = { code: 'NOT_FOUND', message: '予約が見つかりません' };
    expect(ApiErrorSchema.parse(error)).toEqual(error);
  });

  it('[2.4] FORBIDDEN のエラーを「権限がありません」のメッセージで受け付ける', () => {
    const error = { code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE };
    expect(ApiErrorSchema.parse(error)).toEqual(error);
  });

  it('details に文字列・数値・真偽値の値を持つエラーを受け付ける', () => {
    const error = {
      code: 'UNSETTLED_BALANCE',
      message: '未精算の金額があります',
      details: { balance: 12000, reservationNumber: 'AB12CD34EF', overpaid: false },
    };
    expect(ApiErrorSchema.parse(error)).toEqual(error);
  });

  it('一覧にないコードのエラーを拒否する', () => {
    expect(ApiErrorSchema.safeParse({ code: 'UNKNOWN_ERROR', message: 'x' }).success).toBe(false);
  });

  it('code がないエラーを拒否する', () => {
    expect(ApiErrorSchema.safeParse({ message: 'x' }).success).toBe(false);
  });

  it('message がないエラーを拒否する', () => {
    expect(ApiErrorSchema.safeParse({ code: 'NOT_FOUND' }).success).toBe(false);
  });

  it('message が文字列でないエラーを拒否する', () => {
    expect(ApiErrorSchema.safeParse({ code: 'NOT_FOUND', message: 404 }).success).toBe(false);
  });

  it.each([
    ['オブジェクト', { nested: { a: 1 } }],
    ['配列', { list: [1, 2] }],
    ['null', { value: null }],
  ])('details の値が%sのエラーを拒否する', (_label, details) => {
    const error = { code: 'VALIDATION_FAILED', message: '入力に誤りがあります', details };
    expect(ApiErrorSchema.safeParse(error).success).toBe(false);
  });

  it('details が配列のエラーを拒否する', () => {
    const error = { code: 'VALIDATION_FAILED', message: '入力に誤りがあります', details: ['a'] };
    expect(ApiErrorSchema.safeParse(error).success).toBe(false);
  });
});
