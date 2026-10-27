// 消費税の加算と100円未満の切り捨て、宿泊税の判定（design.md P-01 手順3・5・7）。
// 期待値は test-cases/01-pricing.md の記法（⌊単価のもと ×（10,000＋率）× 11 ÷ 10^7⌋ × 100）で求めたもの。
import { describe, expect, it } from 'vitest';
import { lodgingTaxPerPersonNight, taxInclusiveUnitPrice } from './tax.js';
import type { LodgingTaxBracket } from './types.js';

const BRACKETS_V1: LodgingTaxBracket[] = [
  { minExclTax: 0, taxPerPersonNight: 0 },
  { minExclTax: 5000, taxPerPersonNight: 200 },
  { minExclTax: 20000, taxPerPersonNight: 500 },
];

describe('taxInclusiveUnitPrice（税込み単価。100円未満を切り捨てる）', () => {
  it('[6.19][6.13] 大人：⌊18,700×10,500×11÷10^7⌋＝⌊215.985⌋ → 21,500円', () => {
    expect(taxInclusiveUnitPrice({ numerator: 18700, denominator: 1 }, 500, 1000)).toBe(21500);
  });

  it('[6.19][6.2] 子ども（基本料金の半額）：⌊9,350×10,500×11÷10^7⌋＝⌊107.99⌋ → 10,700円', () => {
    expect(taxInclusiveUnitPrice({ numerator: 18700, denominator: 2 }, 500, 1000)).toBe(10700);
  });

  it('[6.2] TC-PR-060 子どもの単価のもとの 0.5円を途中で切り捨てない（15,065÷2 → 8,700円。切り捨てると 8,600円）', () => {
    expect(taxInclusiveUnitPrice({ numerator: 15065, denominator: 2 }, 500, 1000)).toBe(8700);
  });

  it('[6.13] TC-PR-086 税込み 15,675円は四捨五入せず 15,600円に切り捨てる', () => {
    expect(taxInclusiveUnitPrice({ numerator: 15000, denominator: 1 }, -500, 1000)).toBe(15600);
  });

  it('[6.13] TC-PR-100 整数で計算する（40,000×7,000×11÷10^7＝308 ちょうど。小数の計算なら 30,700円に誤る）', () => {
    expect(taxInclusiveUnitPrice({ numerator: 40000, denominator: 1 }, -3000, 1000)).toBe(30800);
  });

  it('[6.14] 朝食は率をかけない：大人 3,500 → 3,800円、子ども 1,750 → 1,900円、幼児 0円', () => {
    expect(taxInclusiveUnitPrice({ numerator: 3500, denominator: 1 }, 0, 1000)).toBe(3800);
    expect(taxInclusiveUnitPrice({ numerator: 3500, denominator: 2 }, 0, 1000)).toBe(1900);
    expect(taxInclusiveUnitPrice({ numerator: 0, denominator: 1 }, 0, 1000)).toBe(0);
  });

  it('[6.13] 途中の積が 2^53 を超えても誤差なく計算する', () => {
    // 999,999,999 × 10,000 × 11,000 ≒ 1.1×10^17（Number の安全な整数の範囲を超える）。1,099,999,998.9 → 1,099,999,900
    expect(taxInclusiveUnitPrice({ numerator: 999_999_999, denominator: 1 }, 0, 1000)).toBe(
      1_099_999_900,
    );
    // ⌊1,279,000,000,000 × 10,500 × 11 ÷ 10^7⌋ ＝ 14,772,450,000 ちょうど。Number の掛け算・割り算では
    // 14,772,449,999.99… になり、100円少ない 1,477,244,999,900 に誤る
    expect(taxInclusiveUnitPrice({ numerator: 1_279_000_000_000, denominator: 1 }, 500, 1000)).toBe(
      1_477_245_000_000,
    );
  });

  it('率を足した結果が負になる入力や、整数でない金額・率は受け付けない', () => {
    expect(() => taxInclusiveUnitPrice({ numerator: 15000, denominator: 1 }, -10001, 1000)).toThrow(
      RangeError,
    );
    expect(() => taxInclusiveUnitPrice({ numerator: 15000.5, denominator: 1 }, 0, 1000)).toThrow(
      RangeError,
    );
    expect(() => taxInclusiveUnitPrice({ numerator: -1, denominator: 1 }, 0, 1000)).toThrow(
      RangeError,
    );
    expect(() => taxInclusiveUnitPrice({ numerator: 15000, denominator: 1 }, 0.5, 1000)).toThrow(
      RangeError,
    );
  });
});

describe('lodgingTaxPerPersonNight（1人1泊の宿泊税）', () => {
  it.each([
    [4999, 0],
    [5000, 200],
    [5001, 200],
    [19999, 200],
    [20000, 500],
    [20001, 500],
  ])('[6.16] 税抜 %i 円 → %i 円（TC-PR-132〜137 の境目）', (exclTax, expected) => {
    expect(lodgingTaxPerPersonNight({ numerator: exclTax, denominator: 1 }, 0, BRACKETS_V1)).toBe(
      expected,
    );
  });

  it('[6.16] TC-PR-138 切り捨て前の税抜単価を整数で比べる（5,263×9,500＝49,998,500 ＜ 5,000×10,000。4,999.85 を 5,000 に丸めない）', () => {
    expect(lodgingTaxPerPersonNight({ numerator: 5263, denominator: 1 }, -500, BRACKETS_V1)).toBe(
      0,
    );
  });

  it('[6.16] 子どもの単価のもとの 0.5円の端数も保って比べる（4,999.5 → 0円、5,000 → 200円）', () => {
    expect(lodgingTaxPerPersonNight({ numerator: 9999, denominator: 2 }, 0, BRACKETS_V1)).toBe(0);
    expect(lodgingTaxPerPersonNight({ numerator: 10000, denominator: 2 }, 0, BRACKETS_V1)).toBe(
      200,
    );
  });

  it('[6.16] 割増・割引を適用した後の税抜単価で判定する（TC-PR-142：18,000×12,000÷10,000＝21,600 → 500円）', () => {
    expect(lodgingTaxPerPersonNight({ numerator: 18000, denominator: 1 }, 2000, BRACKETS_V1)).toBe(
      500,
    );
  });

  it('[6.16] 幼児（単価のもと 0円）は免税点未満で 0円', () => {
    expect(lodgingTaxPerPersonNight({ numerator: 0, denominator: 1 }, 0, BRACKETS_V1)).toBe(0);
  });

  it('[6.16] 区分の並び順によらず、当てはまる区分のうち下限が最も高いものを使う', () => {
    const reversed = [...BRACKETS_V1].reverse();
    expect(lodgingTaxPerPersonNight({ numerator: 21600, denominator: 1 }, 0, reversed)).toBe(500);
    expect(lodgingTaxPerPersonNight({ numerator: 6000, denominator: 1 }, 0, reversed)).toBe(200);
  });

  it('[6.16] どの区分にも当てはまらなければ 0円', () => {
    const withoutZeroBracket = BRACKETS_V1.slice(1);
    expect(
      lodgingTaxPerPersonNight({ numerator: 4999, denominator: 1 }, 0, withoutZeroBracket),
    ).toBe(0);
  });
});
