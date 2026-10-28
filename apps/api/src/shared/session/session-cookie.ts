// セッションの Cookie の読み書き（design.md Security Considerations：HttpOnly・Secure・SameSite は会員 Lax、スタッフ Strict）。
// Cookie の有効期限は最後の操作から数えるので、操作のたびに設定し直す（SessionService）。
import type { CookieOptions, Request, Response } from 'express';
import { SESSION_POLICIES, type SessionRealm } from './session-policy.js';
import { isWellFormedSessionToken } from './session-token.js';

export const SESSION_COOKIE_NAMES: Readonly<Record<SessionRealm, string>> = {
  MEMBER: SESSION_POLICIES.MEMBER.cookieName,
  STAFF: SESSION_POLICIES.STAFF.cookieName,
};

function cookieOptions(realm: SessionRealm): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: SESSION_POLICIES[realm].sameSite,
    path: '/',
  };
}

/**
 * 要求の Cookie から、その種類のセッションの ID を読む。
 * ない、または ID の形でなければ undefined（ほかの種類のセッションの Cookie は読まない）。
 */
export function readSessionToken(req: Request, realm: SessionRealm): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const prefix = `${SESSION_COOKIE_NAMES[realm]}=`;
  for (const part of header.split(';')) {
    const pair = part.trim();
    if (pair.startsWith(prefix)) {
      const value = pair.slice(prefix.length);
      return isWellFormedSessionToken(value) ? value : undefined;
    }
  }
  return undefined;
}

/** セッションの Cookie を設定する（有効期限は今から、その種類のセッションの失効までの時間） */
export function writeSessionCookie(res: Response, realm: SessionRealm, token: string): void {
  removePendingSessionCookie(res, realm);
  res.cookie(SESSION_COOKIE_NAMES[realm], token, {
    ...cookieOptions(realm),
    maxAge: SESSION_POLICIES[realm].idleTimeoutMs,
  });
}

/** セッションの Cookie を消す（ログアウト） */
export function clearSessionCookie(res: Response, realm: SessionRealm): void {
  removePendingSessionCookie(res, realm);
  res.clearCookie(SESSION_COOKIE_NAMES[realm], cookieOptions(realm));
}

/**
 * 同じ要求の中で先に設定したセッションの Cookie を、応答から取り除く
 * （認証の確認で期限を延ばした後に、ログインで ID を作り直す・ログアウトで消すときに、1つの応答に同じ Cookie を2回書かない）。
 */
function removePendingSessionCookie(res: Response, realm: SessionRealm): void {
  const current = res.getHeader('Set-Cookie');
  if (current === undefined) return;
  const lines = Array.isArray(current) ? current : [String(current)];
  const prefix = `${SESSION_COOKIE_NAMES[realm]}=`;
  const kept = lines.filter((line) => !line.startsWith(prefix));
  if (kept.length === lines.length) return;
  if (kept.length === 0) {
    res.removeHeader('Set-Cookie');
  } else {
    res.setHeader('Set-Cookie', kept);
  }
}
