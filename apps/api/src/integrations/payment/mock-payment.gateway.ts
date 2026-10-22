// 模擬の決済（design.md PaymentGateway の模擬、設計の補足 L-16・L-50、research.md ADR-05）。
// 本物の決済サービスの代わりに、カード番号の末尾の4桁で結果を決める。
//
//   末尾 0002 … 登録・決済を拒否（PAYMENT_DECLINED）
//   末尾 0119 … 登録・決済で一時的な障害（PAYMENT_GATEWAY_UNAVAILABLE）
//   末尾 0341 … 登録は成功し、決済だけを拒否
//   末尾 0259 … 登録は成功し、決済・返金で一時的な障害
//   末尾 0267 … 登録・決済は成功し、返金だけ一時的な障害
//   それ以外 … すべて成功
//
// - カード番号は保存しない。覚えるのはトークン・ブランド・下4桁・有効期限だけで、ログにも出さない
// - 同じ冪等キーの決済・返金は二重に行わず、前回の結果（成功・拒否）を返す（L-15）
// - 一時的な障害を返した決済・返金は記録しない。照合の findCharge は null を返し、同じ冪等キーで再試行できる（L-50）
// - 状態はメモリに持つ。トークンと決済の識別子にはカードの下4桁を入れておき、プロセスを再起動した後も、
//   保存済みのトークン・識別子でカードの末尾どおりに振る舞う（再起動の前の決済・返金の記録は消える）
// - 本物の決済サービスはプロセスの外にある1つのサービスなので、2つの待ち受け口で同じインスタンスを使う（integrations.module.ts）
// - テストで結果を固定したいときは、testing/test-payment-gateway.ts を使う（本番の結び付けには使わない）
import { randomUUID } from 'node:crypto';
import type { Result, Yen } from '@hotel/contracts';
import {
  PaymentGateway,
  type CardRegistrationInput,
  type ChargeRecord,
  type PaymentFailure,
  type PaymentGatewayUnavailable,
  type PaymentReceipt,
  type RegisteredCard,
} from './payment-gateway.port.js';

/** 模擬の決済の、操作ごとの結果 */
export type RegisterCardOutcome = 'SUCCEED' | PaymentFailure;
export type ChargeOutcome = 'SUCCEED' | PaymentFailure;
export type RefundOutcome = 'SUCCEED' | 'PAYMENT_GATEWAY_UNAVAILABLE';
export type FindChargeOutcome = 'SUCCEED' | 'PAYMENT_GATEWAY_UNAVAILABLE';

interface CardBehaviour {
  registerCard: RegisterCardOutcome;
  charge: ChargeOutcome;
  refund: RefundOutcome;
}

/** テスト用のカード（末尾の4桁）と、その振る舞い（L-16）。ここにない末尾のカードは、すべて成功する */
export const MOCK_TEST_CARD_BEHAVIOURS: Readonly<Record<string, Readonly<CardBehaviour>>> = {
  '0002': { registerCard: 'PAYMENT_DECLINED', charge: 'PAYMENT_DECLINED', refund: 'SUCCEED' },
  '0119': {
    registerCard: 'PAYMENT_GATEWAY_UNAVAILABLE',
    charge: 'PAYMENT_GATEWAY_UNAVAILABLE',
    refund: 'SUCCEED',
  },
  '0341': { registerCard: 'SUCCEED', charge: 'PAYMENT_DECLINED', refund: 'SUCCEED' },
  '0259': {
    registerCard: 'SUCCEED',
    charge: 'PAYMENT_GATEWAY_UNAVAILABLE',
    refund: 'PAYMENT_GATEWAY_UNAVAILABLE',
  },
  '0267': { registerCard: 'SUCCEED', charge: 'SUCCEED', refund: 'PAYMENT_GATEWAY_UNAVAILABLE' },
};

const NORMAL_CARD: Readonly<CardBehaviour> = {
  registerCard: 'SUCCEED',
  charge: 'SUCCEED',
  refund: 'SUCCEED',
};

/** 模擬の決済が覚えているカード（カード番号と名義は持たない） */
export interface MockCardRecord {
  token: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** 模擬の決済が行った決済 */
export interface MockChargeRecord {
  idempotencyKey: string;
  providerRef: string;
  token: string;
  amount: Yen;
}

/** 模擬の決済が行った返金 */
export interface MockRefundRecord {
  idempotencyKey: string;
  /** 返金の識別子 */
  providerRef: string;
  /** 返金したもとの決済の識別子 */
  chargeProviderRef: string;
  amount: Yen;
}

/** 冪等キーごとに覚える、決済の確定した結果（一時的な障害は覚えない） */
type SettledCharge = { status: 'CHARGED'; record: MockChargeRecord } | { status: 'DECLINED' };

// 識別子の形：トークン mock_tok_{下4桁}_{UUID}、決済 mock_ch_{下4桁}_{UUID}、返金 mock_re_{UUID}
const TOKEN_PREFIX = 'mock_tok_';
const CHARGE_PREFIX = 'mock_ch_';
const REFUND_PREFIX = 'mock_re_';
const TOKEN_PATTERN = /^mock_tok_(\d{4})_/;
const CHARGE_REF_PATTERN = /^mock_ch_(\d{4})_/;

export class MockPaymentGateway extends PaymentGateway {
  private readonly cards = new Map<string, MockCardRecord>();
  private readonly deletedTokens = new Set<string>();
  private readonly settledCharges = new Map<string, SettledCharge>();
  private readonly refunds = new Map<string, MockRefundRecord>();

  override async registerCard(
    input: CardRegistrationInput,
  ): Promise<Result<RegisteredCard, PaymentFailure>> {
    const digits = toCardDigits(input.cardNumber);
    if (digits === null) {
      return failure('PAYMENT_DECLINED');
    }
    const last4 = digits.slice(-4);
    const outcome = this.registerCardOutcome(last4);
    if (outcome !== 'SUCCEED') {
      return failure(outcome);
    }
    const card: MockCardRecord = {
      token: `${TOKEN_PREFIX}${last4}_${randomUUID()}`,
      brand: detectBrand(digits),
      last4,
      expMonth: input.expMonth,
      expYear: input.expYear,
    };
    this.cards.set(card.token, card);
    return success({ token: card.token, brand: card.brand, last4 });
  }

  // 確かめてから記録するまでの間に await を挟まない（同時に同じ冪等キーで呼ばれても、二重に記録しない）
  override async charge(
    token: string,
    amount: Yen,
    idempotencyKey: string,
  ): Promise<Result<PaymentReceipt, PaymentFailure>> {
    assertAmount(amount);
    assertIdempotencyKey(idempotencyKey);
    const settled = this.settledCharges.get(idempotencyKey);
    if (settled) {
      return settled.status === 'CHARGED'
        ? success({ providerRef: settled.record.providerRef })
        : failure('PAYMENT_DECLINED');
    }

    const last4 = this.deletedTokens.has(token) ? null : cardEndingOf(token, TOKEN_PATTERN);
    const outcome = last4 === null ? 'PAYMENT_DECLINED' : this.chargeOutcome(last4);
    if (outcome === 'PAYMENT_GATEWAY_UNAVAILABLE') {
      return failure(outcome);
    }
    if (outcome === 'PAYMENT_DECLINED') {
      this.settledCharges.set(idempotencyKey, { status: 'DECLINED' });
      return failure(outcome);
    }
    const record: MockChargeRecord = {
      idempotencyKey,
      providerRef: `${CHARGE_PREFIX}${last4}_${randomUUID()}`,
      token,
      amount,
    };
    this.settledCharges.set(idempotencyKey, { status: 'CHARGED', record });
    return success({ providerRef: record.providerRef });
  }

  override async refund(
    providerRef: string,
    amount: Yen,
    idempotencyKey: string,
  ): Promise<Result<PaymentReceipt, PaymentGatewayUnavailable>> {
    assertAmount(amount);
    assertIdempotencyKey(idempotencyKey);
    const done = this.refunds.get(idempotencyKey);
    if (done) {
      return success({ providerRef: done.providerRef });
    }

    const last4 = cardEndingOf(providerRef, CHARGE_REF_PATTERN);
    if (last4 === null) {
      throw new Error('模擬の決済が発行していない決済の識別子は返金できません');
    }
    const outcome = this.refundOutcome(last4);
    if (outcome !== 'SUCCEED') {
      return failure(outcome);
    }
    const record: MockRefundRecord = {
      idempotencyKey,
      providerRef: `${REFUND_PREFIX}${randomUUID()}`,
      chargeProviderRef: providerRef,
      amount,
    };
    this.refunds.set(idempotencyKey, record);
    return success({ providerRef: record.providerRef });
  }

  override async findCharge(
    idempotencyKey: string,
  ): Promise<Result<ChargeRecord | null, PaymentGatewayUnavailable>> {
    const outcome = this.findChargeOutcome();
    if (outcome !== 'SUCCEED') {
      return failure(outcome);
    }
    const settled = this.settledCharges.get(idempotencyKey);
    return success(
      settled?.status === 'CHARGED'
        ? { providerRef: settled.record.providerRef, amount: settled.record.amount }
        : null,
    );
  }

  override async deleteCard(token: string): Promise<void> {
    this.cards.delete(token);
    this.deletedTokens.add(token);
  }

  /** 登録されているカード（登録の順） */
  listCards(): MockCardRecord[] {
    return [...this.cards.values()].map((card) => ({ ...card }));
  }

  /** 行った決済（決済の順。拒否・一時的な障害の決済は含まない） */
  listCharges(): MockChargeRecord[] {
    return [...this.settledCharges.values()]
      .filter((settled) => settled.status === 'CHARGED')
      .map((settled) => ({ ...settled.record }));
  }

  /** 行った返金（返金の順。一時的な障害の返金は含まない） */
  listRefunds(): MockRefundRecord[] {
    return [...this.refunds.values()].map((refund) => ({ ...refund }));
  }

  // 操作ごとの結果を、カードの末尾の4桁から決める。テスト用の実装（testing/）は、これを上書きして結果を固定する

  protected registerCardOutcome(last4: string): RegisterCardOutcome {
    return behaviourOf(last4).registerCard;
  }

  protected chargeOutcome(last4: string): ChargeOutcome {
    return behaviourOf(last4).charge;
  }

  protected refundOutcome(last4: string): RefundOutcome {
    return behaviourOf(last4).refund;
  }

  protected findChargeOutcome(): FindChargeOutcome {
    return 'SUCCEED';
  }
}

function success<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

function failure<E extends PaymentFailure>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}

function behaviourOf(last4: string): Readonly<CardBehaviour> {
  return MOCK_TEST_CARD_BEHAVIOURS[last4] ?? NORMAL_CARD;
}

/** カード番号を数字だけにする（空白・ハイフンの区切りは除く）。カード番号の形でなければ null */
function toCardDigits(cardNumber: string): string | null {
  const digits = cardNumber.replace(/[\s-]/g, '');
  return /^\d{12,19}$/.test(digits) ? digits : null;
}

/** カード番号の先頭の桁からブランドを決める */
function detectBrand(digits: string): string {
  const first2 = Number(digits.slice(0, 2));
  const first3 = Number(digits.slice(0, 3));
  const first4 = Number(digits.slice(0, 4));
  if (digits.startsWith('4')) return 'VISA';
  if ((first2 >= 51 && first2 <= 55) || (first4 >= 2221 && first4 <= 2720)) return 'MASTERCARD';
  if (first2 === 34 || first2 === 37) return 'AMEX';
  if (first4 >= 3528 && first4 <= 3589) return 'JCB';
  if ((first3 >= 300 && first3 <= 305) || first2 === 36 || first2 === 38 || first2 === 39) {
    return 'DINERS';
  }
  if (first4 === 6011 || first2 === 65 || (first3 >= 644 && first3 <= 649)) return 'DISCOVER';
  return 'UNKNOWN';
}

/** 模擬の決済が発行したトークン・決済の識別子から、カードの下4桁を取り出す。形が違えば null */
function cardEndingOf(value: string, pattern: RegExp): string | null {
  return pattern.exec(value)?.[1] ?? null;
}

function assertAmount(amount: Yen): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError('決済・返金の額は、1円以上の整数にしてください');
  }
}

function assertIdempotencyKey(idempotencyKey: string): void {
  if (idempotencyKey.length === 0) {
    throw new RangeError('決済・返金には冪等キーが必要です');
  }
}
