import type { ErrorCode, ErrorDetails, Result } from '@hotel/contracts';
import { defaultErrorMessage } from './error-messages.js';

export interface BusinessErrorOptions {
  /** 利用者に示す文言（省略時はエラーコードの既定の文言） */
  message?: string;
  /** 画面が使う補足情報（個人情報の値は入れない） */
  details?: ErrorDetails;
}

/**
 * 業務ルールの違反などを表す例外。
 * ApiExceptionFilter が、契約のエラーの形（ApiError）と、エラーコードに対応する HTTP ステータスに変換する。
 */
export class BusinessError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails | undefined;

  constructor(code: ErrorCode, options: BusinessErrorOptions = {}) {
    super(options.message ?? defaultErrorMessage(code));
    this.name = 'BusinessError';
    this.code = code;
    this.details = options.details;
  }
}

/**
 * 業務の処理の結果（Result）を、成功なら値に、失敗なら BusinessError にする。
 * コントローラーがサービスの結果を応答にするときに使う。
 */
export function unwrapResult<T, E extends ErrorCode>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw new BusinessError(result.error, { details: result.details });
}
