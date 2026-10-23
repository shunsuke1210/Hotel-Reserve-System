// 祝日の一覧（初期データの data/holidays.csv と、その読み込み）を確かめる（tasks.md 1.5）。データベースは使わない。
import { describe, expect, it } from 'vitest';
import { loadHolidays, parseHolidayCsv } from '../../../prisma/seed/holidays.js';

const HEADER = '国民の祝日・休日月日,国民の祝日・休日名称';

describe('祝日の一覧の読み込み（parseHolidayCsv）', () => {
  it('[6.6] 内閣府の CSV の形（YYYY/M/D,名称）を、YYYY-MM-DD の日付と名称にする', () => {
    expect(parseHolidayCsv(`﻿${HEADER}\r\n2026/5/6,休日\r\n2026/11/23,勤労感謝の日\r\n`)).toEqual([
      { date: '2026-05-06', name: '休日' },
      { date: '2026-11-23', name: '勤労感謝の日' },
    ]);
  });

  it('見出しが違う・形が違う行・存在しない日付・重複した日付は、行の番号を示して止める', () => {
    expect(() => parseHolidayCsv('日付,名称\n2026/1/1,元日\n')).toThrow('1行目');
    expect(() => parseHolidayCsv(`${HEADER}\n2026/1/1,元日\n2026-01-12,成人の日\n`)).toThrow(
      '3行目',
    );
    expect(() => parseHolidayCsv(`${HEADER}\n2026/2/30,架空の日\n`)).toThrow('2行目');
    expect(() => parseHolidayCsv(`${HEADER}\n2026/1/1,元日\n2026/1/1,元日\n`)).toThrow('重複');
  });
});

describe('初期データの祝日の一覧（data/holidays.csv）', () => {
  const holidays = loadHolidays();
  const nameOf = (date: string) => holidays.find((holiday) => holiday.date === date)?.name;

  it('[6.6] 2026年の振替休日（5/6）と国民の休日（9/22）、祝日（11/3・11/23）を含む', () => {
    expect(nameOf('2026-05-06')).toBe('休日');
    expect(nameOf('2026-09-22')).toBe('休日');
    expect(nameOf('2026-11-03')).toBe('文化の日');
    expect(nameOf('2026-11-23')).toBe('勤労感謝の日');
    expect(holidays.filter((holiday) => holiday.date.startsWith('2026-'))).toHaveLength(18);
  });

  it('[6.6] 日付の順に並び、2027年の祝日（振替休日 3/22 を含む）まである', () => {
    const dates = holidays.map((holiday) => holiday.date);
    expect(dates).toEqual([...dates].sort());
    expect(nameOf('2027-03-22')).toBe('休日');
    expect(dates.at(-1)).toBe('2027-11-23');
  });
});
