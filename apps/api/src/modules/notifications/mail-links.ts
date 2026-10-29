// メールに載せる宿泊客アプリのリンク（design-screens.md G06・G08・G20・G03）。
//
// 確認・再設定・配信停止の画面の URL は、ここで決めた（design-screens.md に URL の定めがないため。技術の細部）。
// 宿泊客アプリの画面（8.x）は同じパスで作り、クエリの token を読んで公開用 API（POST /auth/verify-email、
// /auth/password-reset/confirm、/marketing/unsubscribe）に送る。ログインの画面は 1.6 で決めた /login。
export const GUEST_LINK_PATHS = {
  /** G06 メールアドレスの確認（会員登録・メールアドレスの変更） */
  verifyEmail: '/verify-email',
  /** G08 パスワードの再設定 */
  passwordReset: '/password-reset',
  /** G20 配信停止 */
  unsubscribe: '/unsubscribe',
  /** G03 ログイン（予約の確認・変更はログインしてマイページから） */
  login: '/login',
  /** G01 トップ（空室検索） */
  top: '/',
} as const;

/** テンプレートが使うリンク */
export interface GuestLinks {
  verifyEmail(token: string): string;
  passwordReset(token: string): string;
  unsubscribe(token: string): string;
  login(): string;
  top(): string;
}

/** 宿泊客アプリの URL（末尾の「/」なし）からリンクを作る。トークンは URL の中で使える形に直す */
export function guestLinks(guestWebBaseUrl: string): GuestLinks {
  const base = guestWebBaseUrl.replace(/\/+$/, '');
  const withToken = (path: string, token: string) =>
    `${base}${path}?token=${encodeURIComponent(token)}`;
  return {
    verifyEmail: (token) => withToken(GUEST_LINK_PATHS.verifyEmail, token),
    passwordReset: (token) => withToken(GUEST_LINK_PATHS.passwordReset, token),
    unsubscribe: (token) => withToken(GUEST_LINK_PATHS.unsubscribe, token),
    login: () => `${base}${GUEST_LINK_PATHS.login}`,
    top: () => `${base}${GUEST_LINK_PATHS.top}`,
  };
}

/** 本文の中の URL（開発用の一覧で、画面のテストが確認のリンクを取り出すため） */
export function extractLinks(body: string): string[] {
  return [...body.matchAll(/https?:\/\/[^\s]+/g)].map((match) => match[0]);
}
