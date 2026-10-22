import { afterEach, describe, expect, it } from 'vitest';
import {
  BUSINESS_TIME_ZONE,
  BusinessClock,
  FixedBusinessClock,
  SystemBusinessClock,
} from './business-clock.js';

/** 日本時間の [年, 月, 日, 時, 分, 秒] を取り出す */
function japanParts(clock: BusinessClock): number[] {
  const jst = clock.nowInJapan();
  return [
    jst.getFullYear(),
    jst.getMonth() + 1,
    jst.getDate(),
    jst.getHours(),
    jst.getMinutes(),
    jst.getSeconds(),
  ];
}

describe('BusinessClock（日本時間に固定した時計）', () => {
  it('時間帯は Asia/Tokyo に固定されている', () => {
    expect(BUSINESS_TIME_ZONE).toBe('Asia/Tokyo');
    expect(new SystemBusinessClock().nowInJapan().timeZone).toBe('Asia/Tokyo');
    expect(new FixedBusinessClock('2026-10-22T00:00:00Z').nowInJapan().timeZone).toBe('Asia/Tokyo');
  });

  describe('FixedBusinessClock（テストで時刻を固定する時計）', () => {
    it('[3.6] 任意の時刻に固定でき、最終チェックイン時刻（25:00 ＝ 翌日 1:00）の前後を日本時間で再現できる', () => {
      // 2026-10-23 0:59:59（日本時間）＝ 2026-10-22 の 24:59:59
      const clock = new FixedBusinessClock('2026-10-22T15:59:59Z');
      expect(clock.now().toISOString()).toBe('2026-10-22T15:59:59.000Z');
      expect(japanParts(clock)).toEqual([2026, 10, 23, 0, 59, 59]);

      // 2026-10-23 1:00:00（日本時間）＝ 2026-10-22 の 25:00
      clock.set('2026-10-23T01:00:00+09:00');
      expect(clock.now().toISOString()).toBe('2026-10-22T16:00:00.000Z');
      expect(japanParts(clock)).toEqual([2026, 10, 23, 1, 0, 0]);
    });

    it('時刻を進められ、固定した時刻は自然には進まない', () => {
      const clock = new FixedBusinessClock(new Date('2026-10-22T00:00:00Z'));
      expect(clock.now().getTime()).toBe(Date.parse('2026-10-22T00:00:00Z'));
      expect(clock.now().getTime()).toBe(Date.parse('2026-10-22T00:00:00Z'));

      clock.advance(15 * 60 * 1000);
      expect(clock.now().toISOString()).toBe('2026-10-22T00:15:00.000Z');
    });

    it('now() が返した値を書き換えても、時計の時刻は変わらない', () => {
      const clock = new FixedBusinessClock(Date.parse('2026-10-22T00:00:00Z'));
      clock.now().setFullYear(2000);
      clock.nowInJapan().setFullYear(2000);
      expect(clock.now().toISOString()).toBe('2026-10-22T00:00:00.000Z');
    });

    it('日本時間の時刻を、時差つきの ISO 8601 の文字列で表せる', () => {
      const clock = new FixedBusinessClock('2026-10-22T16:00:00Z');
      expect(clock.nowInJapan().toISOString()).toBe('2026-10-23T01:00:00.000+09:00');
    });

    it('時刻として解釈できない値は受け付けない', () => {
      expect(() => new FixedBusinessClock('not a date')).toThrow(RangeError);
      const clock = new FixedBusinessClock('2026-10-22T00:00:00Z');
      expect(() => clock.set('2026-13-40')).toThrow(RangeError);
    });
  });

  describe('サーバーの時間帯の設定に左右されない', () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it('[3.6] サーバーの時間帯が日本以外でも、日本時間の日付と時刻を返す', () => {
      process.env.TZ = 'America/Los_Angeles';
      const instant = new Date('2026-10-22T16:00:00Z');
      // 前提：この環境では、時間帯の設定が日付の計算に反映されている（ロサンゼルスは 10/22 9:00）
      expect([instant.getDate(), instant.getHours()]).toEqual([22, 9]);

      const clock = new FixedBusinessClock(instant);
      expect(japanParts(clock)).toEqual([2026, 10, 23, 1, 0, 0]);
    });
  });

  describe('SystemBusinessClock（実際の時計）', () => {
    it('実際の現在時刻を返す', () => {
      const clock = new SystemBusinessClock();
      const before = Date.now();
      const now = clock.now().getTime();
      const after = Date.now();
      expect(now).toBeGreaterThanOrEqual(before);
      expect(now).toBeLessThanOrEqual(after);
    });
  });
});
