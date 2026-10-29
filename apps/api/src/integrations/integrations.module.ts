// 外部サービス（決済・機械翻訳・メール送信）のインターフェースに、実装を結び付ける（research.md ADR-05）。
// MVP では模擬実装を使う。本物のサービスに移るときは、ここで結び付ける実装だけを差し替える。
//
// 業務のコードは PaymentGateway・Translator・MailSender（抽象クラス）の型で注入して使い、
// 模擬実装を直接読み込まない（design.md Allowed Dependencies）。
// テストでは overrideProvider(PaymentGateway) などで、testing/ のテスト用の実装に差し替える。
import { Global, Module } from '@nestjs/common';
import { MailSender } from './mail/mail-sender.port.js';
import { MockMailSender } from './mail/mock-mail-sender.js';
import { MockPaymentGateway } from './payment/mock-payment.gateway.js';
import { PaymentGateway } from './payment/payment-gateway.port.js';
import { MockTranslator } from './translation/mock-translator.js';
import { Translator } from './translation/translator.port.js';

/**
 * 模擬の外部サービスは「プロセスの外にある1つのサービス」を模すので、インスタンスをプロセスで1つにする。
 * 2つの待ち受け口は別々の DI コンテナなので（tasks.md Implementation Notes 1.3）、useClass にすると
 * 待ち受け口ごとに別の模擬になり、公開用 API で行った決済を社内用 API の照合（payment-reconcile）から確かめられない。
 */
const processWideMocks = {
  paymentGateway: new MockPaymentGateway(),
  translator: new MockTranslator(),
  mailSender: new MockMailSender(),
};

@Global()
@Module({
  providers: [
    { provide: PaymentGateway, useValue: processWideMocks.paymentGateway },
    { provide: Translator, useValue: processWideMocks.translator },
    { provide: MailSender, useValue: processWideMocks.mailSender },
  ],
  exports: [PaymentGateway, Translator, MailSender],
})
export class IntegrationsModule {}

/**
 * DI の外のスクリプト（初期データの投入 pnpm db:seed）が使う翻訳の実装。待ち受け口と同じものを結び付ける
 * （本物の翻訳サービスに移るときも、ここと上の providers だけを差し替える）。
 */
export function scriptTranslator(): Translator {
  return processWideMocks.translator;
}
