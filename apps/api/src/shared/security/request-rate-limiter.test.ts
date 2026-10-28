import { describe, expect, it } from 'vitest';
import { FixedBusinessClock } from '../clock/business-clock.js';
import { BusinessError } from '../errors/business-error.js';
import { RequestRateLimiter } from './request-rate-limiter.js';

function at(time: string): string {
  return `2026-11-10T${time}+09:00`;
}

function setup(limit = 5) {
  const clock = new FixedBusinessClock(at('10:00:00'));
  const limiter = new RequestRateLimiter(clock, { limit, windowMs: 60_000 });
  function consume(time: string, key = '203.0.113.1'): string {
    clock.set(at(time));
    try {
      limiter.consume(key);
      return 'OK';
    } catch (error) {
      if (error instanceof BusinessError) return error.code;
      throw error;
    }
  }
  return { clock, limiter, consume };
}

describe('RequestRateLimiter（直近60秒の要求の数で判定する回数制限。設計の補足 L-27・L-40・L-47）', () => {
  it('[L-40] 直近60秒に受け付けた要求が上限に達していれば RATE_LIMITED', () => {
    const { consume } = setup();
    for (const time of ['10:00:00', '10:00:10', '10:00:20', '10:00:30', '10:00:40']) {
      expect(consume(time)).toBe('OK');
    }
    expect(consume('10:00:50')).toBe('RATE_LIMITED');
  });

  it('[L-40] 60秒たった要求は数えない（ちょうど60秒を含む）', () => {
    const { consume } = setup();
    for (const time of ['10:00:00', '10:00:10', '10:00:20', '10:00:30', '10:00:40']) {
      consume(time);
    }
    expect(consume('10:00:59.999')).toBe('RATE_LIMITED');
    expect(consume('10:01:00')).toBe('OK');
    // 10:01:01 の直近60秒は 10:00:10・20・30・40・10:01:00 の5回
    expect(consume('10:01:01')).toBe('RATE_LIMITED');
    expect(consume('10:01:10')).toBe('OK');
  });

  it('[L-47] 429 で断った要求は数えない', () => {
    const { consume } = setup();
    for (const time of ['10:00:00', '10:00:10', '10:00:20', '10:00:30', '10:00:40']) {
      consume(time);
    }
    expect(consume('10:00:50')).toBe('RATE_LIMITED');
    expect(consume('10:00:55')).toBe('RATE_LIMITED');
    // 断った 10:00:50・10:00:55 を数えるなら、ここも断ることになる
    expect(consume('10:01:00')).toBe('OK');
  });

  it('キーごとに数える（IP が違えば制限されない）', () => {
    const { consume } = setup(1);
    expect(consume('10:00:00', '203.0.113.1')).toBe('OK');
    expect(consume('10:00:01', '203.0.113.1')).toBe('RATE_LIMITED');
    expect(consume('10:00:01', '203.0.113.2')).toBe('OK');
  });

  it('古い記録は消して、記録を持ち続けない', () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 100; i += 1) {
      limiter.consume(`198.51.100.${i}`);
    }
    expect(limiter.trackedKeyCount).toBe(100);
    clock.advance(60_000);
    limiter.consume('203.0.113.9');
    expect(limiter.trackedKeyCount).toBe(1);
  });

  it('上限と期間は正の整数にする', () => {
    const clock = new FixedBusinessClock(at('10:00:00'));
    expect(() => new RequestRateLimiter(clock, { limit: 0, windowMs: 60_000 })).toThrow(RangeError);
    expect(() => new RequestRateLimiter(clock, { limit: 5, windowMs: 0 })).toThrow(RangeError);
    expect(() => new RequestRateLimiter(clock, { limit: 1.5, windowMs: 60_000 })).toThrow(
      RangeError,
    );
  });
});
