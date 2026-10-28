import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, negotiateLocale } from './locale.js';

describe('negotiateLocale（Accept-Language から公開用 API の文言の言語を決める。設計の補足 L-11）', () => {
  it.each([
    ['ja', 'ja'],
    ['en', 'en'],
    ['ko', 'ko'],
    ['zh-Hans', 'zh-Hans'],
    ['zh-Hant', 'zh-Hant'],
  ] as const)('[16.2] 宿泊客アプリが送る言語 %s は、そのまま %s になる', (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });

  it.each([
    ['ja-JP', 'ja'],
    ['en-US', 'en'],
    ['ko-KR', 'ko'],
    ['zh', 'zh-Hans'],
    ['zh-CN', 'zh-Hans'],
    ['zh-Hans-CN', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh-MO', 'zh-Hant'],
    ['ZH-hant-tw', 'zh-Hant'],
  ] as const)('[16.2] ブラウザの言語の表記 %s は %s として扱う', (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });

  it('[16.2] 複数の言語は q の値の大きい順（同じなら書いた順）に、対応する最初の言語を選ぶ', () => {
    expect(negotiateLocale('fr-FR,ko;q=0.9,en;q=0.8')).toBe('ko');
    expect(negotiateLocale('en;q=0.5, ko;q=0.9')).toBe('ko');
    expect(negotiateLocale('de, zh-TW;q=0.7, en;q=0.7')).toBe('zh-Hant');
    expect(negotiateLocale('en, ko')).toBe('en');
  });

  it('q=0（受け付けない）と「*」は選ばない', () => {
    expect(negotiateLocale('ko;q=0, en;q=0.1')).toBe('en');
    expect(negotiateLocale('*')).toBe(DEFAULT_LOCALE);
  });

  it.each([[undefined], [''], ['fr'], ['de-DE, fr;q=0.5'], [';;;'], ['ko;q=abc']])(
    '言語の指定がない、または対応する言語がないとき（%j）は日本語',
    (header) => {
      expect(DEFAULT_LOCALE).toBe('ja');
      expect(negotiateLocale(header)).toBe('ja');
    },
  );
});
