// 早期割の率（design.md P-01 手順1）。対象かどうかは夜の控え（NightSnapshot.earlyBirdEligible）で受け取る。
import { describe, expect, it } from 'vitest';
import { earlyBirdDiscountBp } from './early-bird.js';

describe('earlyBirdDiscountBp', () => {
  it('[6.12] 早期割の対象なら、その版の早期割の率を返す', () => {
    expect(earlyBirdDiscountBp(true, { earlyBirdBp: 1000 })).toBe(1000);
    expect(earlyBirdDiscountBp(true, { earlyBirdBp: 500 })).toBe(500);
  });

  it('[6.12] 早期割の対象でなければ 0 を返す', () => {
    expect(earlyBirdDiscountBp(false, { earlyBirdBp: 1000 })).toBe(0);
  });
});
