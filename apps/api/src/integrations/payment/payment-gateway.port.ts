// 決済サービスのインターフェース（design.md Components and Interfaces「PaymentGateway・Translator・MailSender」、ADR-05）。
// 業務のコードはこのインターフェースだけを使い、模擬実装（mock-payment.gateway.ts）を直接読み込まない。
// NestJS では、この抽象クラスを依存の注入のトークンとして使う（実装は integrations.module.ts で結び付ける）。
//
// カード番号は API のメモリ上でこのインターフェースに渡すだけで、保存もログ出力もしない（design.md Security Considerations）。
// 保存してよいのは、registerCard が返すトークン・ブランド・下4桁と、入力の有効期限だけ。
import type { Result, Yen } from '@hotel/contracts';

/** カードの登録・決済の失敗（拒否、または決済サービスの一時的な障害） */
export type PaymentFailure = 'PAYMENT_DECLINED' | 'PAYMENT_GATEWAY_UNAVAILABLE';

/** 返金・照合の失敗（決済サービスの一時的な障害だけ） */
export type PaymentGatewayUnavailable = 'PAYMENT_GATEWAY_UNAVAILABLE';

export interface CardRegistrationInput {
  /** カード番号（決済サービスに渡すだけで、保存もログ出力もしない） */
  cardNumber: string;
  expMonth: number;
  expYear: number;
  holderName: string;
}

export interface RegisteredCard {
  /** 決済サービスが発行するカードの識別子（member_cards.payment_token） */
  token: string;
  brand: string;
  last4: string;
}

export interface PaymentReceipt {
  /** 決済サービスが発行する、決済または返金の識別子（payments.provider_ref） */
  providerRef: string;
}

export interface ChargeRecord {
  providerRef: string;
  amount: Yen;
}

export abstract class PaymentGateway {
  /** カードを登録し、カードの識別子（トークン）を受け取る（1.1, 1.8） */
  abstract registerCard(
    input: CardRegistrationInput,
  ): Promise<Result<RegisteredCard, PaymentFailure>>;

  /**
   * 登録カードで決済する。冪等キーは画面が送る idempotencyKey（L-15）で、同じキーの決済は二重に行わず、前回の結果を返す。
   * PAYMENT_GATEWAY_UNAVAILABLE のときは決済されたかが分からないので、呼び出し側は findCharge で確かめる（L-29, L-35）
   */
  abstract charge(
    token: string,
    amount: Yen,
    idempotencyKey: string,
  ): Promise<Result<PaymentReceipt, PaymentFailure>>;

  /** 決済（もとの決済の providerRef）を返金する。同じ冪等キーの返金は二重に行わず、前回の結果を返す（DT-M18） */
  abstract refund(
    providerRef: string,
    amount: Yen,
    idempotencyKey: string,
  ): Promise<Result<PaymentReceipt, PaymentGatewayUnavailable>>;

  /** 冪等キーの決済を照合する（payment-reconcile。L-29, L-36）。決済されていなければ null */
  abstract findCharge(
    idempotencyKey: string,
  ): Promise<Result<ChargeRecord | null, PaymentGatewayUnavailable>>;

  /** 登録カードを削除する（退会・アカウントの自動削除。1.11, 19.4） */
  abstract deleteCard(token: string): Promise<void>;
}
