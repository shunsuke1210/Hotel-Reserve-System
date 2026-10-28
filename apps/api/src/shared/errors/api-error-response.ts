// 例外を、契約のエラーの形（ApiError）と HTTP ステータスに変換する
// （design.md「Error Handling > Error Categories and Responses」）。
// HTTP ステータスは、常にエラーコードに対応する契約の値（ERROR_HTTP_STATUS）にする。
// 文言は要求の言語（公開用 API は選んだ言語、社内用 API は日本語。設計の補足 L-11）で作る。
import {
  ERROR_HTTP_STATUS,
  type ApiError,
  type ErrorCode,
  type ErrorDetails,
  type Locale,
} from '@hotel/contracts';
import { HttpException } from '@nestjs/common';
import { DEFAULT_LOCALE } from '../i18n/locale.js';
import { BusinessError } from './business-error.js';
import { errorMessage, type LocalizedText } from './error-messages.js';

export interface ApiErrorResponse {
  status: number;
  body: ApiError;
}

/** フレームワークが出す例外の HTTP ステータスに対応するエラーコード */
const CODE_BY_HTTP_STATUS: Readonly<Partial<Record<number, ErrorCode>>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
};

/**
 * HTTP ステータスに対応するエラーコード。
 * 個別の対応がない 4xx（413・415 など）は要求の誤りとして VALIDATION_FAILED、それ以外は INTERNAL。
 */
export function errorCodeForHttpStatus(status: number): ErrorCode {
  const code = CODE_BY_HTTP_STATUS[status];
  if (code) {
    return code;
  }
  return status >= 400 && status < 500 ? 'VALIDATION_FAILED' : 'INTERNAL';
}

/**
 * 例外を ApiError と HTTP ステータスにする。
 * @param locale 文言の言語（要求の言語。shared/i18n/request-locale.ts の requestLocale。省略時は日本語）
 */
export function toApiErrorResponse(
  exception: unknown,
  locale: Locale = DEFAULT_LOCALE,
): ApiErrorResponse {
  if (exception instanceof BusinessError) {
    return build(locale, exception.code, exception.userMessage, exception.details);
  }
  if (exception instanceof HttpException) {
    // フレームワークの英語の文言（URL などを含む）は返さず、エラーコードの既定の文言にする
    return build(locale, errorCodeForHttpStatus(exception.getStatus()));
  }
  return build(locale, 'INTERNAL');
}

function build(
  locale: Locale,
  code: ErrorCode,
  message?: string | LocalizedText,
  details?: ErrorDetails,
): ApiErrorResponse {
  const status = ERROR_HTTP_STATUS[code];
  if (code === 'INTERNAL') {
    // 想定外の障害の内容は利用者に返さない（サーバーのログにだけ残す）
    return { status, body: { code, message: errorMessage(code, locale) } };
  }
  const body: ApiError = { code, message: localizedMessage(locale, code, message) };
  if (details !== undefined) {
    body.details = details;
  }
  return { status, body };
}

function localizedMessage(
  locale: Locale,
  code: ErrorCode,
  message: string | LocalizedText | undefined,
): string {
  // FORBIDDEN の文言は既定の文言（日本語は「権限がありません」）に固定する（要件 2.4、設計の補足 L-33）
  if (code === 'FORBIDDEN' || message === undefined) {
    return errorMessage(code, locale);
  }
  if (typeof message === 'string') {
    // 日本語だけの文言は、日本語の要求にだけ使う
    return locale === 'ja' ? message : errorMessage(code, locale);
  }
  return message[locale];
}
