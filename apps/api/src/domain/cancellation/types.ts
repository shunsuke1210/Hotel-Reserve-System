// CancellationPolicy の入出力の型（design.md Components and Interfaces > CancellationPolicy、処理仕様 P-06・P-07 手順3、
// 設計の補足 DT-M21・DT-M23・DT-M25・DT-M42・DT-M44・DT-M51・DT-M52・DT-M53）。金額はすべて円の整数（Yen）。
//
// design の RemovalScope・CancellationContext・CancellationFee を、決まった規定を表せるように次の点で広げている。
// - 取り消す宿泊料金の明細に、客室タイプを移した夜の UPGRADE・DOWNGRADE_ADJUSTMENT を含める（8.5, 8.6、DT-M21）
// - 明細ごとに早期割をかけたか（earlyBirdApplied）を持つ。返金しないのは早期割を適用した夜（明細）だけで、
//   早期割なしの料金で加えた夜・人は個人・団体の規定で計算する（7.7, 8.9、PY-09a、DT-M52）
// - 明細ごとに減らした部屋・人の組（removedUnit）を持てる。期限後の1泊分は組ごとの最初の夜の合計（DT-M53）
// - 取り消す宿泊税の明細を渡し、返金する（現地払いは請求しない）ものと、付け替えるものに分ける（8.19, 20.7、PY-17a）
// - 支払い方法を渡す（現地払いは宿泊税を前払いしていないので、取り消した夜の宿泊税は請求しない。P-06）
// - NON_REFUNDABLE に返金しない額を持たせ、早期割の明細とそれ以外の明細の規定を両方返せるようにする
import type { ChargeCategory, PaymentMethod, Yen } from '@hotel/contracts';

/** 宿泊料金の明細の区分：ROOM と、客室タイプを移した夜の差額（有償の上位 UPGRADE・下位への移動の DOWNGRADE_ADJUSTMENT） */
export type RemovedStayLineCategory = Extract<
  ChargeCategory,
  'ROOM' | 'UPGRADE' | 'DOWNGRADE_ADJUSTMENT'
>;

/**
 * 取り消す宿泊料金の明細（夜ごと）。朝食・時間外はキャンセル料に含めないので渡さない（8.5）。
 * 人を減らす変更では、減らした人の分（単価 × 減らした人数）を1行にして渡す。
 */
export interface RemovedStayLine {
  category: RemovedStayLineCategory;
  /** YYYY-MM-DD（宿泊日） */
  stayDate: string;
  /** 税込みの表示額。ROOM・UPGRADE は0以上、DOWNGRADE_ADJUSTMENT は0以下 */
  amountInclTax: Yen;
  /** この明細の料金に早期割をかけたか（早期割の予約でも、早期割なしの料金で加えた夜・人は false） */
  earlyBirdApplied: boolean;
  /**
   * 減らした部屋・人の組（同じ値の明細が同じ組）。個人の期限後の1泊分は、組ごとにその組の減らした最初の夜の料金を足した額
   * （CH-09 を人ごとに当てる。DT-M53）。人数と泊数などを同時に減らすときは、減らした人（例：3人目の全泊）と、
   * 残る人の減らした夜（例：大人2名の最後の夜）を別の組にする。省略した明細はまとめて1つの組として扱うので、
   * 予約全体のキャンセル・泊数だけ・人数だけを減らす変更・早期チェックアウト・日程の変更では省略できる
   */
  removedUnit?: string;
}

/** 取り消す宿泊税の明細（夜ごと）。客室タイプを移したときの宿泊税の差額（DT-M20。負の額もある）を含む */
export interface RemovedLodgingTaxLine {
  category: Extract<ChargeCategory, 'LODGING_TAX'>;
  /** YYYY-MM-DD（宿泊日） */
  stayDate: string;
  amountInclTax: Yen;
  /** 同じ夜・同じ人の宿泊料金の明細の earlyBirdApplied と同じ値 */
  earlyBirdApplied: boolean;
}

/** 取り消す明細。宿泊税の明細は、呼び出し側の行（charge_lines の ID など）を持たせたまま結果で返す */
export interface RemovedLines<T extends RemovedLodgingTaxLine = RemovedLodgingTaxLine> {
  /** 取り消す宿泊料金の明細（ROOM・UPGRADE・DOWNGRADE_ADJUSTMENT） */
  removedRoomLines: readonly RemovedStayLine[];
  /** 取り消す夜の宿泊税の明細（宿泊料金の明細と同じ夜・同じ earlyBirdApplied の組に限る） */
  removedLodgingTaxLines: readonly T[];
}

/**
 * 取り消す範囲。kind は何による取り消しかを表す（計算は明細だけで決まる）。
 * 人数を変えずに室数だけを減らす変更（ROOMS）は、取り消す宿泊料金の明細がないので空で渡す（7.19、CH-11）。
 * 日程の変更は、もとの夜をすべて取り消す FULL として渡す（P-05 手順3a）。
 */
export interface RemovalScope<
  T extends RemovedLodgingTaxLine = RemovedLodgingTaxLine,
> extends RemovedLines<T> {
  kind: 'FULL' | 'NIGHTS' | 'ROOMS' | 'PERSONS' | 'EARLY_DEPARTURE';
}

export interface CancellationContext {
  /**
   * 規定の基準にする到着日（個人の期限・団体の段階）。日程の変更でもとの夜を取り消すときは、もとの到着日（DT-M44）
   */
  arrivalDate: string;
  /** reservations.is_group（一度 true になったら戻さない。8.7, 8.8） */
  isGroup: boolean;
  /** reservations.early_bird（早期割の予約か）。false の予約に earlyBirdApplied の明細があれば入力の誤り */
  earlyBird: boolean;
  paymentMethod: PaymentMethod;
  /** 取り消しを確定する時刻 */
  at: Date;
}

/** ノーショーの判定に使う予約の情報（期限・段階を使わないので、到着日と時刻は要らない） */
export type NoShowContext = Pick<CancellationContext, 'isGroup' | 'earlyBird' | 'paymentMethod'>;

/** 団体のキャンセル料の率（%）。到着日の30日前・7日前・前日の各 0:00 が境目（8.6、PY-13） */
export type GroupCancellationPercent = 0 | 20 | 50 | 100;

/**
 * 適用した規定（G16・F06 の「適用した規定」の表示。L-32）。
 * - NON_REFUNDABLE：早期割を適用した明細は返金しない（8.9）。amount は返金しない宿泊料金
 * - FREE：キャンセル料0円（個人の期限内・団体の30日前より前・取り消す宿泊料金がない）
 * - FIRST_REMOVED_NIGHT：個人の期限後の1泊分（取り消した最初の夜。8.4, 8.5）。ノーショーでは1泊目（P-07 手順3）
 * - GROUP_PERCENT：団体（8.6）。団体のノーショーは全泊の100%（8.25、DT-M23）
 */
export type CancellationFee =
  | { kind: 'NON_REFUNDABLE'; amount: Yen }
  | { kind: 'FREE' }
  | { kind: 'FIRST_REMOVED_NIGHT'; amount: Yen }
  | { kind: 'GROUP_PERCENT'; percent: Exclude<GroupCancellationPercent, 0>; amount: Yen };

/** 返金しない宿泊料金・宿泊税の区分（キャンセル・減らす変更・早期チェックアウトは CANCELLATION_FEE、ノーショーは NO_SHOW_FEE） */
export type CancellationFeeCategory = Extract<ChargeCategory, 'CANCELLATION_FEE' | 'NO_SHOW_FEE'>;

export interface CancellationEvaluation<T extends RemovedLodgingTaxLine = RemovedLodgingTaxLine> {
  feeCategory: CancellationFeeCategory;
  /**
   * 適用した規定。早期割を適用していない明細の規定（FREE・FIRST_REMOVED_NIGHT・GROUP_PERCENT）と、
   * 早期割を適用した明細の NON_REFUNDABLE の、どちらかまたは両方（この順）。取り消す宿泊料金の明細がなければ FREE だけ
   */
  rules: CancellationFee[];
  /** キャンセル料・ノーショー料（請求額。8.2 の表示、FEE_CHARGE の額）。NON_REFUNDABLE の額を含めない（DT-M45） */
  feeAmount: Yen;
  /** 早期割で返金しない宿泊料金（feeCategory の区分の明細にする。TC-CH-130・TC-CH-153） */
  nonRefundableAmount: Yen;
  /** 返金する（現地払いは請求しない）宿泊料金 ＝ 取り消す宿泊料金の合計 − feeAmount − nonRefundableAmount */
  releasedStayAmount: Yen;
  /** 返金しない宿泊税：feeCategory の区分に付け替え、市に納める宿泊税に含めない（20.7、PY-17a）。現地払いは常に空 */
  retainedLodgingTaxLines: T[];
  retainedLodgingTaxAmount: Yen;
  /** 取り消すだけの宿泊税：事前決済は返金し、現地払いは請求しない（8.19、P-06） */
  releasedLodgingTaxLines: T[];
  releasedLodgingTaxAmount: Yen;
}

export interface CancellationPolicy {
  /** キャンセル・減らす変更・早期チェックアウト・日程の変更で取り消すもとの夜（P-06） */
  evaluate<T extends RemovedLodgingTaxLine>(
    scope: RemovalScope<T>,
    ctx: CancellationContext,
  ): CancellationEvaluation<T>;
  /** ノーショー（P-07 手順3）。scope には全泊の明細を渡す（1泊目の宿泊料金もノーショー料に置き換わる） */
  evaluateNoShow<T extends RemovedLodgingTaxLine>(
    scope: RemovedLines<T>,
    ctx: NoShowContext,
  ): CancellationEvaluation<T>;
}
