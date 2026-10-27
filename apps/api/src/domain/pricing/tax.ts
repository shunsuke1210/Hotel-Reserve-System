// 消費税の加算と100円未満の切り捨て（要件 6.13・6.14）、宿泊税の判定（要件 6.16）。design.md P-01 手順3・5・7。
//
// 金額の計算は BigInt の整数だけで行い、小数を使わない（丸め誤差を出さないため。design.md PriceCalculator）。
// 途中の積（単価のもと ×（10,000＋率）×（10,000＋消費税率））が Number の安全な整数の範囲を超えても誤差は出ない。
import type { BasisPoints, Yen } from '@hotel/contracts';
import type { LodgingTaxBracket } from './types.js';

/** 税込み単価を切り捨てる単位（100円未満を切り捨てる。要件 6.13・6.14） */
export const PRICE_TRUNCATION_UNIT: Yen = 100;

/** 率の分母（10,000bp ＝ 100%） */
const BP_PER_WHOLE = 10_000n;

/**
 * 単価のもと（税抜・率をかける前の1人あたりの額）＝ numerator ÷ denominator。
 * 子どもは大人の半額で、0.5円の端数を途中で切り捨てないために分数で表す（test-cases Q-PR-05、TC-PR-060）。
 */
export interface UnitBase {
  numerator: Yen;
  denominator: 1 | 2;
}

/**
 * 税込み単価 ＝ ⌊ 単価のもと ×（10,000＋率）×（10,000＋消費税率）÷（10,000 × 10,000 × 100）⌋ × 100。
 * 消費税 10%（1000bp）なら design.md P-01 手順3 の ⌊ 単価のもと ×（10,000＋率）× 11 ÷ 10,000,000 ⌋ × 100 と同じ。
 * 朝食（率をかけない）は rateBp に 0 を渡す（P-01 手順5）。
 */
export function taxInclusiveUnitPrice(
  unitBase: UnitBase,
  rateBp: BasisPoints,
  consumptionTaxBp: BasisPoints,
): Yen {
  const scaled = scaledExclTax(unitBase, rateBp) * multiplierOf(consumptionTaxBp, '消費税率');
  const divisor =
    BigInt(unitBase.denominator) * BP_PER_WHOLE * BP_PER_WHOLE * BigInt(PRICE_TRUNCATION_UNIT);
  // 両方とも0以上なので、BigInt の割り算（0 に向けて切り捨て）は切り捨て（⌊ ⌋）と同じ
  return Number(scaled / divisor) * PRICE_TRUNCATION_UNIT;
}

/**
 * 1人1泊の宿泊税。税抜の素泊まり単価（単価のもと ×（10,000＋率）÷ 10,000。100円未満を切り捨てる前の値）を、
 * 区分の下限（minExclTax）と整数のまま比べ、当てはまる区分のうち下限が最も高いものの税額にする（要件 6.16、P-01 手順7）。
 * どの区分にも当てはまらなければ 0円。朝食・時間外の料金と消費税は含めない（呼び出し側が宿泊料金の単価のもとだけを渡す）。
 */
export function lodgingTaxPerPersonNight(
  unitBase: UnitBase,
  rateBp: BasisPoints,
  brackets: readonly LodgingTaxBracket[],
): Yen {
  // 税抜単価 × denominator × 10,000 の整数
  const scaled = scaledExclTax(unitBase, rateBp);
  let selected: LodgingTaxBracket | undefined;
  for (const bracket of brackets) {
    const scaledMin =
      integerOf(bracket.minExclTax, '宿泊税の区分の下限') *
      BigInt(unitBase.denominator) *
      BP_PER_WHOLE;
    if (
      scaled >= scaledMin &&
      (selected === undefined || bracket.minExclTax > selected.minExclTax)
    ) {
      selected = bracket;
    }
  }
  return selected?.taxPerPersonNight ?? 0;
}

/** 単価のもと ×（10,000＋率）＝ 税抜単価 × denominator × 10,000 */
function scaledExclTax(unitBase: UnitBase, rateBp: BasisPoints): bigint {
  const numerator = integerOf(unitBase.numerator, '単価のもと');
  if (numerator < 0n) {
    throw new RangeError(`単価のもとは0以上で指定してください: ${unitBase.numerator}`);
  }
  if (unitBase.denominator !== 1 && unitBase.denominator !== 2) {
    throw new RangeError(
      `単価のもとの分母は1か2で指定してください: ${String(unitBase.denominator)}`,
    );
  }
  return numerator * multiplierOf(rateBp, '率');
}

/** 10,000＋率（0以上） */
function multiplierOf(bp: BasisPoints, label: string): bigint {
  const multiplier = BP_PER_WHOLE + integerOf(bp, label);
  if (multiplier < 0n) {
    throw new RangeError(`${label}は −10,000bp 以上で指定してください: ${bp}`);
  }
  return multiplier;
}

function integerOf(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label}は整数で指定してください: ${value}`);
  }
  return BigInt(value);
}
