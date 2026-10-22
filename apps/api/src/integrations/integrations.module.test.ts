import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { Injectable, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestListenerApp } from '../test/listener-app.js';
import { IntegrationsModule } from './integrations.module.js';
import { MailSender } from './mail/mail-sender.port.js';
import { MockMailSender } from './mail/mock-mail-sender.js';
import { MockPaymentGateway } from './payment/mock-payment.gateway.js';
import { PaymentGateway } from './payment/payment-gateway.port.js';
import { TestPaymentGateway } from './testing/test-payment-gateway.js';
import { MockTranslator } from './translation/mock-translator.js';
import { Translator } from './translation/translator.port.js';

/** 業務のサービスの例：外部サービスをインターフェース（抽象クラス）の型で注入して使う */
@Injectable()
class SampleBusinessService {
  constructor(
    readonly payments: PaymentGateway,
    readonly translator: Translator,
    readonly mail: MailSender,
  ) {}
}

describe('IntegrationsModule（外部サービスのインターフェースに実装を結び付ける）', () => {
  it('業務のサービスは、インターフェースの型で注入するだけで、模擬の決済・翻訳・メールを使える', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [IntegrationsModule],
      providers: [SampleBusinessService],
    }).compile();
    const service = moduleRef.get(SampleBusinessService);
    expect(service.payments).toBeInstanceOf(MockPaymentGateway);
    expect(service.translator).toBeInstanceOf(MockTranslator);
    expect(service.mail).toBeInstanceOf(MockMailSender);
    await expect(service.translator.translate('朝食', 'ko')).resolves.toBe('[ko] 朝食');
  });

  it('テストでは、インターフェースを指定してテスト用の実装に差し替えられる', async () => {
    const testGateway = new TestPaymentGateway();
    const moduleRef = await Test.createTestingModule({
      imports: [IntegrationsModule],
      providers: [SampleBusinessService],
    })
      .overrideProvider(PaymentGateway)
      .useValue(testGateway)
      .compile();
    expect(moduleRef.get(SampleBusinessService).payments).toBe(testGateway);
  });

  describe('公開用と社内用の2つの待ち受け口', () => {
    let guest: INestApplication | undefined;
    let staff: INestApplication | undefined;
    afterAll(async () => {
      await guest?.close();
      await staff?.close();
    });

    it('2つの待ち受け口は同じ模擬の外部サービスを使い、公開用で行った決済を社内用（照合など）から確かめられる', async () => {
      guest = await createTestListenerApp('guest');
      staff = await createTestListenerApp('staff');
      expect(guest.get(PaymentGateway)).toBeInstanceOf(MockPaymentGateway);
      expect(guest.get(PaymentGateway)).toBe(staff.get(PaymentGateway));
      expect(guest.get(Translator)).toBe(staff.get(Translator));
      expect(guest.get(MailSender)).toBe(staff.get(MailSender));

      const guestPayments = guest.get(PaymentGateway);
      const card = await guestPayments.registerCard({
        cardNumber: '4242424242424242',
        expMonth: 12,
        expYear: 2030,
        holderName: 'TARO YAMADA',
      });
      if (!card.ok) throw new Error('前提のカードを登録できませんでした');
      const key = `shared-${card.value.token}`;
      const charged = await guestPayments.charge(card.value.token, 31_600, key);
      if (!charged.ok) throw new Error('前提の決済ができませんでした');

      await expect(staff.get(PaymentGateway).findCharge(key)).resolves.toEqual({
        ok: true,
        value: { providerRef: charged.value.providerRef, amount: 31_600 },
      });
    });
  });

  it('業務のコード（integrations の外）は、模擬実装とテスト用の実装を直接読み込まない（インターフェースだけを使う）', () => {
    const srcDir = join(__dirname, '..');
    const integrationsDir = join(srcDir, 'integrations');
    const testHelpersDir = join(srcDir, 'test');
    const forbidden = /from\s+['"][^'"]*integrations\/[^'"]*(?:mock-[^'"]*|testing\/[^'"]*)['"]/;

    const violations = listSourceFiles(srcDir)
      .filter((file) => !file.startsWith(integrationsDir + sep))
      .filter((file) => !file.startsWith(testHelpersDir + sep) && !file.endsWith('.test.ts'))
      .filter((file) => forbidden.test(readFileSync(file, 'utf8')))
      .map((file) => relative(srcDir, file));
    expect(violations).toEqual([]);

    // インターフェースの定義も、模擬実装に依存しない
    const ports = listSourceFiles(integrationsDir).filter((file) => file.endsWith('.port.ts'));
    expect(ports.map((file) => relative(integrationsDir, file)).sort()).toEqual(
      [
        join('mail', 'mail-sender.port.ts'),
        join('payment', 'payment-gateway.port.ts'),
        join('translation', 'translator.port.ts'),
      ].sort(),
    );
    for (const port of ports) {
      expect(readFileSync(port, 'utf8')).not.toMatch(/from\s+['"][^'"]*(?:mock-|testing\/)/);
    }
  });
});

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}
