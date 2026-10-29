// 配信停止のリンクの署名つきの値（tasks.md 3.4、要件 15.7・1.7、design.md POST /marketing/unsubscribe）。
import { describe, expect, it } from 'vitest';
import { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token.js';

const SECRET = 'unsubscribe-secret-0123456789abcdefghij';
const MEMBER_ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const ISSUED_AT = new Date('2026-11-14T08:00:00+09:00');

describe('配信停止のリンクの署名つきの値', () => {
  it('[15.7] 会員 ID と発行の時刻を署名つきで含み、同じ鍵で確かめると取り出せる', () => {
    const token = signUnsubscribeToken(SECRET, { memberId: MEMBER_ID, issuedAt: ISSUED_AT });
    expect(token).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(token.length).toBeLessThanOrEqual(120);
    expect(verifyUnsubscribeToken(SECRET, token)).toEqual({
      memberId: MEMBER_ID,
      issuedAt: ISSUED_AT,
    });
  });

  it('発行の時刻は秒の単位で記録する', () => {
    const token = signUnsubscribeToken(SECRET, {
      memberId: MEMBER_ID,
      issuedAt: new Date('2026-11-14T08:00:00.987+09:00'),
    });
    expect(verifyUnsubscribeToken(SECRET, token)?.issuedAt).toEqual(ISSUED_AT);
  });

  it('[1.7] どの1文字を書き換えても無効になる（TC-MB-093）', () => {
    const token = signUnsubscribeToken(SECRET, { memberId: MEMBER_ID, issuedAt: ISSUED_AT });
    for (let index = 0; index < token.length; index += 1) {
      const original = token[index];
      for (const replacement of ['A', 'b', '0', '_']) {
        if (replacement === original) continue;
        const tampered = `${token.slice(0, index)}${replacement}${token.slice(index + 1)}`;
        expect(
          verifyUnsubscribeToken(SECRET, tampered),
          `${index} 文字目を ${replacement} に`,
        ).toBe(null);
      }
    }
  });

  it('別の鍵で署名した値・形の誤った値は無効（例外は投げない）', () => {
    const token = signUnsubscribeToken(SECRET, { memberId: MEMBER_ID, issuedAt: ISSUED_AT });
    expect(verifyUnsubscribeToken(`${SECRET}x`, token)).toBe(null);
    for (const value of [
      '',
      'abc',
      `${token}.extra`,
      token.replace(/^u1\./, 'u2.'),
      token.slice(0, -1),
      `${token}A`,
      'x'.repeat(10_000),
      undefined,
      null,
      42,
      { token },
    ]) {
      expect(verifyUnsubscribeToken(SECRET, value)).toBe(null);
    }
  });

  it('誤った会員 ID・短すぎる鍵では作らない（プログラムの誤り）', () => {
    expect(() =>
      signUnsubscribeToken(SECRET, { memberId: 'not-a-uuid', issuedAt: ISSUED_AT }),
    ).toThrow(RangeError);
    expect(() =>
      signUnsubscribeToken('short', { memberId: MEMBER_ID, issuedAt: ISSUED_AT }),
    ).toThrow(RangeError);
  });
});
