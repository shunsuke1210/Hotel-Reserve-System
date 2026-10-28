import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { readSessionToken, SESSION_COOKIE_NAMES } from './session-cookie.js';
import { SESSION_POLICIES } from './session-policy.js';
import {
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
} from './session-token.js';

function requestWithCookie(cookie: string | undefined): Request {
  return { headers: cookie === undefined ? {} : { cookie } } as Request;
}

describe('セッションの ID（推測できない値。research.md ADR-04）', () => {
  it('32バイトの乱数を base64url にした43文字で、毎回異なる', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateSessionToken()));
    expect(tokens.size).toBe(1000);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isWellFormedSessionToken(token)).toBe(true);
    }
  });

  it('データベースには ID の SHA-256 だけを保存する（Cookie の値とは異なり、同じ ID からは同じ値になる）', () => {
    const token = generateSessionToken();
    const stored = hashSessionToken(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(token);
    expect(hashSessionToken(token)).toBe(stored);
    expect(hashSessionToken(generateSessionToken())).not.toBe(stored);
  });

  it.each(['', 'short', 'x'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}+`])(
    '形の違う値（%j）はセッションの ID として扱わない',
    (value) => {
      expect(isWellFormedSessionToken(value)).toBe(false);
    },
  );
});

describe('セッションの Cookie', () => {
  it('[2.1] 会員とスタッフは別の名前の Cookie を使う（別の種類のセッション）', () => {
    expect(SESSION_COOKIE_NAMES.MEMBER).not.toBe(SESSION_COOKIE_NAMES.STAFF);
    expect(SESSION_COOKIE_NAMES.MEMBER).toBe(SESSION_POLICIES.MEMBER.cookieName);
    expect(SESSION_COOKIE_NAMES.STAFF).toBe(SESSION_POLICIES.STAFF.cookieName);
  });

  it('[2.1] 会員は SameSite=Lax・最後の操作から7日、スタッフは SameSite=Strict・12時間（Security Considerations）', () => {
    expect(SESSION_POLICIES.MEMBER).toMatchObject({
      sameSite: 'lax',
      idleTimeoutMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(SESSION_POLICIES.STAFF).toMatchObject({
      sameSite: 'strict',
      idleTimeoutMs: 12 * 60 * 60 * 1000,
    });
  });

  it('要求の Cookie から、その種類のセッションの ID だけを読む', () => {
    const member = generateSessionToken();
    const staff = generateSessionToken();
    const req = requestWithCookie(
      `theme=dark; ${SESSION_COOKIE_NAMES.STAFF}=${staff};${SESSION_COOKIE_NAMES.MEMBER}=${member}`,
    );
    expect(readSessionToken(req, 'MEMBER')).toBe(member);
    expect(readSessionToken(req, 'STAFF')).toBe(staff);
  });

  it('Cookie がない、または形の違う値なら、セッションの ID はない', () => {
    expect(readSessionToken(requestWithCookie(undefined), 'MEMBER')).toBeUndefined();
    expect(readSessionToken(requestWithCookie('theme=dark'), 'MEMBER')).toBeUndefined();
    expect(
      readSessionToken(requestWithCookie(`${SESSION_COOKIE_NAMES.MEMBER}=not-a-token`), 'MEMBER'),
    ).toBeUndefined();
    expect(
      readSessionToken(
        requestWithCookie(`${SESSION_COOKIE_NAMES.MEMBER}=${generateSessionToken()}`),
        'STAFF',
      ),
    ).toBeUndefined();
  });
});
