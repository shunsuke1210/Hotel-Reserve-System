import { describe, expect, it } from 'vitest';
import { MockMailSender } from '../mail/mock-mail-sender.js';
import { MockPaymentGateway } from '../payment/mock-payment.gateway.js';
import { MockTranslator } from '../translation/mock-translator.js';
import { TestMailSender } from './test-mail-sender.js';
import { TestPaymentGateway } from './test-payment-gateway.js';
import { TestTranslator } from './test-translator.js';

describe('TestPaymentGateway（テスト用に結果を固定できる模擬の決済）', () => {
  async function chargedRef(gateway: TestPaymentGateway, cardNumber: string): Promise<string> {
    const card = await gateway.registerCard({
      cardNumber,
      expMonth: 1,
      expYear: 2031,
      holderName: 'HANAKO SATO',
    });
    if (!card.ok) throw new Error('前提のカードを登録できませんでした');
    const charged = await gateway.charge(card.value.token, 85_200, 'charge-key');
    if (!charged.ok) throw new Error('前提の決済ができませんでした');
    return charged.value.providerRef;
  }

  it('固定しなければ、模擬の決済と同じくカードの末尾の規則で振る舞う', async () => {
    const gateway = new TestPaymentGateway();
    expect(gateway).toBeInstanceOf(MockPaymentGateway);
    const ref = await chargedRef(gateway, '4000000000000267');
    expect(await gateway.refund(ref, 56_800, 'refund-key')).toEqual({
      ok: false,
      error: 'PAYMENT_GATEWAY_UNAVAILABLE',
    });
  });

  it('[4.21] 障害の解除（TC-IT-070）：末尾0267 の返金が障害で失敗した後、返金を成功に固定すると、同じ冪等キーの再試行が1回だけ記録される', async () => {
    const gateway = new TestPaymentGateway();
    const ref = await chargedRef(gateway, '4000000000000267');
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await gateway.refund(ref, 56_800, 'no-show-refund')).toEqual({
        ok: false,
        error: 'PAYMENT_GATEWAY_UNAVAILABLE',
      });
    }

    gateway.force('refund', 'SUCCEED');
    const retried = await gateway.refund(ref, 56_800, 'no-show-refund');
    const again = await gateway.refund(ref, 56_800, 'no-show-refund');
    expect(retried).toEqual({ ok: true, value: { providerRef: expect.any(String) } });
    expect(again).toEqual(retried);
    expect(gateway.listRefunds()).toEqual([
      expect.objectContaining({ idempotencyKey: 'no-show-refund', amount: 56_800 }),
    ]);
  });

  it('決済を一時的な障害に固定でき、その決済は記録しない', async () => {
    const gateway = new TestPaymentGateway();
    const card = await gateway.registerCard({
      cardNumber: '4242424242424242',
      expMonth: 1,
      expYear: 2031,
      holderName: 'HANAKO SATO',
    });
    if (!card.ok) throw new Error('前提のカードを登録できませんでした');
    gateway.force('charge', 'PAYMENT_GATEWAY_UNAVAILABLE');
    expect(await gateway.charge(card.value.token, 1_000, 'K')).toEqual({
      ok: false,
      error: 'PAYMENT_GATEWAY_UNAVAILABLE',
    });
    expect(gateway.listCharges()).toEqual([]);
    expect(await gateway.findCharge('K')).toEqual({ ok: true, value: null });
  });

  it('登録・照合の結果も固定でき、null で固定を解除するとカードの末尾の規則に戻る', async () => {
    const gateway = new TestPaymentGateway();
    const input = { cardNumber: '4242424242424242', expMonth: 1, expYear: 2031, holderName: 'X' };
    gateway.force('registerCard', 'PAYMENT_DECLINED');
    expect(await gateway.registerCard(input)).toEqual({ ok: false, error: 'PAYMENT_DECLINED' });
    gateway.force('registerCard', null);
    expect((await gateway.registerCard(input)).ok).toBe(true);

    gateway.force('findCharge', 'PAYMENT_GATEWAY_UNAVAILABLE');
    expect(await gateway.findCharge('K')).toEqual({
      ok: false,
      error: 'PAYMENT_GATEWAY_UNAVAILABLE',
    });
    gateway.clearForced();
    expect(await gateway.findCharge('K')).toEqual({ ok: true, value: null });
  });
});

describe('TestMailSender（テスト用に失敗させられる模擬のメール）', () => {
  const mail = { to: 'a@example.com', subject: '予約完了', body: '本文' };

  it('固定しなければ、模擬のメールと同じく送信の記録を残す', async () => {
    const sender = new TestMailSender();
    expect(sender).toBeInstanceOf(MockMailSender);
    await sender.send(mail);
    expect(sender.sentMails()).toEqual([mail]);
  });

  it('送信を失敗させられ（TC-MB-269）、失敗した送信は記録しない。null で解除する', async () => {
    const sender = new TestMailSender();
    const failure = new Error('メールサーバーに接続できません');
    sender.failWith(failure);
    await expect(sender.send(mail)).rejects.toBe(failure);
    expect(sender.sentMails()).toEqual([]);

    sender.failWith(null);
    await sender.send(mail);
    expect(sender.sentMails()).toEqual([mail]);
  });
});

describe('TestTranslator（呼び出しを記録し、失敗させられる模擬の翻訳）', () => {
  it('固定しなければ、模擬の翻訳と同じく「[言語] 原文」を返し、呼び出し（原文と言語）を記録する', async () => {
    const translator = new TestTranslator();
    expect(translator).toBeInstanceOf(MockTranslator);
    await expect(translator.translate('朝食', 'zh-Hans')).resolves.toBe('[zh-Hans] 朝食');
    expect(translator.calls).toEqual([{ textJa: '朝食', to: 'zh-Hans' }]);
  });

  it('[16.4] 翻訳を失敗させられ（失敗した呼び出しも記録する）、null で解除する', async () => {
    const translator = new TestTranslator();
    const failure = new Error('翻訳サービスに接続できません');
    translator.failWith(failure);
    await expect(translator.translate('朝食', 'en')).rejects.toBe(failure);
    expect(translator.calls).toEqual([{ textJa: '朝食', to: 'en' }]);

    translator.failWith(null);
    await expect(translator.translate('朝食', 'en')).resolves.toBe('[en] 朝食');
    expect(translator.calls).toHaveLength(2);

    // 記録は reset で消す（失敗の固定は変えない）
    translator.failWith(failure);
    translator.reset();
    expect(translator.calls).toEqual([]);
    await expect(translator.translate('朝食', 'ko')).rejects.toBe(failure);
  });

  it('onTranslate で、翻訳の結果を返す前に処理を挟める（同時の要求・翻訳中の編集の再現）。null で解除する', async () => {
    const translator = new TestTranslator();
    const events: string[] = [];
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    translator.onTranslate(async (call) => {
      events.push(`hook:${call.to}:${call.textJa}`);
      await released;
    });

    const pending = translator.translate('朝食', 'en').then((text) => events.push(text));
    await Promise.resolve();
    expect(events).toEqual(['hook:en:朝食']);
    release();
    await pending;
    expect(events).toEqual(['hook:en:朝食', '[en] 朝食']);

    translator.onTranslate(null);
    await expect(translator.translate('朝食', 'ko')).resolves.toBe('[ko] 朝食');
    expect(events).toHaveLength(2);
  });
});
