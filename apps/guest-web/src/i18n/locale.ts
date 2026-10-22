// 宿泊客アプリの言語（要件 16.1）。言語の一覧は契約（contracts）の LOCALES を使う。
import { LOCALES, type Locale } from '@hotel/contracts';

/** 言語の切り替えに表示する名前（どの言語で表示していても、その言語自身の書き方で示す） */
export const LOCALE_LABELS: Record<Locale, string> = {
  ja: '日本語',
  en: 'English',
  ko: '한국어',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
};

/** 最初に表示する言語（前に選んだ言語もブラウザの言語も使えないとき） */
export const DEFAULT_LOCALE: Locale = 'ja';

/** 選んだ言語を端末に覚えておくときの名前 */
export const LOCALE_STORAGE_KEY = 'hotel.guest.locale';

/** 繁体字を使う地域（台湾・香港・マカオ） */
const TRADITIONAL_CHINESE_REGIONS = new Set(['tw', 'hk', 'mo']);

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * ブラウザの言語の表記（BCP 47。例：ja-JP、zh-TW、zh-Hans-CN）を、対応する言語に直す。
 * 対応しない言語は undefined。
 */
export function matchLocale(tag: string): Locale | undefined {
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

/** 最初に表示する言語を、前に選んだ言語 → ブラウザの言語（優先の順）→ 日本語 の順で決める */
export function detectInitialLocale(input: {
  saved: string | null;
  browserLanguages: readonly string[];
}): Locale {
  if (isLocale(input.saved)) return input.saved;
  for (const tag of input.browserLanguages) {
    const locale = matchLocale(tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}
