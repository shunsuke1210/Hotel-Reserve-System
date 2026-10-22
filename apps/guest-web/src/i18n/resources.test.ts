import { LOCALES } from '@hotel/contracts';
import { describe, expect, it } from 'vitest';
import { NAMESPACES, resources } from './resources';

/** 入れ子の文言を「a.b.c」の形の項目名の一覧にする */
function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('文言ファイル（i18n/locales/{機能}/{言語}.json）', () => {
  it('機能（共通・検索・認証・予約・マイページ）ごとに文言ファイルを分けている', () => {
    expect(NAMESPACES).toEqual(['common', 'search', 'auth', 'booking', 'mypage']);
  });

  it('[16.1] 5言語すべてに、どの機能の文言ファイルもある', () => {
    expect(Object.keys(resources)).toEqual([...LOCALES]);
    for (const locale of LOCALES) {
      expect(Object.keys(resources[locale])).toEqual([...NAMESPACES]);
    }
  });

  it('[16.1] どの言語の文言ファイルにも、日本語の文言ファイルと同じ項目がそろっている', () => {
    for (const namespace of NAMESPACES) {
      const expected = keysOf(resources.ja[namespace]).sort();
      for (const locale of LOCALES) {
        expect(keysOf(resources[locale][namespace]).sort(), `${locale}/${namespace}`).toEqual(
          expected,
        );
      }
    }
  });
});
