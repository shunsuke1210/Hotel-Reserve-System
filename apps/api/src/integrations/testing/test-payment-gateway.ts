// テスト専用の模擬の決済。本番の結び付け（integrations.module.ts）には使わない。
// 固定しない間は MockPaymentGateway と同じく、カードの末尾の規則（L-16）で振る舞う。
// 結合テストで「テスト用に模擬の決済を差し替え、返金が成功するようにする（障害の解除）」（TC-IT-070・075）などの
// 前提を作るときに、overrideProvider(PaymentGateway).useValue(new TestPaymentGateway()) で差し替えて使う。
import {
  MockPaymentGateway,
  type ChargeOutcome,
  type FindChargeOutcome,
  type RefundOutcome,
  type RegisterCardOutcome,
} from '../payment/mock-payment.gateway.js';

/** 固定できる操作と、その結果 */
export interface ForcedPaymentOutcomes {
  registerCard: RegisterCardOutcome;
  charge: ChargeOutcome;
  refund: RefundOutcome;
  findCharge: FindChargeOutcome;
}

export class TestPaymentGateway extends MockPaymentGateway {
  private forced: Partial<ForcedPaymentOutcomes> = {};

  /**
   * 以後の操作の結果を、カードの末尾にかかわらず固定する。null なら固定を解除し、カードの末尾の規則に戻す。
   * 冪等キーごとに覚えた前回の結果（成功・拒否）は、固定しても変わらない
   */
  force<K extends keyof ForcedPaymentOutcomes>(
    operation: K,
    outcome: ForcedPaymentOutcomes[K] | null,
  ): void {
    if (outcome === null) {
      delete this.forced[operation];
    } else {
      this.forced[operation] = outcome;
    }
  }

  /** すべての固定を解除する */
  clearForced(): void {
    this.forced = {};
  }

  protected override registerCardOutcome(last4: string): RegisterCardOutcome {
    return this.forced.registerCard ?? super.registerCardOutcome(last4);
  }

  protected override chargeOutcome(last4: string): ChargeOutcome {
    return this.forced.charge ?? super.chargeOutcome(last4);
  }

  protected override refundOutcome(last4: string): RefundOutcome {
    return this.forced.refund ?? super.refundOutcome(last4);
  }

  protected override findChargeOutcome(): FindChargeOutcome {
    return this.forced.findCharge ?? super.findChargeOutcome();
  }
}
