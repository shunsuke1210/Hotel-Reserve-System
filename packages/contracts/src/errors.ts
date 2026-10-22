// エラーコードとエラーの形（ApiError）。
// コードと HTTP ステータスは design.md「Error Handling > Error Categories and Responses」の表
// （設計の補足 L-1・L-51 で加えた行を含む）のとおり。
import { z } from 'zod';

/** API が返すエラーコードの一覧（Error Handling の表の順）。 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'TOKEN_INVALID',
  'INVALID_CREDENTIALS',
  'EMAIL_NOT_VERIFIED',
  'FORBIDDEN',
  'NOT_FOUND',
  'EMAIL_ALREADY_REGISTERED',
  'PHONE_ALREADY_REGISTERED',
  'NO_AVAILABILITY',
  'ALREADY_CONFIRMED',
  'HOLD_ALREADY_EXISTS',
  'HOLD_EXPIRED',
  'PRICE_CHANGED',
  'QUOTE_OUTDATED',
  'ROOM_OCCUPIED',
  'ROOM_OUT_OF_ORDER',
  'EXTENSION_ROOM_UNAVAILABLE',
  'OUT_OF_BOOKING_WINDOW',
  'SAME_DAY_CUTOFF_PASSED',
  'CAPACITY_EXCEEDED',
  'ROOMS_EXCEED_ADULTS',
  'MIXED_ROOM_TYPES_NOT_ALLOWED',
  'EARLY_BIRD_REQUIRES_PREPAID',
  'TERMS_NOT_AGREED',
  'UNDER_CAPACITY_CONFIRMATION_REQUIRED',
  'UPGRADE_KIND_REQUIRED',
  'CHECKED_IN_ROOM_CHANGE_NOT_ALLOWED',
  'ROSTER_INCOMPLETE',
  'ROOM_NOT_CLEAN',
  'UNSETTLED_BALANCE',
  'STATUS_TRANSITION_NOT_ALLOWED',
  'HAS_ACTIVE_RESERVATION',
  'HAS_UNPAID_BALANCE',
  'NOT_CANCELLABLE',
  'NOT_MODIFIABLE',
  'EARLY_CHECKOUT_REQUIRED',
  'RESERVATION_STATUS_INVALID',
  'OVERLAPPING_PERIOD',
  'AMOUNT_EXCEEDS_BALANCE',
  'MEMBER_REQUIRED',
  'PAYMENT_DECLINED',
  'PAYMENT_GATEWAY_UNAVAILABLE',
  'RATE_LIMITED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export const ErrorCodeSchema = z.enum(ERROR_CODES);

/** エラーコードごとの HTTP ステータス。 */
export const ERROR_HTTP_STATUS = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  TOKEN_INVALID: 400,
  INVALID_CREDENTIALS: 401,
  EMAIL_NOT_VERIFIED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EMAIL_ALREADY_REGISTERED: 409,
  PHONE_ALREADY_REGISTERED: 409,
  NO_AVAILABILITY: 409,
  ALREADY_CONFIRMED: 409,
  HOLD_ALREADY_EXISTS: 409,
  HOLD_EXPIRED: 409,
  PRICE_CHANGED: 409,
  QUOTE_OUTDATED: 409,
  ROOM_OCCUPIED: 409,
  ROOM_OUT_OF_ORDER: 409,
  EXTENSION_ROOM_UNAVAILABLE: 409,
  OUT_OF_BOOKING_WINDOW: 422,
  SAME_DAY_CUTOFF_PASSED: 422,
  CAPACITY_EXCEEDED: 422,
  ROOMS_EXCEED_ADULTS: 422,
  MIXED_ROOM_TYPES_NOT_ALLOWED: 422,
  EARLY_BIRD_REQUIRES_PREPAID: 422,
  TERMS_NOT_AGREED: 422,
  UNDER_CAPACITY_CONFIRMATION_REQUIRED: 422,
  UPGRADE_KIND_REQUIRED: 422,
  CHECKED_IN_ROOM_CHANGE_NOT_ALLOWED: 422,
  ROSTER_INCOMPLETE: 422,
  ROOM_NOT_CLEAN: 422,
  UNSETTLED_BALANCE: 422,
  STATUS_TRANSITION_NOT_ALLOWED: 422,
  HAS_ACTIVE_RESERVATION: 422,
  HAS_UNPAID_BALANCE: 422,
  NOT_CANCELLABLE: 422,
  NOT_MODIFIABLE: 422,
  EARLY_CHECKOUT_REQUIRED: 422,
  RESERVATION_STATUS_INVALID: 422,
  OVERLAPPING_PERIOD: 409,
  AMOUNT_EXCEEDS_BALANCE: 422,
  MEMBER_REQUIRED: 422,
  PAYMENT_DECLINED: 402,
  PAYMENT_GATEWAY_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const satisfies Record<ErrorCode, number>;
export type ErrorHttpStatus = (typeof ERROR_HTTP_STATUS)[ErrorCode];

/** 社内用 API の FORBIDDEN の ApiError.message（要件 2.4、設計の補足 L-33）。 */
export const FORBIDDEN_MESSAGE = '権限がありません';

/** エラーの補足情報（値は文字列・数値・真偽値だけ）。 */
export type ErrorDetails = Record<string, string | number | boolean>;
export const ErrorDetailsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);

/** API のエラーの形。 */
export interface ApiError {
  code: ErrorCode;
  /** 宿泊客向けは選んだ言語、スタッフ向けは日本語 */
  message: string;
  details?: ErrorDetails;
}
export const ApiErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: ErrorDetailsSchema.optional(),
}) satisfies z.ZodType<ApiError>;

/** 業務の処理の結果（成功なら値、失敗ならエラーコード）。 */
export type Result<T, E extends ErrorCode = ErrorCode> =
  { ok: true; value: T } | { ok: false; error: E; details?: ErrorDetails };
