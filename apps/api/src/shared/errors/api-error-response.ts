// 例外を、契約のエラーの形（ApiError）と HTTP ステータスに変換する
// （design.md「Error Handling > Error Categories and Responses」）。
// HTTP ステータスは、常にエラーコードに対応する契約の値（ERROR_HTTP_STATUS）にする。
import {
  ERROR_HTTP_STATUS,
  FORBIDDEN_MESSAGE,
  type ApiError,
  type ErrorCode,
  type ErrorDetails,
} from '@hotel/contracts';
import { HttpException } from '@nestjs/common';
import { BusinessError } from './business-error.js';
import { defaultErrorMessage } from './error-messages.js';

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

export function toApiErrorResponse(exception: unknown): ApiErrorResponse {
  if (exception instanceof BusinessError) {
    return build(exception.code, exception.message, exception.details);
  }
  if (exception instanceof HttpException) {
    // フレームワークの英語の文言（URL などを含む）は返さず、エラーコードの既定の文言にする
    return build(errorCodeForHttpStatus(exception.getStatus()));
  }
  return build('INTERNAL');
}

function build(code: ErrorCode, message?: string, details?: ErrorDetails): ApiErrorResponse {
  const status = ERROR_HTTP_STATUS[code];
  if (code === 'INTERNAL') {
    // 想定外の障害の内容は利用者に返さない（サーバーのログにだけ残す）
    return { status, body: { code, message: defaultErrorMessage(code) } };
  }
  const body: ApiError = {
    code,
    // FORBIDDEN の文言は「権限がありません」に固定する（要件 2.4、設計の補足 L-33）
    message: code === 'FORBIDDEN' ? FORBIDDEN_MESSAGE : (message ?? defaultErrorMessage(code)),
  };
  if (details !== undefined) {
    body.details = details;
  }
  return { status, body };
}
