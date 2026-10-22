// 機械翻訳サービスのインターフェース（design.md Components and Interfaces「PaymentGateway・Translator・MailSender」、ADR-05）。
// ホテル側が日本語で入力した文章（客室の説明・オプション名・宿泊約款など）を、宿泊客向けの4言語に翻訳する（16.4）。
// 翻訳文は translations に保存し、表示のたびには翻訳しない（ContentService）。宿泊客の入力は翻訳しない（16.5）。
// 業務のコードはこのインターフェースだけを使い、模擬実装（mock-translator.ts）を直接読み込まない。
import { LOCALES, type Locale } from '@hotel/contracts';

/** 翻訳先の言語（日本語以外） */
export type TranslationLocale = Exclude<Locale, 'ja'>;

export const TRANSLATION_LOCALES: readonly TranslationLocale[] = LOCALES.filter(
  (locale): locale is TranslationLocale => locale !== 'ja',
);

export abstract class Translator {
  /** 日本語の文を、指定した言語に翻訳する */
  abstract translate(textJa: string, to: TranslationLocale): Promise<string>;
}
