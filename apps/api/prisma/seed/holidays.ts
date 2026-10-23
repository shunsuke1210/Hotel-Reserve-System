// 祝日の一覧（holidays テーブルの初期データ）。祝日の判定は holidays テーブルだけを使う（design.md Allowed Dependencies）。
//
// data/holidays.csv は、内閣府「国民の祝日について」のページの「昭和30年（1955年）から令和9年（2027年）国民の祝日（csv形式）」
//   https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv
// を 2026-10-23 に取得し、文字コードを Shift_JIS から UTF-8 に、改行を CRLF から LF に変えたもの（内容は変えていない）。
// 振替休日と国民の休日は、内閣府の一覧のとおり名称「休日」で登録する。
//
// 翌年の祝日が公表されたら（毎年2月ごろ）、同じ手順で data/holidays.csv を取り替えて pnpm db:seed を実行する
// （ない日付だけを追加する。既にある日付の名称は変えない）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 祝日の一覧のファイル */
export const HOLIDAYS_CSV_PATH = resolve(__dirname, 'data', 'holidays.csv');

/** 内閣府の CSV の見出しの行 */
const HEADER = '国民の祝日・休日月日,国民の祝日・休日名称';

export interface HolidayRow {
  /** 日付（YYYY-MM-DD） */
  date: string;
  /** 名称（内閣府の一覧のとおり。振替休日・国民の休日は「休日」） */
  name: string;
}

/**
 * 内閣府の形の CSV（見出しの行と「YYYY/M/D,名称」の行）を読む。
 * 形が違う行・存在しない日付・同じ日付の重複があれば、行の番号を示して例外を投げる（取り替えたファイルの誤りを投入の前に止める）。
 */
export function parseHolidayCsv(text: string): HolidayRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines[0] !== HEADER) {
    throw new Error(`祝日の一覧の1行目が、内閣府の CSV の見出し（${HEADER}）ではありません`);
  }

  const rows: HolidayRow[] = [];
  const seen = new Set<string>();
  lines.slice(1).forEach((line, index) => {
    const lineNumber = index + 2;
    const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2}),([^,]+)$/.exec(line);
    if (match === null) {
      throw new Error(`祝日の一覧の${lineNumber}行目が「YYYY/M/D,名称」の形ではありません`);
    }
    const [, year = '', month = '', day = '', name = ''] = match;
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error(`祝日の一覧の${lineNumber}行目の日付（${date}）は存在しません`);
    }
    if (seen.has(date)) {
      throw new Error(`祝日の一覧の${lineNumber}行目の日付（${date}）が重複しています`);
    }
    seen.add(date);
    rows.push({ date, name: name.trim() });
  });
  return rows;
}

/** data/holidays.csv の祝日の一覧 */
export function loadHolidays(): HolidayRow[] {
  return parseHolidayCsv(readFileSync(HOLIDAYS_CSV_PATH, 'utf8'));
}
