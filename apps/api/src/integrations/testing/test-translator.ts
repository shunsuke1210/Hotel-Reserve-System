// テスト専用の模擬の翻訳。本番の結び付け（integrations.module.ts）には使わない。
// 固定しない間は MockTranslator と同じく「[言語] 原文」を返す。呼び出し（原文と言語）を記録するので、
// 「保存した翻訳文を使い、表示のたびには翻訳しない」ことを確かめられる。
// onTranslate で翻訳の途中に処理を挟めるので、翻訳している間の同時の要求やスタッフの編集を再現できる。
// 結合テストでは overrideProvider(Translator).useValue(new TestTranslator()) で差し替えて使う
// （模擬の翻訳はプロセスで共有されるので、テストごとに新しいインスタンスにする。tasks.md 1.7）。
import { MockTranslator } from '../translation/mock-translator.js';
import type { TranslationLocale } from '../translation/translator.port.js';

export interface TranslationCall {
  textJa: string;
  to: TranslationLocale;
}

/** 翻訳の途中（結果を返す前）に行う処理 */
export type TranslateHook = (call: TranslationCall) => void | Promise<void>;

export class TestTranslator extends MockTranslator {
  /** 翻訳の呼び出し（失敗させた呼び出しを含む。呼んだ順） */
  readonly calls: TranslationCall[] = [];
  private failure: Error | null = null;
  private hook: TranslateHook | null = null;

  /** 以後の翻訳を、指定したエラーで失敗させる。null なら解除する */
  failWith(error: Error | null): void {
    this.failure = error;
  }

  /**
   * 以後の翻訳で、結果を返す前に hook を待つ（待ち合わせ・遅延・データベースの書き換えなど）。null なら解除する。
   * 失敗させている間（failWith）は呼ばない
   */
  onTranslate(hook: TranslateHook | null): void {
    this.hook = hook;
  }

  /** 呼び出しの記録を消す（失敗の固定と onTranslate は変えない） */
  reset(): void {
    this.calls.length = 0;
  }

  override async translate(textJa: string, to: TranslationLocale): Promise<string> {
    const call = { textJa, to };
    this.calls.push(call);
    if (this.failure) {
      throw this.failure;
    }
    await this.hook?.(call);
    return super.translate(textJa, to);
  }
}
