import type { ErrorCode, ErrorDetails, Result } from '@hotel/contracts';
import { defaultErrorMessage, type LocalizedText } from './error-messages.js';

export interface BusinessErrorOptions {
  /**
   * 利用者に示す文言（省略時はエラーコードの既定の文言を、要求の言語で返す）。
   * - 文字列：日本語の文言。社内用 API と、公開用 API の日本語の要求でだけ使い、ほかの言語では既定の文言にする
   * - LocalizedText：5言語の文言。要求の言語の文言を返す（宿泊客向けに独自の文言が要るとき）
   */
  message?: string | LocalizedText;
  /** 画面が使う補足情報（個人情報の値は入れない） */
  details?: ErrorDetails;
}

/**
 * 業務ルールの違反などを表す例外。
 * ApiExceptionFilter が、契約のエラーの形（ApiError）と、エラーコードに対応する HTTP ステータスに変換する。
 * Error.message（サーバーのログに出る文言）は日本語。
 */
export class BusinessError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails | undefined;
  /** 投げる側が渡した文言（なければ undefined。応答の文言は要求の言語で決める） */
  readonly userMessage: string | LocalizedText | undefined;

  constructor(code: ErrorCode, options: BusinessErrorOptions = {}) {
    const { message } = options;
    super(typeof message === 'string' ? message : (message?.ja ?? defaultErrorMessage(code)));
    this.name = 'BusinessError';
    this.code = code;
    this.details = options.details;
    this.userMessage = message;
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
