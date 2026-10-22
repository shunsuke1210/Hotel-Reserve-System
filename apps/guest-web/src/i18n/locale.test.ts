import { LOCALES } from '@hotel/contracts';
import { describe, expect, it } from 'vitest';
import { LOCALE_LABELS, detectInitialLocale, matchLocale } from './locale';

describe('宿泊客アプリの言語', () => {
  it('[16.1] 切り替えの選択肢は、日本語・English・한국어・简体中文・繁體中文 の5つ', () => {
    expect(LOCALES.map((locale) => LOCALE_LABELS[locale])).toEqual([
      '日本語',
      'English',
      '한국어',
      '简体中文',
      '繁體中文',
    ]);
  });

  it.each([
    ['ja', 'ja'],
    ['ja-JP', 'ja'],
    ['en', 'en'],
    ['en-GB', 'en'],
    ['ko-KR', 'ko'],
    ['zh', 'zh-Hans'],
    ['zh-CN', 'zh-Hans'],
    ['zh-SG', 'zh-Hans'],
    ['zh-Hans-CN', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh-MO', 'zh-Hant'],
    ['zh-Hant', 'zh-Hant'],
    ['ZH-hant-tw', 'zh-Hant'],
  ] as const)('[16.1] ブラウザの言語 %s は %s として扱う', (tag, expected) => {
    expect(matchLocale(tag)).toBe(expected);
  });

  it.each(['fr', 'de-DE', '', 'jav'])('[16.1] 対応しない言語 "%s" は扱わない', (tag) => {
    expect(matchLocale(tag)).toBeUndefined();
  });

  it('[16.1] 最初の言語は、前に選んだ言語 → ブラウザの言語（優先の順）→ 日本語 の順で決める', () => {
    expect(detectInitialLocale({ saved: 'ko', browserLanguages: ['en-US'] })).toBe('ko');
    expect(detectInitialLocale({ saved: null, browserLanguages: ['fr-FR', 'zh-TW', 'en'] })).toBe(
      'zh-Hant',
    );
    expect(detectInitialLocale({ saved: 'fr', browserLanguages: ['en-US'] })).toBe('en');
    expect(detectInitialLocale({ saved: null, browserLanguages: ['fr-FR', 'de'] })).toBe('ja');
    expect(detectInitialLocale({ saved: null, browserLanguages: [] })).toBe('ja');
  });
});
