import { describe, expect, it, vi } from 'vitest';
import { FixedBusinessClock } from '../clock/business-clock.js';
import { BusinessError } from '../errors/business-error.js';
import {
  LoginAttemptLimiter,
  STAFF_INVALID_CREDENTIALS_MESSAGE,
  type LoginAttemptKey,
} from './login-attempt-limiter.js';

const IP1 = '203.0.113.1';
const IP2 = '203.0.113.2';
const memberA: LoginAttemptKey = { realm: 'MEMBER', clientIp: IP1, loginId: 'a@example.com' };

/** 2026-11-10 10:mm:ss（日本時間） */
function at(time: string): string {
  return `2026-11-10T${time}+09:00`;
}

function setup() {
  const clock = new FixedBusinessClock(at('10:00:00'));
  const limiter = new LoginAttemptLimiter(clock);

  /** time の時刻に、key でログインを試みる（ok なら認証に成功する）。エラーコードまたは OK を返す */
  async function attempt(time: string, key: LoginAttemptKey, ok: boolean): Promise<string> {
    clock.set(at(time));
    try {
      await limiter.verify(key, async () => (ok ? { id: 'subject' } : undefined));
      return 'OK';
    } catch (error) {
      if (error instanceof BusinessError) return error.code;
      throw error;
    }
  }

  /** TC-MB-126：10:00:00〜10:00:40 に10秒ごとに5回失敗する */
  async function failFiveTimes(key: LoginAttemptKey = memberA): Promise<string[]> {
    const results: string[] = [];
    for (const time of ['10:00:00', '10:00:10', '10:00:20', '10:00:30', '10:00:40']) {
      results.push(await attempt(time, key, false));
    }
    return results;
  }

  return { clock, limiter, attempt, failFiveTimes };
}

describe('LoginAttemptLimiter（ログインの回数制限。design.md Security Considerations、設計の補足 L-7・L-47）', () => {
  it('[TC-MB-126] 同じ IP と ID で5回まで失敗しても、5回目は INVALID_CREDENTIALS（RATE_LIMITED ではない）', async () => {
    const { failFiveTimes } = setup();
    expect(await failFiveTimes()).toEqual(Array(5).fill('INVALID_CREDENTIALS'));
  });

  it('[TC-MB-127] 5回失敗した後の6回目は、誤ったパスワードでも RATE_LIMITED', async () => {
    const { attempt, failFiveTimes } = setup();
    await failFiveTimes();
    expect(await attempt('10:00:50', memberA, false)).toBe('RATE_LIMITED');
  });

  it('[TC-MB-128] 5回失敗した後の6回目は、正しいパスワードでも RATE_LIMITED で、認証の確認そのものを行わない', async () => {
    const { clock, limiter, failFiveTimes } = setup();
    await failFiveTimes();
    clock.set(at('10:00:50'));
    const check = vi.fn(async () => ({ id: 'subject' }));
    await expect(limiter.verify(memberA, check)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(check).not.toHaveBeenCalled();
  });

  it('[TC-MB-129] 成功したログインは数えない（5回成功した後の6回目も成功する）', async () => {
    const { attempt } = setup();
    for (const time of ['10:00:00', '10:00:10', '10:00:20', '10:00:30', '10:00:40', '10:00:50']) {
      expect(await attempt(time, memberA, true)).toBe('OK');
    }
  });

  it('[TC-MB-130] 別の ID は制限されない（IP と ID の組ごとに数える）', async () => {
    const { attempt, failFiveTimes } = setup();
    await failFiveTimes();
    expect(await attempt('10:00:50', { ...memberA, loginId: 'b@example.com' }, true)).toBe('OK');
  });

  it('[TC-MB-131] 別の IP からは制限されない', async () => {
    const { attempt, failFiveTimes } = setup();
    await failFiveTimes();
    expect(await attempt('10:00:50', { ...memberA, clientIp: IP2 }, true)).toBe('OK');
  });

  it('[TC-MB-132] 制限は最後の失敗から60秒続き、1回目の失敗から60秒を過ぎても解除されない', async () => {
    const { attempt, failFiveTimes } = setup();
    await failFiveTimes();
    expect(await attempt('10:01:01', memberA, true)).toBe('RATE_LIMITED');
    expect(await attempt('10:01:39.999', memberA, true)).toBe('RATE_LIMITED');
  });

  it('[TC-MB-337] 最後の失敗から60秒で解除される（ちょうど60秒を含む。L-7・L-40）', async () => {
    const { attempt, failFiveTimes } = setup();
    await failFiveTimes();
    expect(await attempt('10:01:40', memberA, true)).toBe('OK');

    const other = setup();
    await other.failFiveTimes();
    expect(await other.attempt('10:01:41', memberA, true)).toBe('OK');
  });

  it('[L-47] 制限で断った要求は数えないので、断った後も解除の時刻は最後の失敗から60秒のまま', async () => {
    const { attempt, failFiveTimes } = setup();
    await failFiveTimes();
    expect(await attempt('10:00:50', memberA, false)).toBe('RATE_LIMITED');
    expect(await attempt('10:01:30', memberA, false)).toBe('RATE_LIMITED');
    expect(await attempt('10:01:40', memberA, true)).toBe('OK');
  });

  it('[L-7] 直近60秒の失敗だけを数える（60秒より前の失敗は数えない）', async () => {
    const { attempt } = setup();
    for (const time of ['10:00:00', '10:00:10', '10:00:20', '10:00:30', '10:01:00']) {
      expect(await attempt(time, memberA, false)).toBe('INVALID_CREDENTIALS');
    }
    // 10:01:05 の直近60秒の失敗は 10:00:10・20・30・10:01:00 の4回なので、まだ試せる
    expect(await attempt('10:01:05', memberA, false)).toBe('INVALID_CREDENTIALS');
    // ここで直近60秒に5回になったので制限する
    expect(await attempt('10:01:06', memberA, true)).toBe('RATE_LIMITED');
  });

  it('成功しても、それまでの失敗の回数は消えない（失敗だけを数える）', async () => {
    const { attempt } = setup();
    for (const time of ['10:00:00', '10:00:10', '10:00:20', '10:00:30']) {
      await attempt(time, memberA, false);
    }
    expect(await attempt('10:00:35', memberA, true)).toBe('OK');
    expect(await attempt('10:00:40', memberA, false)).toBe('INVALID_CREDENTIALS');
    expect(await attempt('10:00:50', memberA, true)).toBe('RATE_LIMITED');
  });

  it('ID の大文字と小文字は区別しない（メールアドレスの大文字を変えて制限を逃れられない）', async () => {
    const { attempt, failFiveTimes } = setup();
    await failFiveTimes();
    expect(await attempt('10:00:50', { ...memberA, loginId: 'A@Example.COM' }, true)).toBe(
      'RATE_LIMITED',
    );
  });

  it('会員とスタッフは別に数える', async () => {
    const { attempt, failFiveTimes } = setup();
    await failFiveTimes({ realm: 'STAFF', clientIp: IP1, loginId: 'S101' });
    expect(
      await attempt('10:00:50', { realm: 'MEMBER', clientIp: IP1, loginId: 'S101' }, true),
    ).toBe('OK');
    expect(
      await attempt('10:00:50', { realm: 'STAFF', clientIp: IP1, loginId: 'S101' }, true),
    ).toBe('RATE_LIMITED');
  });

  it('同時に送られた試行も数える（確認の途中の試行が5回あれば、6回目は確認せずに断る）', async () => {
    const { limiter } = setup();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inFlight = Array.from({ length: 5 }, () =>
      limiter.verify(memberA, async () => {
        await pending;
        return undefined;
      }),
    );
    const sixth = vi.fn(async () => ({ id: 'subject' }));
    await expect(limiter.verify(memberA, sixth)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(sixth).not.toHaveBeenCalled();

    release();
    const results = await Promise.allSettled(inFlight);
    expect(results.map((r) => r.status === 'rejected' && (r.reason as BusinessError).code)).toEqual(
      Array(5).fill('INVALID_CREDENTIALS'),
    );
  });

  it('認証の確認が例外（データベースの障害など）で終わった試行は失敗に数えず、例外をそのまま投げる', async () => {
    const { clock, limiter, attempt } = setup();
    const failure = new Error('database is down');
    for (let i = 0; i < 6; i += 1) {
      await expect(
        limiter.verify(memberA, async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      clock.advance(1_000);
    }
    expect(await attempt('10:00:10', memberA, true)).toBe('OK');
  });

  it('[2.1] スタッフの失敗の文言は「スタッフ番号またはパスワードが違います」、会員は既定の文言（言語ごと）', async () => {
    const { limiter } = setup();
    const staffError = await limiter
      .verify({ realm: 'STAFF', clientIp: IP1, loginId: 'S999' }, async () => undefined)
      .catch((error: unknown) => error);
    expect(staffError).toBeInstanceOf(BusinessError);
    expect((staffError as BusinessError).message).toBe(STAFF_INVALID_CREDENTIALS_MESSAGE);
    expect(STAFF_INVALID_CREDENTIALS_MESSAGE).toBe('スタッフ番号またはパスワードが違います');

    const memberError = await limiter
      .verify(memberA, async () => undefined)
      .catch((error: unknown) => error);
    expect((memberError as BusinessError).code).toBe('INVALID_CREDENTIALS');
    expect((memberError as BusinessError).message).toBe('メールアドレスまたはパスワードが違います');
  });

  it('認証に成功したら、確認の結果をそのまま返す', async () => {
    const { limiter } = setup();
    await expect(limiter.verify(memberA, async () => ({ id: 'member-a' }))).resolves.toEqual({
      id: 'member-a',
    });
  });
});
