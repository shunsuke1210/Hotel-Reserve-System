// テスト用の、ログイン済みの状態を作る補助。
//
// ログインの API を通さずに、指定したスタッフ・会員のセッションを作り、その Cookie を要求に付けられる：
//   const cookie = await signIn(staffApp, 'STAFF', cleanerId);
//   await request(staffApp.getHttpServer()).post('/api/staff/…').set('Cookie', cookie).set(CSRF_HEADERS);
//
// セッションの Cookie は Secure なので、supertest の agent は http の要求に付けない。Cookie は自分で付ける。
import type { INestApplication } from '@nestjs/common';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from '../../shared/security/csrf-header.guard.js';
import { SESSION_COOKIE_NAMES } from '../../shared/session/session-cookie.js';
import type { SessionRealm } from '../../shared/session/session-policy.js';
import { SessionService } from '../../shared/session/session.service.js';

/** 状態を変える要求に付ける独自のヘッダー（設計の補足 L-3） */
export const CSRF_HEADERS: Readonly<Record<string, string>> = {
  [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE,
};

/** 応答（supertest の Response など）のヘッダー */
interface ResponseWithHeaders {
  headers: Record<string, unknown>;
}

/**
 * 応答の Set-Cookie のうち、その種類のセッションの行（属性を含む）。なければ undefined。
 * 1つの応答に同じセッションの Cookie が2行以上あれば、誤りとして例外を投げる。
 */
export function sessionSetCookie(
  res: ResponseWithHeaders,
  realm: SessionRealm,
): string | undefined {
  const header = res.headers['set-cookie'];
  const lines = Array.isArray(header) ? header : typeof header === 'string' ? [header] : [];
  const matched = lines
    .filter((line): line is string => typeof line === 'string')
    .filter((line) => line.startsWith(`${SESSION_COOKIE_NAMES[realm]}=`));
  if (matched.length > 1) {
    throw new Error(`応答にセッションの Cookie が ${matched.length} 行あります`);
  }
  return matched[0];
}

/** 応答で設定されたセッションの Cookie を、要求の Cookie ヘッダーの形（名前=値）で返す。なければ undefined */
export function sessionCookieFrom(
  res: ResponseWithHeaders,
  realm: SessionRealm,
): string | undefined {
  const line = sessionSetCookie(res, realm);
  const pair = line?.split(';')[0];
  return pair && pair.length > SESSION_COOKIE_NAMES[realm].length + 1 ? pair : undefined;
}

/** Cookie ヘッダーの形（名前=値）から、セッションの ID（Cookie の値）を取り出す */
export function sessionTokenOf(cookie: string): string {
  return cookie.slice(cookie.indexOf('=') + 1);
}

/**
 * 指定した利用者のセッションを、ログインの API を通さずに作る（時刻はアプリの BusinessClock の現在）。
 * @returns 要求の Cookie ヘッダーに付ける値（名前=値）
 */
export async function signIn(
  app: INestApplication,
  realm: SessionRealm,
  subjectId: string,
): Promise<string> {
  const token = await app.get(SessionService).create(realm, subjectId);
  return `${SESSION_COOKIE_NAMES[realm]}=${token}`;
}
