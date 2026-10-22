import { LOCALES } from '@hotel/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDate, formatJapanDateTime, formatJapanTime, formatNumber } from './format';

// 無料キャンセルの期限の例：2026-11-18 15:00（日本時間）＝ 2026-11-18T06:00:00Z
const DEADLINE = new Date('2026-11-18T06:00:00Z');

describe('日付・数字・時刻の表示（Intl API）', () => {
  // 画面を開いた端末のタイムゾーンが日本でなくても、時刻は日本時間で表示する（TC-MB-289）
  beforeEach(() => {
    vi.stubEnv('TZ', 'America/New_York');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('前提：このテストの間、実行環境のタイムゾーンは日本ではない', () => {
    expect(DEADLINE.getHours()).toBe(1);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/New_York');
  });

  it('[16.3] 日付（宿泊日）を、選んだ言語の書き方で表示する', () => {
    const expected = {
      ja: '2026年5月31日(日)',
      en: 'Sun, May 31, 2026',
      ko: '2026년 5월 31일 (일)',
      'zh-Hans': '2026年5月31日周日',
      'zh-Hant': '2026年5月31日 週日',
    } as const;
    for (const locale of LOCALES) {
      expect(formatDate('2026-05-31', locale), locale).toBe(expected[locale]);
    }
  });

  it('[16.3] 宿泊日はタイムゾーンで日付がずれない（年の境目・うるう日）', () => {
    expect(formatDate('2027-01-01', 'en')).toBe('Fri, Jan 1, 2027');
    expect(formatDate('2028-02-29', 'ja')).toBe('2028年2月29日(火)');
  });

  it('[16.3] 日時の日付は、日本時間の日付で表示する', () => {
    // 2026-11-17T15:30:00Z は、日本時間では 11/18 0:30（ニューヨークでは 11/17）
    expect(formatDate(new Date('2026-11-17T15:30:00Z'), 'ja')).toBe('2026年11月18日(水)');
    expect(formatDate('2026-11-17T15:30:00Z', 'en')).toBe('Wed, Nov 18, 2026');
  });

  it('[16.3] 数字を、選んだ言語の書き方で表示する', () => {
    for (const locale of LOCALES) {
      expect(formatNumber(61900, locale), locale).toBe('61,900');
      expect(formatNumber(1234567.5, locale), locale).toBe('1,234,567.5');
    }
  });

  it('[16.3] 時刻は、どの言語でも日本時間で表示する（端末のタイムゾーンに換算しない）', () => {
    for (const locale of LOCALES) {
      expect(formatJapanTime(DEADLINE, locale), locale).toBe('15:00');
      expect(formatJapanTime('2026-11-18T06:00:00Z', locale), locale).toBe('15:00');
    }
  });

  it('[16.3] 時刻は24時間制で、時の桁は言語の書き方にそろえる', () => {
    const morning = new Date('2026-11-18T00:05:00Z'); // 日本時間 9:05
    expect(formatJapanTime(morning, 'ja')).toBe('9:05');
    expect(formatJapanTime(morning, 'en')).toBe('09:05');
  });

  it('[16.3] 日付と時刻をまとめて、日本時間で表示する', () => {
    const expected = {
      ja: '2026年11月18日(水) 15:00',
      en: 'Wed, Nov 18, 2026, 15:00',
      ko: '2026년 11월 18일 (수) 15:00',
      'zh-Hans': '2026年11月18日周三 15:00',
      'zh-Hant': '2026年11月18日 週三 15:00',
    } as const;
    for (const locale of LOCALES) {
      expect(formatJapanDateTime(DEADLINE, locale), locale).toBe(expected[locale]);
    }
  });
});
