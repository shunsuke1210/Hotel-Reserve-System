// 模擬の機械翻訳（design.md Translator の模擬、research.md ADR-05）。
// 本物の翻訳の代わりに、原文の前に翻訳先の言語を付けた文（`[en] 原文` の形）を返す。
// 翻訳文は translations に保存し、スタッフが後から直せる（保存と表示は ContentService の担当）。
import { Translator, type TranslationLocale } from './translator.port.js';

export class MockTranslator extends Translator {
  override async translate(textJa: string, to: TranslationLocale): Promise<string> {
    return `[${to}] ${textJa}`;
  }
}
