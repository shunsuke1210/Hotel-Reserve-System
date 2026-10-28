// 1つの要求の文脈（要求 ID・待ち受け口・利用者の種類・結果のコード・ログイン中の会員の言語）。
// 要求のログの仕組みが要求の始めに作り、エラーの変換（ApiExceptionFilter）が結果のコードを、
// セッションの確認（shared/session の MemberAuthGuard・StaffAuthGuard）が利用者の種類と会員の言語を書き込む。
import type { ErrorCode, Locale } from '@hotel/contracts';

/** 待ち受け口（公開用 GuestApp・社内用 StaffApp。ADR-03） */
export type ListenerName = 'guest' | 'staff';

/** 利用者の種類。ログインしていなければ ANONYMOUS */
export type UserType = 'ANONYMOUS' | 'MEMBER' | 'STAFF';

export interface RequestContext {
  readonly requestId: string;
  readonly listener: ListenerName;
  userType: UserType;
  /** エラーで応答したときの ApiError のコード */
  errorCode?: ErrorCode;
  /** ログイン中の会員の preferred_locale（公開用 API の文言の言語。設計の補足 L-11） */
  preferredLocale?: Locale;
}

const contexts = new WeakMap<object, RequestContext>();

export function attachRequestContext(request: object, context: RequestContext): void {
  contexts.set(request, context);
}

export function findRequestContext(request: object): RequestContext | undefined {
  return contexts.get(request);
}
