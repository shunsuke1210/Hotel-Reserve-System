// 公開用 API の文言の言語（要件 16.2、設計の補足 L-11）。
// 宿泊客アプリは、画面で選んだ言語を Accept-Language で送る（apps/guest-web/src/api/client.ts）。
// ブラウザの言語の表記（ja-JP、zh-TW など）の読み替えは、宿泊客アプリの matchLocale（apps/guest-web/src/i18n/locale.ts）と同じ規則にする。
import type { Locale } from '@hotel/contracts';

/** 言語の指定がない、または対応する言語がないときの言語（スタッフ向けは常にこの言語。要件 16.6） */
export const DEFAULT_LOCALE: Locale = 'ja';

/** 繁体字を使う地域（台湾・香港・マカオ） */
const TRADITIONAL_CHINESE_REGIONS = new Set(['tw', 'hk', 'mo']);

/** 言語の表記（BCP 47）を対応する言語に直す。対応しない言語は undefined */
function toSupportedLocale(tag: string): Locale | undefined {
  const [language, ...rest] = tag.toLowerCase().split(/[-_]/);
  switch (language) {
    case 'ja':
      return 'ja';
    case 'en':
      return 'en';
    case 'ko':
      return 'ko';
    case 'zh':
      return rest.includes('hant') || rest.some((part) => TRADITIONAL_CHINESE_REGIONS.has(part))
        ? 'zh-Hant'
        : 'zh-Hans';
    default:
      return undefined;
  }
}

interface LanguageRange {
  tag: string;
  quality: number;
  order: number;
}

/** Accept-Language の1つの項目（例：「ko;q=0.9」）を読む。読めない項目は undefined */
function parseRange(part: string, order: number): LanguageRange | undefined {
  const [rawTag, ...params] = part.split(';');
  const tag = rawTag?.trim() ?? '';
  if (tag === '' || tag === '*') return undefined;
  let quality = 1;
  for (const param of params) {
    const match = /^\s*q\s*=\s*(\S*)\s*$/i.exec(param);
    if (match) {
      quality = /^(0(\.\d{0,3})?|1(\.0{0,3})?)$/.test(match[1] ?? '') ? Number(match[1]) : NaN;
    }
  }
  return Number.isNaN(quality) || quality <= 0 ? undefined : { tag, quality, order };
}

/**
 * Accept-Language から、対応する言語のうち最も優先度の高いものを選ぶ。
 * q の値の大きい順（同じなら書いた順）に見て、最初に対応する言語にする。q=0 と「*」は選ばない。
 * 指定がない、または対応する言語がなければ日本語。
 */
export function negotiateLocale(acceptLanguage: string | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranges = acceptLanguage
    .split(',')
    .map((part, order) => parseRange(part, order))
    .filter((range): range is LanguageRange => range !== undefined)
    .sort((a, b) => b.quality - a.quality || a.order - b.order);
  for (const range of ranges) {
    const locale = toSupportedLocale(range.tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}
