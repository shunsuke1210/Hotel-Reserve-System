import { LOCALES } from '@hotel/contracts';
import { describe, expect, it } from 'vitest';
import { MockTranslator } from './mock-translator.js';
import { TRANSLATION_LOCALES } from './translator.port.js';

describe('MockTranslator（模擬の機械翻訳）', () => {
  const translator = new MockTranslator();

  it('翻訳先は、日本語以外の4言語（en・ko・zh-Hans・zh-Hant）', () => {
    expect(TRANSLATION_LOCALES).toEqual(LOCALES.filter((locale) => locale !== 'ja'));
    expect(TRANSLATION_LOCALES).toEqual(['en', 'ko', 'zh-Hans', 'zh-Hant']);
  });

  it.each(TRANSLATION_LOCALES)(
    '[16.4] 日本語の文を、言語 %s の名前を付けた文（[言語] 原文）にして返す',
    async (locale) => {
      await expect(translator.translate('海が見える広い客室です。', locale)).resolves.toBe(
        `[${locale}] 海が見える広い客室です。`,
      );
    },
  );

  it('[16.4] 複数行の文（宿泊約款など）も、原文をそのまま残して返す', async () => {
    const terms = '第1条 適用\n第2条 契約の申込み';
    await expect(translator.translate(terms, 'en')).resolves.toBe(`[en] ${terms}`);
  });
});
