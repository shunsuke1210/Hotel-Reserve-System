// エラーの既定の文言（日本語）。業務エラーを投げる側が文言を渡さなかったときと、
// フレームワークが出す例外（URL が見つからない、JSON の形式の誤りなど）に使う。
// 業務ルールごとの文言は、各機能のタスクで業務エラーを投げる側が渡す。
import { FORBIDDEN_MESSAGE, type ErrorCode } from '@hotel/contracts';

const DEFAULT_MESSAGES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: '入力内容に誤りがあります',
  UNAUTHENTICATED: 'ログインしてください',
  FORBIDDEN: FORBIDDEN_MESSAGE,
  NOT_FOUND: '見つかりません',
  RATE_LIMITED: 'しばらく時間をおいてから、もう一度お試しください',
  INTERNAL: 'システムでエラーが発生しました。しばらく時間をおいてから、もう一度お試しください',
};

const FALLBACK_MESSAGE = '要求を処理できませんでした';

export function defaultErrorMessage(code: ErrorCode): string {
  return DEFAULT_MESSAGES[code] ?? FALLBACK_MESSAGE;
}
