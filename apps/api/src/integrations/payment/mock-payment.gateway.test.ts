import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestPaymentGateway } from '../testing/test-payment-gateway.js';
import { MockPaymentGateway } from './mock-payment.gateway.js';
import type { CardRegistrationInput } from './payment-gateway.port.js';

/** テスト用のカード番号（末尾の4桁で模擬の決済の振る舞いが決まる。design.md 設計の補足 L-16） */
const CARDS = {
  /** すべて成功 */
  normal: '4242424242424242',
  /** 登録・決済を拒否 */
  declined: '4000000000000002',
  /** 登録・決済で一時的な障害 */
  unavailable: '4000000000000119',
  /** 登録は成功し、決済だけを拒否 */
  chargeDeclined: '4000000000000341',
  /** 登録は成功し、決済・返金で一時的な障害 */
  chargeAndRefundUnavailable: '4000000000000259',
  /** 登録・決済は成功し、返金だけ一時的な障害 */
  refundUnavailable: '4000000000000267',
} as const;

function cardInput(cardNumber: string): CardRegistrationInput {
  return { cardNumber, expMonth: 12, expYear: 2030, holderName: 'TARO YAMADA' };
}

async function registeredToken(gateway: MockPaymentGateway, cardNumber: string): Promise<string> {
  const result = await gateway.registerCard(cardInput(cardNumber));
  if (!result.ok) {
    throw new Error(`前提のカードを登録できませんでした: ${result.error}`);
  }
  return result.value.token;
}

/** カードの末尾の規則では登録できないカード（末尾0002・0119）のトークンを、テスト用の模擬で作る */
async function forceRegisteredToken(gateway: TestPaymentGateway, cardNumber: string) {
  gateway.force('registerCard', 'SUCCEED');
  const token = await registeredToken(gateway, cardNumber);
  gateway.force('registerCard', null);
  return token;
}

/** カードの末尾の規則では決済できないカード（末尾0259）の決済を、テスト用の模擬で作る */
async function forceChargedRef(gateway: TestPaymentGateway, cardNumber: string, key: string) {
  const token = await registeredToken(gateway, cardNumber);
  gateway.force('charge', 'SUCCEED');
  const result = await gateway.charge(token, 10_000, key);
  gateway.force('charge', null);
  if (!result.ok) {
    throw new Error(`前提の決済ができませんでした: ${result.error}`);
  }
  return result.value.providerRef;
}

describe('MockPaymentGateway（模擬の決済）', () => {
  let gateway: MockPaymentGateway;
  beforeEach(() => {
    gateway = new MockPaymentGateway();
  });

  describe('registerCard（カードの登録）', () => {
    it('通常のカードを登録し、トークン・ブランド・下4桁を返す', async () => {
      const result = await gateway.registerCard(cardInput(CARDS.normal));
      expect(result).toEqual({
        ok: true,
        value: { token: expect.any(String), brand: 'VISA', last4: '4242' },
      });
      if (!result.ok) return;
      expect(gateway.listCards()).toEqual([
        { token: result.value.token, brand: 'VISA', last4: '4242', expMonth: 12, expYear: 2030 },
      ]);
    });

    it.each([
      ['4242424242424242', 'VISA', '4242'],
      ['5555555555554444', 'MASTERCARD', '4444'],
      ['2223003122003222', 'MASTERCARD', '3222'],
      ['378282246310005', 'AMEX', '0005'],
      ['3530111333300000', 'JCB', '0000'],
      ['36227206271667', 'DINERS', '1667'],
      ['6011111111111117', 'DISCOVER', '1117'],
      ['9000000000000004', 'UNKNOWN', '0004'],
    ])('カード番号 %s のブランドは %s、下4桁は %s', async (cardNumber, brand, last4) => {
      const result = await gateway.registerCard(cardInput(cardNumber));
      expect(result).toEqual({ ok: true, value: { token: expect.any(String), brand, last4 } });
    });

    it('同じカードでも、登録のたびに別のトークンを発行する', async () => {
      const first = await registeredToken(gateway, CARDS.normal);
      const second = await registeredToken(gateway, CARDS.normal);
      expect(first).not.toBe(second);
    });

    it.each([CARDS.chargeDeclined, CARDS.chargeAndRefundUnavailable, CARDS.refundUnavailable])(
      'カード %s（末尾0341・0259・0267）は登録できる（L-16）',
      async (cardNumber) => {
        const result = await gateway.registerCard(cardInput(cardNumber));
        expect(result.ok).toBe(true);
      },
    );

    it('[4.21] 末尾0002 のカードは登録を拒否し（PAYMENT_DECLINED）、カードを記録しない', async () => {
      const result = await gateway.registerCard(cardInput(CARDS.declined));
      expect(result).toEqual({ ok: false, error: 'PAYMENT_DECLINED' });
      expect(gateway.listCards()).toEqual([]);
    });

    it('[4.21] 末尾0119 のカードは登録で一時的な障害（PAYMENT_GATEWAY_UNAVAILABLE）を返し、カードを記録しない', async () => {
      const result = await gateway.registerCard(cardInput(CARDS.unavailable));
      expect(result).toEqual({ ok: false, error: 'PAYMENT_GATEWAY_UNAVAILABLE' });
      expect(gateway.listCards()).toEqual([]);
    });

    it('空白・ハイフンで区切ったカード番号も、数字だけにして扱う', async () => {
      const spaced = await gateway.registerCard(cardInput('4242 4242 4242 4242'));
      expect(spaced).toMatchObject({ ok: true, value: { brand: 'VISA', last4: '4242' } });
      const hyphenated = await gateway.registerCard(cardInput('4000-0000-0000-0002'));
      expect(hyphenated).toEqual({ ok: false, error: 'PAYMENT_DECLINED' });
    });

    it.each(['', '4242', '42424242424', '42424242424242424242', '4242-abcd-4242-4242'])(
      'カード番号の形でない値（%j）は拒否する（PAYMENT_DECLINED）',
      async (cardNumber) => {
        const result = await gateway.registerCard(cardInput(cardNumber));
        expect(result).toEqual({ ok: false, error: 'PAYMENT_DECLINED' });
        expect(gateway.listCards()).toEqual([]);
      },
    );
  });

  describe('charge（決済）', () => {
    it('登録カードで決済し、決済の識別子を返して1件記録する', async () => {
      const token = await registeredToken(gateway, CARDS.normal);
      const result = await gateway.charge(token, 31_600, 'key-1');
      expect(result).toEqual({ ok: true, value: { providerRef: expect.any(String) } });
      if (!result.ok) return;
      expect(gateway.listCharges()).toEqual([
        { idempotencyKey: 'key-1', providerRef: result.value.providerRef, token, amount: 31_600 },
      ]);
    });

    it('[4.21] 同じ冪等キーで2回決済しても1回分しか記録せず、2回目は前回と同じ結果を返す', async () => {
      const token = await registeredToken(gateway, CARDS.normal);
      const first = await gateway.charge(token, 72_000, 'key-dup');
      const second = await gateway.charge(token, 72_000, 'key-dup');
      expect(first.ok).toBe(true);
      expect(second).toEqual(first);
      expect(gateway.listCharges()).toHaveLength(1);
      expect(gateway.listCharges()[0]).toMatchObject({ idempotencyKey: 'key-dup', amount: 72_000 });
    });

    it('同じ冪等キーなら、カードや額が違っても前回の結果を返し、決済しない（L-15）', async () => {
      const token = await registeredToken(gateway, CARDS.normal);
      const otherToken = await registeredToken(gateway, CARDS.refundUnavailable);
      const first = await gateway.charge(token, 10_000, 'key-same');
      const second = await gateway.charge(otherToken, 99_999, 'key-same');
      expect(second).toEqual(first);
      expect(gateway.listCharges()).toEqual([
        expect.objectContaining({ idempotencyKey: 'key-same', token, amount: 10_000 }),
      ]);
    });

    it('同時に同じ冪等キーで決済しても、1回分しか記録しない', async () => {
      const token = await registeredToken(gateway, CARDS.normal);
      const results = await Promise.all([
        gateway.charge(token, 5_000, 'key-race'),
        gateway.charge(token, 5_000, 'key-race'),
        gateway.charge(token, 5_000, 'key-race'),
      ]);
      expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
      expect(gateway.listCharges()).toHaveLength(1);
    });

    it('冪等キーが違えば、別の決済として記録する', async () => {
      const token = await registeredToken(gateway, CARDS.normal);
      const first = await gateway.charge(token, 1_000, 'key-a');
      const second = await gateway.charge(token, 1_000, 'key-b');
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(first.value.providerRef).not.toBe(second.value.providerRef);
      expect(gateway.listCharges()).toHaveLength(2);
    });

    it('[4.21] 末尾0002 のカードの決済を拒否し（PAYMENT_DECLINED）、記録しない', async () => {
      const testGateway = new TestPaymentGateway();
      const token = await forceRegisteredToken(testGateway, CARDS.declined);
      const result = await testGateway.charge(token, 31_600, 'key-0002');
      expect(result).toEqual({ ok: false, error: 'PAYMENT_DECLINED' });
      expect(testGateway.listCharges()).toEqual([]);
    });

    it('[4.21] 末尾0119 のカードの決済は一時的な障害（PAYMENT_GATEWAY_UNAVAILABLE）を返し、記録しない', async () => {
      const testGateway = new TestPaymentGateway();
      const token = await forceRegisteredToken(testGateway, CARDS.unavailable);
      const result = await testGateway.charge(token, 31_600, 'key-0119');
      expect(result).toEqual({ ok: false, error: 'PAYMENT_GATEWAY_UNAVAILABLE' });
      expect(testGateway.listCharges()).toEqual([]);
    });

    it('[4.21] 末尾0341 のカードは、登録は成功し決済だけを拒否する（PAYMENT_DECLINED）', async () => {
      const token = await registeredToken(gateway, CARDS.chargeDeclined);
      const result = await gateway.charge(token, 28_000, 'key-0341');
      expect(result).toEqual({ ok: false, error: 'PAYMENT_DECLINED' });
      expect(gateway.listCharges()).toEqual([]);
    });

    it('[4.21] 拒否した冪等キーで再び決済しても、前回の結果（拒否）を返し、決済しない（L-15）', async () => {
      const declinedToken = await registeredToken(gateway, CARDS.chargeDeclined);
      const normalToken = await registeredToken(gateway, CARDS.normal);
      await gateway.charge(declinedToken, 31_600, 'key-retry');
      const retried = await gateway.charge(normalToken, 31_600, 'key-retry');
      expect(retried).toEqual({ ok: false, error: 'PAYMENT_DECLINED' });
      expect(gateway.listCharges()).toEqual([]);
    });

    it('[4.21] 末尾0259 のカードの決済は一時的な障害を返し、決済を記録しない（L-50）。同じ冪等キーで再試行できる', async () => {
      const token = await registeredToken(gateway, CARDS.chargeAndRefundUnavailable);
      const first = await gateway.charge(token, 31_600, 'key-0259');
      expect(first).toEqual({ ok: false, error: 'PAYMENT_GATEWAY_UNAVAILABLE' });
      expect(gateway.listCharges()).toEqual([]);

      // 一時的な障害は結果として覚えないので、同じ冪等キーの再試行で、もう一度決済を試みる
      const testGateway = new TestPaymentGateway();
      const testToken = await registeredToken(testGateway, CARDS.chargeAndRefundUnavailable);
      await testGateway.charge(testToken, 31_600, 'key-0259');
      testGateway.force('charge', 'SUCCEED');
      const retried = await testGateway.charge(testToken, 31_600, 'key-0259');
      expect(retried).toEqual({ ok: true, value: { providerRef: expect.any(String) } });
      expect(testGateway.listCharges()).toHaveLength(1);
    });

    it('末尾0267 のカードは決済できる', async () => {
      const token = await registeredToken(gateway, CARDS.refundUnavailable);
      const result = await gateway.charge(token, 85_200, 'key-0267');
      expect(result.ok).toBe(true);
      expect(gateway.listCharges()).toHaveLength(1);
    });

    it('削除したカードの決済は拒否する', async () => {
      const token = await registeredToken(gateway, CARDS.normal);
      await gateway.deleteCard(token);
      const result = await gateway.charge(token, 1_000, 'key-deleted');
      expect(result).toEqual({ ok: false, error: 'PAYMENT_DECLINED' });
      expect(gateway.listCharges()).toEqual([]);
    });

    it('この決済サービスが発行していないトークンの決済は拒否する', async () => {
      const result = await gateway.charge('tok_unknown', 1_000, 'key-unknown');
      expect(result).toEqual({ ok: false, error: 'PAYMENT_DECLINED' });
    });

    it('プロセスを再起動した後（別のインスタンス）でも、発行済みのトークンでカードの末尾どおりに決済する', async () => {
      const normalToken = await registeredToken(gateway, CARDS.normal);
      const declinedToken = await registeredToken(gateway, CARDS.chargeDeclined);
      const restarted = new MockPaymentGateway();
      expect(await restarted.charge(normalToken, 1_000, 'key-r1')).toMatchObject({ ok: true });
      expect(await restarted.charge(declinedToken, 1_000, 'key-r2')).toEqual({
        ok: false,
        error: 'PAYMENT_DECLINED',
      });
    });

    it.each([0, -100, 100.5, Number.NaN])(
      '額（%s）が正の整数でなければ、プログラムの誤りとして例外にする',
      async (amount) => {
        const token = await registeredToken(gateway, CARDS.normal);
        await expect(gateway.charge(token, amount, 'key-amount')).rejects.toThrow(RangeError);
        expect(gateway.listCharges()).toEqual([]);
      },
    );

    it('冪等キーが空なら、プログラムの誤りとして例外にする', async () => {
      const token = await registeredToken(gateway, CARDS.normal);
      await expect(gateway.charge(token, 1_000, '')).rejects.toThrow(RangeError);
    });
  });

  describe('refund（返金）', () => {
    async function chargedRef(cardNumber: string, key = 'charge-key'): Promise<string> {
      const token = await registeredToken(gateway, cardNumber);
      const result = await gateway.charge(token, 85_200, key);
      if (!result.ok) throw new Error(`前提の決済ができませんでした: ${result.error}`);
      return result.value.providerRef;
    }

    it('決済を返金し、返金の識別子を返して1件記録する', async () => {
      const chargeRef = await chargedRef(CARDS.normal);
      const result = await gateway.refund(chargeRef, 56_800, 'refund-1');
      expect(result).toEqual({ ok: true, value: { providerRef: expect.any(String) } });
      if (!result.ok) return;
      expect(result.value.providerRef).not.toBe(chargeRef);
      expect(gateway.listRefunds()).toEqual([
        {
          idempotencyKey: 'refund-1',
          providerRef: result.value.providerRef,
          chargeProviderRef: chargeRef,
          amount: 56_800,
        },
      ]);
    });

    it('同じ冪等キーで2回返金しても1回分しか記録せず、前回と同じ結果を返す', async () => {
      const chargeRef = await chargedRef(CARDS.normal);
      const first = await gateway.refund(chargeRef, 56_800, 'refund-dup');
      const second = await gateway.refund(chargeRef, 56_800, 'refund-dup');
      expect(first.ok).toBe(true);
      expect(second).toEqual(first);
      expect(gateway.listRefunds()).toHaveLength(1);
    });

    it('[4.21] 末尾0267 のカードの決済の返金は一時的な障害を返し、記録しない。同じ冪等キーで再試行できる', async () => {
      const chargeRef = await chargedRef(CARDS.refundUnavailable);
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await gateway.refund(chargeRef, 56_800, 'refund-0267');
        expect(result).toEqual({ ok: false, error: 'PAYMENT_GATEWAY_UNAVAILABLE' });
      }
      expect(gateway.listRefunds()).toEqual([]);
    });

    it('[4.21] 末尾0259 のカードの決済の返金は一時的な障害を返す', async () => {
      const testGateway = new TestPaymentGateway();
      const chargeRef = await forceChargedRef(testGateway, CARDS.chargeAndRefundUnavailable, 'k');
      const result = await testGateway.refund(chargeRef, 10_000, 'refund-0259');
      expect(result).toEqual({ ok: false, error: 'PAYMENT_GATEWAY_UNAVAILABLE' });
      expect(testGateway.listRefunds()).toEqual([]);
    });

    it('プロセスを再起動した後（別のインスタンス）でも、決済の識別子のカードの末尾どおりに返金する', async () => {
      const normalRef = await chargedRef(CARDS.normal, 'charge-normal');
      const failingRef = await chargedRef(CARDS.refundUnavailable, 'charge-0267');
      const restarted = new MockPaymentGateway();
      expect(await restarted.refund(normalRef, 1_000, 'refund-r1')).toMatchObject({ ok: true });
      expect(await restarted.refund(failingRef, 1_000, 'refund-r2')).toEqual({
        ok: false,
        error: 'PAYMENT_GATEWAY_UNAVAILABLE',
      });
    });

    it('この決済サービスが発行していない決済の識別子は、プログラムの誤りとして例外にする', async () => {
      await expect(gateway.refund('ch_unknown', 1_000, 'refund-unknown')).rejects.toThrow();
      expect(gateway.listRefunds()).toEqual([]);
    });

    it('額が正の整数でない、または冪等キーが空なら、プログラムの誤りとして例外にする', async () => {
      const chargeRef = await chargedRef(CARDS.normal);
      await expect(gateway.refund(chargeRef, 0, 'refund-zero')).rejects.toThrow(RangeError);
      await expect(gateway.refund(chargeRef, 1_000, '')).rejects.toThrow(RangeError);
    });
  });

  describe('findCharge（決済の照合。L-29）', () => {
    it('決済された冪等キーなら、決済の識別子と額を返す', async () => {
      const token = await registeredToken(gateway, CARDS.normal);
      const charged = await gateway.charge(token, 31_600, 'K1');
      if (!charged.ok) throw new Error('前提の決済ができませんでした');
      const result = await gateway.findCharge('K1');
      expect(result).toEqual({
        ok: true,
        value: { providerRef: charged.value.providerRef, amount: 31_600 },
      });
    });

    it('[4.21] 拒否された冪等キー（末尾0341）は null を返す', async () => {
      const token = await registeredToken(gateway, CARDS.chargeDeclined);
      await gateway.charge(token, 31_600, 'K-declined');
      expect(await gateway.findCharge('K-declined')).toEqual({ ok: true, value: null });
    });

    it('[4.21] 一時的な障害を返した冪等キー（末尾0259）は null を返す（L-50）', async () => {
      const token = await registeredToken(gateway, CARDS.chargeAndRefundUnavailable);
      await gateway.charge(token, 31_600, 'K-unavailable');
      expect(await gateway.findCharge('K-unavailable')).toEqual({ ok: true, value: null });
    });

    it('決済を試みていない冪等キーは null を返す', async () => {
      expect(await gateway.findCharge('K-never')).toEqual({ ok: true, value: null });
    });
  });

  describe('deleteCard（カードの削除）', () => {
    it('登録カードを削除する（記録から消え、以後そのトークンでは決済できない）', async () => {
      const token = await registeredToken(gateway, CARDS.normal);
      const kept = await registeredToken(gateway, CARDS.refundUnavailable);
      await gateway.deleteCard(token);
      expect(gateway.listCards().map((card) => card.token)).toEqual([kept]);
      expect(await gateway.charge(token, 1_000, 'key-after-delete')).toEqual({
        ok: false,
        error: 'PAYMENT_DECLINED',
      });
    });

    it('削除済み・存在しないトークンを削除しても例外にしない', async () => {
      const token = await registeredToken(gateway, CARDS.normal);
      await gateway.deleteCard(token);
      await expect(gateway.deleteCard(token)).resolves.toBeUndefined();
      await expect(gateway.deleteCard('tok_unknown')).resolves.toBeUndefined();
    });
  });

  describe('カード番号を保存もログ出力もしない（design.md Security Considerations）', () => {
    const outputSpies: { mock: { calls: unknown[][] } }[] = [];
    beforeEach(() => {
      outputSpies.push(
        vi.spyOn(console, 'log'),
        vi.spyOn(console, 'info'),
        vi.spyOn(console, 'warn'),
        vi.spyOn(console, 'error'),
        vi.spyOn(console, 'debug'),
        vi.spyOn(process.stdout, 'write'),
        vi.spyOn(process.stderr, 'write'),
      );
    });
    afterEach(() => {
      vi.restoreAllMocks();
      outputSpies.length = 0;
    });

    it.each(Object.values(CARDS))(
      'カード %s を登録・決済した後も、模擬の状態・戻り値・出力にカード番号がない',
      async (cardNumber) => {
        const result = await gateway.registerCard(cardInput(cardNumber));
        if (result.ok) {
          await gateway.charge(result.value.token, 1_000, 'key-no-card-number');
        }

        // 模擬の状態（Map などの中身も含めてすべて）
        const state = inspect(gateway, { depth: null, showHidden: true });
        // 下4桁は保存してよいので、それより前の桁（12桁）が現れないことも確かめる
        const leadingDigits = cardNumber.slice(0, -4);
        expect(state).not.toContain(cardNumber);
        expect(state).not.toContain(leadingDigits);
        expect(JSON.stringify(result)).not.toContain(cardNumber);
        expect(JSON.stringify(result)).not.toContain(leadingDigits);

        // ログ・標準出力
        const output = outputSpies.flatMap((spy) => spy.mock.calls).map((args) => inspect(args));
        expect(output.join('\n')).not.toContain(cardNumber);
        expect(output.join('\n')).not.toContain(leadingDigits);
      },
    );
  });
});
