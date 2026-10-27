// 料金の計算（design.md PriceCalculator、P-01、設計の補足 L-34・L-45）。
// テストケースは test-cases/01-pricing.md の 2.5〜2.14 と 2.18 の PriceCalculator の部分。見積もり（API）のケースは、
// 前提条件から決まる夜の控え（割増・早期割の対象）を入力で渡して、計算の部分だけを確かめる（API の確認は 5.1）。
import type { AgeCategory, GuestCounts } from '@hotel/contracts';
import { describe, expect, it } from 'vitest';
import { addDays } from '../calendar/business-date.js';
import {
  calculatePrice,
  judgedHeadcount,
  priceCalculator,
  PricingValidationError,
} from './price-calculator.js';
import type {
  AddedLaterItem,
  NightSnapshot,
  PricedLine,
  PricedLineCategory,
  PriceInput,
  RateVersionValues,
} from './types.js';

/** 初期データの料金の版1（test-cases/01-pricing.md 共通前提） */
const VERSION_1: RateVersionValues = {
  headcountTiers: [
    { minPersons: 2, discountBp: 500 },
    { minPersons: 4, discountBp: 1000 },
    { minPersons: 10, discountBp: 1500 },
  ],
  stayTiers: [
    { minNights: 2, discountBp: 1000 },
    { minNights: 5, discountBp: 2000 },
  ],
  earlyBirdBp: 1000,
  rateFloorBp: -5000,
  consumptionTaxBp: 1000,
  breakfastPriceExclTax: 3500,
  offHoursPricePerHourInclTax: 1000,
  lodgingTaxBrackets: [
    { minExclTax: 0, taxPerPersonNight: 0 },
    { minExclTax: 5000, taxPerPersonNight: 200 },
    { minExclTax: 20000, taxPerPersonNight: 500 },
  ],
};

/** 版1 の基本料金（税抜・大人1人） */
const BASE_PRICE = {
  STANDARD: 15000,
  DELUXE: 18000,
  PREMIUM: 23000,
  SUITE: 40000,
  KANAZAWA_SUITE: 70000,
} as const;

const guests = (adults: number, children = 0, infants = 0): GuestCounts => ({
  adults,
  children,
  infants,
});

/** 夜の控え（記載がなければ 版1・スタンダード・割増0・早期割の対象外） */
function night(stayDate: string, options: Partial<Omit<NightSnapshot, 'stayDate'>> = {}) {
  return {
    stayDate,
    rateVersion: VERSION_1,
    basePrice: BASE_PRICE.STANDARD,
    surchargeBp: 0,
    earlyBirdEligible: false,
    ...options,
  } satisfies NightSnapshot;
}

/** 到着日から count 泊の夜の控え（どの夜も同じ条件） */
function consecutiveNights(
  arrivalDate: string,
  count: number,
  options: Partial<Omit<NightSnapshot, 'stayDate'>> = {},
): NightSnapshot[] {
  return Array.from({ length: count }, (_, i) => night(addDays(arrivalDate, i), options));
}

/** 料金の入力（記載がなければ 2026-11-12（木）1泊・大人1・1室・朝食なし・時間外なし） */
function priceInput(overrides: Partial<PriceInput> = {}): PriceInput {
  return {
    nights: [night('2026-11-12')],
    counts: guests(1),
    roomCount: 1,
    standardOccupancyPerRoom: 2,
    breakfastCounts: guests(0),
    offHours: [],
    ...overrides,
  };
}

function linesOf(
  lines: readonly PricedLine[],
  category: PricedLineCategory,
  filter: { stayDate?: string; ageCategory?: AgeCategory } = {},
): PricedLine[] {
  return lines.filter(
    (line) =>
      line.category === category &&
      (filter.stayDate === undefined || line.stayDate === filter.stayDate) &&
      (filter.ageCategory === undefined || line.ageCategory === filter.ageCategory),
  );
}

/** もとからの人（後から加えた分を除く）の明細の単価。該当する明細がちょうど1行であることも確かめる */
function unitPriceOf(
  lines: readonly PricedLine[],
  category: PricedLineCategory,
  stayDate: string,
  ageCategory: AgeCategory = 'ADULT',
): number {
  const matched = linesOf(lines, category, { stayDate, ageCategory }).filter(
    (line) => line.addedLaterIndex === undefined,
  );
  expect(matched).toHaveLength(1);
  return matched[0]!.unitPriceInclTax;
}

function totalOf(lines: readonly PricedLine[], category: PricedLineCategory): number {
  return linesOf(lines, category).reduce((sum, line) => sum + line.amountInclTax, 0);
}

describe('judgedHeadcount（人数割の判定人数）', () => {
  it.each([
    ['TC-PR-078', guests(2), 1, 2],
    ['TC-PR-079', guests(10), 10, 0],
    ['TC-PR-080', guests(10), 5, 10],
    ['TC-PR-081', guests(1), 1, 0],
    ['TC-PR-082', guests(2, 0, 2), 1, 4],
    ['TC-PR-083', guests(3), 2, 2],
    ['TC-PR-084', guests(11), 6, 10],
  ])('[6.10] %s 人数 %o・%i室 → %i', (_id, counts, roomCount, expected) => {
    expect(judgedHeadcount(counts, roomCount, 2)).toBe(expected);
    expect(priceCalculator.judgedHeadcount(counts, roomCount, 2)).toBe(expected);
  });

  it('[6.10] 宿泊人数には幼児を含む全員を数える（大人2・子ども1・幼児1、1室 → 4）', () => {
    expect(judgedHeadcount(guests(2, 1, 1), 1, 2)).toBe(4);
  });

  it('[6.10] 人数・室数・基準人数が整数でなければ受け付けない', () => {
    expect(() => judgedHeadcount(guests(1.5), 1, 2)).toThrow(RangeError);
    expect(() => judgedHeadcount(guests(2), 0, 2)).toThrow(RangeError);
    expect(() => judgedHeadcount(guests(2), 1, 0)).toThrow(RangeError);
  });
});

describe('宿泊料金：基本料金と年齢区分（6.1、6.2）', () => {
  it.each([
    ['TC-PR-052', 'スタンダード', BASE_PRICE.STANDARD, 16500],
    ['TC-PR-053', 'デラックス', BASE_PRICE.DELUXE, 19800],
    ['TC-PR-054', 'プレミアム', BASE_PRICE.PREMIUM, 25300],
    ['TC-PR-055', 'スイート', BASE_PRICE.SUITE, 44000],
    ['TC-PR-056', '金沢スイート', BASE_PRICE.KANAZAWA_SUITE, 77000],
  ])(
    '[6.1][6.13] %s %s：大人1・1室・木曜1泊の大人単価は %i → %i 円',
    (_id, _type, basePrice, expected) => {
      const lines = calculatePrice(priceInput({ nights: [night('2026-11-12', { basePrice })] }));
      expect(unitPriceOf(lines, 'ROOM', '2026-11-12')).toBe(expected);
    },
  );

  describe('大人2・子ども1・幼児1・1室、木曜1泊（判定人数4 → −1000bp）', () => {
    const lines = calculatePrice(priceInput({ counts: guests(2, 1, 1) }));

    it('[6.2] TC-PR-057 子どもの単価は基本料金の半額から計算する（⌊7,500×9,000×11÷10^7⌋＝74 → 7,400円）', () => {
      expect(unitPriceOf(lines, 'ROOM', '2026-11-12', 'CHILD')).toBe(7400);
    });

    it('[6.2] TC-PR-058 幼児の単価は0円', () => {
      expect(linesOf(lines, 'ROOM', { ageCategory: 'INFANT' })).toEqual([
        {
          category: 'ROOM',
          stayDate: '2026-11-12',
          ageCategory: 'INFANT',
          quantity: 1,
          unitPriceInclTax: 0,
          amountInclTax: 0,
          settlement: 'PREPAID_ELIGIBLE',
        },
      ]);
    });

    it('[6.1][6.2] TC-PR-059 宿泊料金の合計は 37,000円（大人 14,800×2＋子ども 7,400＋幼児 0）', () => {
      expect(unitPriceOf(lines, 'ROOM', '2026-11-12', 'ADULT')).toBe(14800);
      expect(totalOf(lines, 'ROOM')).toBe(37000);
    });
  });

  it('[6.2] TC-PR-060 基本料金が奇数でも、子どもの単価のもとの 0.5円を保って計算する（8,700円）', () => {
    const nights = [
      night('2026-11-14', { basePrice: 15065, surchargeBp: 2000 }),
      night('2026-11-15', { basePrice: 15065 }),
    ];
    const lines = calculatePrice(priceInput({ nights, counts: guests(1, 1) }));
    expect(unitPriceOf(lines, 'ROOM', '2026-11-14', 'CHILD')).toBe(8700);
  });
});

describe('宿泊料金：率の合算と下限（6.4、6.5）', () => {
  it('[6.4] TC-PR-068・069 の計算：率は掛け合わせずに合算する（土 −500bp → 15,600円、日 −2500bp → 12,300円、合計 55,800円）', () => {
    const nights = [
      night('2027-02-13', { surchargeBp: 2000, earlyBirdEligible: true }),
      night('2027-02-14', { earlyBirdEligible: true }),
    ];
    const lines = calculatePrice(priceInput({ nights, counts: guests(2) }));
    expect(unitPriceOf(lines, 'ROOM', '2027-02-13')).toBe(15600);
    expect(unitPriceOf(lines, 'ROOM', '2027-02-14')).toBe(12300);
    expect(totalOf(lines, 'ROOM')).toBe(55800);
  });

  it.each([
    ['TC-PR-070', 1400, 8400, '−4900bp は下限より上なのでそのまま'],
    ['TC-PR-071', 1500, 8200, '−5000bp は下限ちょうど'],
    ['TC-PR-072', 1600, 8200, '−5100bp を −5000bp にする（下限をかけないと 8,000円）'],
  ])(
    '[6.5] %s 早期割 %ibp・大人10・5室・5泊の大人単価は %i 円（%s）',
    (_id, earlyBirdBp, expected) => {
      const rateVersion = { ...VERSION_1, earlyBirdBp };
      const nights = consecutiveNights('2026-11-15', 5, { rateVersion, earlyBirdEligible: true });
      const lines = calculatePrice(priceInput({ nights, counts: guests(10), roomCount: 5 }));
      for (const { stayDate } of nights) {
        expect(unitPriceOf(lines, 'ROOM', stayDate)).toBe(expected);
      }
    },
  );

  it('[6.4][6.5] TC-PR-073 割増を含めて合算してから下限をかける（＋2000−1500−2000−3500＝−5000 → 8,200円。11,500円ではない）', () => {
    const rateVersion = { ...VERSION_1, earlyBirdBp: 3500 };
    const nights = consecutiveNights('2026-11-15', 5, { rateVersion, earlyBirdEligible: true });
    nights[0] = { ...nights[0]!, surchargeBp: 2000 };
    const lines = calculatePrice(priceInput({ nights, counts: guests(10), roomCount: 5 }));
    expect(unitPriceOf(lines, 'ROOM', '2026-11-15')).toBe(8200);
  });

  it('[6.4] TC-PR-074・075 の計算：夜の控えの割増（＋2000bp）をかける（19,800円）', () => {
    const lines = calculatePrice(
      priceInput({ nights: [night('2026-11-13', { surchargeBp: 2000 })] }),
    );
    expect(unitPriceOf(lines, 'ROOM', '2026-11-13')).toBe(19800);
  });

  it('[6.5] 下限はその夜の控えの版の値を使う', () => {
    const rateVersion = { ...VERSION_1, rateFloorBp: -4000, earlyBirdBp: 3000 };
    const nights = consecutiveNights('2026-11-15', 5, { rateVersion, earlyBirdEligible: true });
    const lines = calculatePrice(priceInput({ nights, counts: guests(10), roomCount: 5 }));
    // −1500−2000−3000＝−6500 → 版の下限 −4000：⌊15,000×6,000×11÷10^7⌋＝99
    expect(unitPriceOf(lines, 'ROOM', '2026-11-15')).toBe(9900);
  });
});

describe('宿泊料金：人数割と判定人数（6.9、6.10）', () => {
  it.each([
    ['TC-PR-085', 1, guests(1), 1, 16500, '判定人数1 → 0%'],
    ['TC-PR-086', 2, guests(2), 1, 15600, '判定人数2 → −500'],
    ['TC-PR-087', 2, guests(3), 1, 15600, '判定人数3 → −500'],
    ['TC-PR-088', 2, guests(4), 2, 14800, '判定人数4 → −1000'],
    ['TC-PR-089', 2, guests(9), 4, 14800, '判定人数9 → −1000'],
    ['TC-PR-090', 2, guests(10), 5, 14000, '判定人数10 → −1500'],
    ['TC-PR-091', 2, guests(4), 4, 16500, '判定人数0 → 0%'],
  ])(
    '[6.9][6.10] %s 基準人数 %i・人数 %o・%i室の大人単価は %i 円（%s）',
    (_id, standardOccupancyPerRoom, counts, roomCount, expected) => {
      const lines = calculatePrice(priceInput({ counts, roomCount, standardOccupancyPerRoom }));
      expect(unitPriceOf(lines, 'ROOM', '2026-11-12')).toBe(expected);
    },
  );
});

describe('宿泊料金：連泊割・早期割（6.11、6.12）', () => {
  it.each([
    ['TC-PR-092', 2, 14800],
    ['TC-PR-093', 4, 14800],
    ['TC-PR-094', 5, 13200],
  ])('[6.11] %s 大人1・1室・%i泊の各夜の大人単価は %i 円', (_id, nightCount, expected) => {
    const nights = consecutiveNights('2026-11-15', nightCount);
    const lines = calculatePrice(priceInput({ nights }));
    for (const { stayDate } of nights) {
      expect(unitPriceOf(lines, 'ROOM', stayDate)).toBe(expected);
    }
  });

  it.each([
    ['TC-PR-095', night('2027-02-15', { earlyBirdEligible: true }), 14800],
    ['TC-PR-096', night('2027-02-10', { earlyBirdEligible: true, surchargeBp: 2000 }), 18100],
    ['TC-PR-097', night('2027-02-09', { earlyBirdEligible: false }), 16500],
  ])('[6.12] %s の計算：夜の控えの早期割の対象に従う（%o → %i 円）', (_id, snapshot, expected) => {
    const lines = calculatePrice(priceInput({ nights: [snapshot] }));
    expect(unitPriceOf(lines, 'ROOM', snapshot.stayDate)).toBe(expected);
  });

  describe('夜ごとに版が違う控え（1夜目 版1：連泊割 2泊 1000bp、2夜目 仮の版2：連泊割 2泊 1500bp）', () => {
    const version2 = {
      ...VERSION_1,
      stayTiers: [
        { minNights: 2, discountBp: 1500 },
        { minNights: 5, discountBp: 2000 },
      ],
    };
    const nights = [night('2026-11-16'), night('2026-11-17', { rateVersion: version2 })];
    const lines = calculatePrice(priceInput({ nights }));

    it('[6.11] TC-PR-191 1夜目は、その夜の控えの版の率 −1000 を使う（14,800円）', () => {
      expect(unitPriceOf(lines, 'ROOM', '2026-11-16')).toBe(14800);
    });

    it('[6.11] TC-PR-192 2夜目は、その夜の控えの版の率 −1500 を使う（14,000円）', () => {
      expect(unitPriceOf(lines, 'ROOM', '2026-11-17')).toBe(14000);
    });
  });
});

describe('宿泊料金：税込み単価の切り捨てと整数計算（6.13）', () => {
  it('[6.13] TC-PR-099 税込み単価を先に 15,600円に切り捨ててから人数をかける（31,200円。31,300円ではない）', () => {
    const lines = calculatePrice(priceInput({ counts: guests(2) }));
    expect(linesOf(lines, 'ROOM')).toEqual([
      {
        category: 'ROOM',
        stayDate: '2026-11-12',
        ageCategory: 'ADULT',
        quantity: 2,
        unitPriceInclTax: 15600,
        amountInclTax: 31200,
        settlement: 'PREPAID_ELIGIBLE',
      },
    ]);
  });

  it('[6.13] TC-PR-100 スイート・大人4・1室・5泊の各夜の大人単価は 30,800円（小数で計算すると 30,700円に誤る）', () => {
    const nights = consecutiveNights('2026-11-15', 5, { basePrice: BASE_PRICE.SUITE });
    const lines = calculatePrice(priceInput({ nights, counts: guests(4) }));
    for (const { stayDate } of nights) {
      expect(unitPriceOf(lines, 'ROOM', stayDate)).toBe(30800);
    }
  });
});

describe('要件の計算例（6.19）', () => {
  // 仮の版（基本料金 18,700円、早期割 500bp、朝食 3,000円。他は版1と同じ）。土曜（割増 2000bp）・早期割の対象。
  // 大人2・子ども1・幼児1、1室、1泊、朝食 大人2・子ども1・幼児1
  const exampleVersion = { ...VERSION_1, earlyBirdBp: 500, breakfastPriceExclTax: 3000 };
  const lines = calculatePrice(
    priceInput({
      nights: [
        night('2026-11-14', {
          rateVersion: exampleVersion,
          basePrice: 18700,
          surchargeBp: 2000,
          earlyBirdEligible: true,
        }),
      ],
      counts: guests(2, 1, 1),
      breakfastCounts: guests(2, 1, 1),
    }),
  );

  it('[6.19][6.4] TC-PR-101 大人の単価は 21,500円', () => {
    expect(unitPriceOf(lines, 'ROOM', '2026-11-14', 'ADULT')).toBe(21500);
  });

  it('[6.19][6.2] TC-PR-102 子どもの単価は 10,700円', () => {
    expect(unitPriceOf(lines, 'ROOM', '2026-11-14', 'CHILD')).toBe(10700);
  });

  it('[6.19][6.14] TC-PR-103 朝食の大人単価は 3,300円（率をかけない）', () => {
    expect(unitPriceOf(lines, 'BREAKFAST', '2026-11-14', 'ADULT')).toBe(3300);
  });

  it('[6.19][6.14] TC-PR-104 朝食の子ども単価は 1,600円', () => {
    expect(unitPriceOf(lines, 'BREAKFAST', '2026-11-14', 'CHILD')).toBe(1600);
  });

  it('[6.19] TC-PR-105 宿泊税を除く合計は 61,900円', () => {
    const total = lines
      .filter((line) => line.category !== 'LODGING_TAX')
      .reduce((sum, line) => sum + line.amountInclTax, 0);
    expect(total).toBe(61900);
  });

  it('[6.19][6.16] TC-PR-106 宿泊税は 600円（大人200円×2、子ども200円、幼児0円）', () => {
    expect(totalOf(lines, 'LODGING_TAX')).toBe(600);
  });

  it('[6.19] 明細は夜×年齢区分ごとに、宿泊料金・朝食・宿泊税の順に並ぶ', () => {
    const line = (
      category: PricedLineCategory,
      ageCategory: AgeCategory,
      quantity: number,
      unitPriceInclTax: number,
    ): PricedLine => ({
      category,
      stayDate: '2026-11-14',
      ageCategory,
      quantity,
      unitPriceInclTax,
      amountInclTax: unitPriceInclTax * quantity,
      settlement: 'PREPAID_ELIGIBLE',
    });
    expect(lines).toEqual([
      line('ROOM', 'ADULT', 2, 21500),
      line('ROOM', 'CHILD', 1, 10700),
      line('ROOM', 'INFANT', 1, 0),
      line('BREAKFAST', 'ADULT', 2, 3300),
      line('BREAKFAST', 'CHILD', 1, 1600),
      line('BREAKFAST', 'INFANT', 1, 0),
      line('LODGING_TAX', 'ADULT', 2, 200),
      line('LODGING_TAX', 'CHILD', 1, 200),
      line('LODGING_TAX', 'INFANT', 1, 0),
    ]);
  });
});

describe('朝食（4.10、6.14）', () => {
  it('[6.14] TC-PR-107 朝食の大人単価は 3,800円', () => {
    const lines = calculatePrice(priceInput({ breakfastCounts: guests(1) }));
    expect(unitPriceOf(lines, 'BREAKFAST', '2026-11-12', 'ADULT')).toBe(3800);
  });

  it('[6.14] TC-PR-108 朝食の子ども単価は半額の 1,750円から 1,900円', () => {
    const lines = calculatePrice(
      priceInput({ counts: guests(1, 1), breakfastCounts: guests(0, 1) }),
    );
    expect(unitPriceOf(lines, 'BREAKFAST', '2026-11-12', 'CHILD')).toBe(1900);
  });

  it('[6.14] TC-PR-109 朝食の幼児単価は 0円', () => {
    const lines = calculatePrice(
      priceInput({ counts: guests(1, 0, 1), breakfastCounts: guests(0, 0, 1) }),
    );
    expect(unitPriceOf(lines, 'BREAKFAST', '2026-11-12', 'INFANT')).toBe(0);
  });

  it('[6.14] TC-PR-110 朝食にはその夜の割増・割引の率をかけない（各夜 3,800円）', () => {
    const nights = [
      night('2027-02-13', { surchargeBp: 2000, earlyBirdEligible: true }),
      night('2027-02-14', { earlyBirdEligible: true }),
    ];
    const lines = calculatePrice(
      priceInput({ nights, counts: guests(2), breakfastCounts: guests(2) }),
    );
    expect(unitPriceOf(lines, 'BREAKFAST', '2027-02-13')).toBe(3800);
    expect(unitPriceOf(lines, 'BREAKFAST', '2027-02-14')).toBe(3800);
  });

  it('[4.10][6.14] TC-PR-111 区分ごとの朝食の人数を全泊に同じ人数で適用する（19,000円）', () => {
    const nights = [night('2026-11-16'), night('2026-11-17')];
    const lines = calculatePrice(
      priceInput({ nights, counts: guests(2, 1, 1), breakfastCounts: guests(2, 1, 1) }),
    );
    expect(totalOf(lines, 'BREAKFAST')).toBe(19000);
    for (const { stayDate } of nights) {
      expect(
        linesOf(lines, 'BREAKFAST', { stayDate }).map((line) => [line.ageCategory, line.quantity]),
      ).toEqual([
        ['ADULT', 2],
        ['CHILD', 1],
        ['INFANT', 1],
      ]);
    }
  });

  it('[4.10][6.14] TC-PR-112 朝食をつけない人の分はかからない（大人2のうち1名だけ → 3,800円）', () => {
    const lines = calculatePrice(priceInput({ counts: guests(2), breakfastCounts: guests(1) }));
    expect(totalOf(lines, 'BREAKFAST')).toBe(3800);
  });

  it('[6.14] TC-PR-113 朝食の人数が0なら、朝食の明細はない（0円）', () => {
    const lines = calculatePrice(priceInput({ counts: guests(2), breakfastCounts: guests(0) }));
    expect(linesOf(lines, 'BREAKFAST')).toEqual([]);
    expect(totalOf(lines, 'BREAKFAST')).toBe(0);
  });

  it.each([
    ['TC-PR-114', guests(2), guests(3), 'ADULT'],
    ['TC-PR-115', guests(2, 0), guests(0, 1), 'CHILD'],
  ])(
    '[4.10][6.14] %s 朝食の人数が区分の人数を超えたら VALIDATION_FAILED',
    (_id, counts, breakfastCounts, ageCategory) => {
      const run = () => calculatePrice(priceInput({ counts, breakfastCounts }));
      expect(run).toThrow(PricingValidationError);
      try {
        run();
      } catch (error) {
        expect(error).toBeInstanceOf(PricingValidationError);
        expect((error as PricingValidationError).code).toBe('VALIDATION_FAILED');
        expect((error as PricingValidationError).details).toMatchObject({ ageCategory });
      }
    },
  );

  it('[6.14] TC-PR-116 朝食の明細は事前決済に含められる（PREPAID_ELIGIBLE）', () => {
    const lines = calculatePrice(priceInput({ counts: guests(2), breakfastCounts: guests(2) }));
    const breakfast = linesOf(lines, 'BREAKFAST');
    expect(breakfast).not.toHaveLength(0);
    expect(breakfast.every((line) => line.settlement === 'PREPAID_ELIGIBLE')).toBe(true);
  });
});

describe('時間外（6.15、11.5）', () => {
  it.each([
    [
      'TC-PR-117',
      { earlyCheckinHour: 12 as const, earlyCheckinRate: VERSION_1 },
      'EARLY_CHECKIN',
      3,
    ],
    [
      'TC-PR-118',
      { earlyCheckinHour: 13 as const, earlyCheckinRate: VERSION_1 },
      'EARLY_CHECKIN',
      2,
    ],
    [
      'TC-PR-119',
      { earlyCheckinHour: 14 as const, earlyCheckinRate: VERSION_1 },
      'EARLY_CHECKIN',
      1,
    ],
    [
      'TC-PR-120',
      { lateCheckoutHour: 13 as const, lateCheckoutRate: VERSION_1 },
      'LATE_CHECKOUT',
      1,
    ],
    [
      'TC-PR-121',
      { lateCheckoutHour: 14 as const, lateCheckoutRate: VERSION_1 },
      'LATE_CHECKOUT',
      2,
    ],
    [
      'TC-PR-122',
      { lateCheckoutHour: 15 as const, lateCheckoutRate: VERSION_1 },
      'LATE_CHECKOUT',
      3,
    ],
  ] as const)('[6.15] %s %o → %s %i時間×1,000円', (_id, selection, category, hours) => {
    const lines = calculatePrice(priceInput({ offHours: [selection] }));
    expect(linesOf(lines, category)).toEqual([
      {
        category,
        quantity: hours,
        unitPriceInclTax: 1000,
        amountInclTax: hours * 1000,
        settlement: 'ONSITE_ONLY',
        roomIndex: 0,
      },
    ]);
  });

  it('[6.15] TC-PR-123 部屋ごとに計算する（12:00・14:00・なし → 4,000円）', () => {
    const lines = calculatePrice(
      priceInput({
        counts: guests(3),
        roomCount: 3,
        offHours: [
          { earlyCheckinHour: 12, earlyCheckinRate: VERSION_1 },
          { earlyCheckinHour: 14, earlyCheckinRate: VERSION_1 },
          {},
        ],
      }),
    );
    expect(totalOf(lines, 'EARLY_CHECKIN')).toBe(4000);
    expect(
      linesOf(lines, 'EARLY_CHECKIN').map((line) => [line.roomIndex, line.amountInclTax]),
    ).toEqual([
      [0, 3000],
      [1, 1000],
    ]);
  });

  it('[6.15] TC-PR-124 人数を掛けない（大人3・1室、アーリー 12:00 → 3,000円）', () => {
    const lines = calculatePrice(
      priceInput({
        counts: guests(3),
        offHours: [{ earlyCheckinHour: 12, earlyCheckinRate: VERSION_1 }],
      }),
    );
    expect(totalOf(lines, 'EARLY_CHECKIN')).toBe(3000);
  });

  it('[6.15] TC-PR-125 泊数を掛けない（3泊、レイト 15:00 → 3,000円の1回分）', () => {
    const lines = calculatePrice(
      priceInput({
        nights: consecutiveNights('2026-11-15', 3),
        offHours: [{ lateCheckoutHour: 15, lateCheckoutRate: VERSION_1 }],
      }),
    );
    expect(linesOf(lines, 'LATE_CHECKOUT')).toHaveLength(1);
    expect(totalOf(lines, 'LATE_CHECKOUT')).toBe(3000);
  });

  it('[6.15] TC-PR-126 割増・人数割・連泊割・早期割の率をかけない（アーリー 13:00 → 2,000円）', () => {
    const nights = [
      night('2027-02-13', { surchargeBp: 2000, earlyBirdEligible: true }),
      night('2027-02-14', { earlyBirdEligible: true }),
    ];
    const lines = calculatePrice(
      priceInput({
        nights,
        counts: guests(2),
        offHours: [{ earlyCheckinHour: 13, earlyCheckinRate: VERSION_1 }],
      }),
    );
    expect(totalOf(lines, 'EARLY_CHECKIN')).toBe(2000);
  });

  it('[6.15][11.5] TC-PR-127 時間外の明細は常に現地で精算する（ONSITE_ONLY）', () => {
    const lines = calculatePrice(
      priceInput({
        offHours: [
          {
            earlyCheckinHour: 12,
            earlyCheckinRate: VERSION_1,
            lateCheckoutHour: 15,
            lateCheckoutRate: VERSION_1,
          },
        ],
      }),
    );
    const offHours = lines.filter(
      (line) => line.category === 'EARLY_CHECKIN' || line.category === 'LATE_CHECKOUT',
    );
    expect(offHours).toHaveLength(2);
    expect(offHours.every((line) => line.settlement === 'ONSITE_ONLY')).toBe(true);
    expect(
      lines
        .filter((line) => !offHours.includes(line))
        .every((line) => line.settlement === 'PREPAID_ELIGIBLE'),
    ).toBe(true);
  });

  describe('時間外の料金の版（設計の補足 L-34）', () => {
    const version2 = { ...VERSION_1, offHoursPricePerHourInclTax: 1500 };

    it('[6.15] TC-PR-193 選んだ時点の版（版1）で計算し、後から足した夜の控えの版2 を使わない（3,000円）', () => {
      const lines = calculatePrice(
        priceInput({
          nights: [night('2026-11-16'), night('2026-11-17', { rateVersion: version2 })],
          offHours: [{ earlyCheckinHour: 12, earlyCheckinRate: VERSION_1 }],
        }),
      );
      expect(totalOf(lines, 'EARLY_CHECKIN')).toBe(3000);
    });

    it('[6.15] TC-PR-199 アーリーとレイトは、それぞれの入力の版で計算する（アーリー 版2 4,500円、レイト 版1 2,000円）', () => {
      const lines = calculatePrice(
        priceInput({
          nights: [night('2026-11-16'), night('2026-11-17')],
          offHours: [
            {
              earlyCheckinHour: 12,
              earlyCheckinRate: version2,
              lateCheckoutHour: 14,
              lateCheckoutRate: VERSION_1,
            },
          ],
        }),
      );
      expect(linesOf(lines, 'EARLY_CHECKIN')).toEqual([
        {
          category: 'EARLY_CHECKIN',
          quantity: 3,
          unitPriceInclTax: 1500,
          amountInclTax: 4500,
          settlement: 'ONSITE_ONLY',
          roomIndex: 0,
        },
      ]);
      expect(linesOf(lines, 'LATE_CHECKOUT')).toEqual([
        {
          category: 'LATE_CHECKOUT',
          quantity: 2,
          unitPriceInclTax: 1000,
          amountInclTax: 2000,
          settlement: 'ONSITE_ONLY',
          roomIndex: 0,
        },
      ]);
    });
  });

  it('[6.15] 時刻だけで、選んだ時点の料金の版がない入力は受け付けない', () => {
    expect(() => calculatePrice(priceInput({ offHours: [{ earlyCheckinHour: 12 }] }))).toThrow(
      RangeError,
    );
    expect(() => calculatePrice(priceInput({ offHours: [{ lateCheckoutHour: 15 }] }))).toThrow(
      RangeError,
    );
  });

  it('[4.10] 選択肢にない時刻（アーリー 12・13・14時、レイト 13・14・15時以外）は受け付けない', () => {
    const early = { earlyCheckinHour: 11, earlyCheckinRate: VERSION_1 } as unknown as never;
    const late = { lateCheckoutHour: 12, lateCheckoutRate: VERSION_1 } as unknown as never;
    expect(() => calculatePrice(priceInput({ offHours: [early] }))).toThrow(RangeError);
    expect(() => calculatePrice(priceInput({ offHours: [late] }))).toThrow(RangeError);
  });

  it('[6.15] 室数より多い部屋の時間外は受け付けない', () => {
    expect(() => calculatePrice(priceInput({ roomCount: 1, offHours: [{}, {}] }))).toThrow(
      RangeError,
    );
  });
});

describe('宿泊税（6.16）', () => {
  it.each([
    ['TC-PR-132', 4999, 0],
    ['TC-PR-133', 5000, 200],
    ['TC-PR-134', 5001, 200],
    ['TC-PR-135', 19999, 200],
    ['TC-PR-136', 20000, 500],
    ['TC-PR-137', 20001, 500],
  ])('[6.16] %s 仮の基本料金 %i 円（率0）の宿泊税は %i 円', (_id, basePrice, expected) => {
    const lines = calculatePrice(priceInput({ nights: [night('2026-11-12', { basePrice })] }));
    expect(totalOf(lines, 'LODGING_TAX')).toBe(expected);
  });

  it('[6.16] TC-PR-138 切り捨て前の税抜単価を整数で比べる（5,263円・率 −500 → 4,999.85 なので0円）', () => {
    const lines = calculatePrice(
      priceInput({ nights: [night('2026-11-12', { basePrice: 5263 })], counts: guests(2) }),
    );
    expect(unitPriceOf(lines, 'LODGING_TAX', '2026-11-12')).toBe(0);
  });

  describe('大人2・子ども1・幼児1・1室・2泊（率 −2000）', () => {
    const lines = calculatePrice(
      priceInput({
        nights: [night('2026-11-16'), night('2026-11-17')],
        counts: guests(2, 1, 1),
      }),
    );

    it('[6.16] TC-PR-139 夜×人ごとに判定する（(200×2＋200＋0)×2泊＝1,200円）', () => {
      expect(totalOf(lines, 'LODGING_TAX')).toBe(1200);
    });

    it('[6.16] TC-PR-140 幼児の宿泊税は0円（料金0円のため免税点未満）', () => {
      expect(unitPriceOf(lines, 'LODGING_TAX', '2026-11-16', 'INFANT')).toBe(0);
      expect(unitPriceOf(lines, 'LODGING_TAX', '2026-11-17', 'INFANT')).toBe(0);
    });
  });

  describe('大人5・子ども5・5室・5泊（率 −3500。子どもの税抜 4,875円）', () => {
    const nights = consecutiveNights('2026-11-15', 5);
    const base = { nights, counts: guests(5, 5), roomCount: 5 };

    it('[6.16] TC-PR-141 子ども1人1泊の宿泊税は0円', () => {
      const lines = calculatePrice(priceInput(base));
      for (const { stayDate } of nights) {
        expect(unitPriceOf(lines, 'LODGING_TAX', stayDate, 'CHILD')).toBe(0);
        expect(unitPriceOf(lines, 'LODGING_TAX', stayDate, 'ADULT')).toBe(200);
      }
    });

    it('[6.16] TC-PR-144 朝食の料金を税抜単価に足さない（朝食 子ども5 でも0円）', () => {
      const lines = calculatePrice(priceInput({ ...base, breakfastCounts: guests(0, 5) }));
      for (const { stayDate } of nights) {
        expect(unitPriceOf(lines, 'LODGING_TAX', stayDate, 'CHILD')).toBe(0);
      }
    });

    it('[6.16] TC-PR-145 時間外の料金を含めない（5室すべてレイト 15:00 でも0円）', () => {
      const offHours = Array.from({ length: 5 }, () => ({
        lateCheckoutHour: 15 as const,
        lateCheckoutRate: VERSION_1,
      }));
      const lines = calculatePrice(priceInput({ ...base, offHours }));
      for (const { stayDate } of nights) {
        expect(unitPriceOf(lines, 'LODGING_TAX', stayDate, 'CHILD')).toBe(0);
      }
    });
  });

  it('[6.16] TC-PR-142 割増の後の税抜単価で判定する（デラックス・土曜：21,600円 → 500円）', () => {
    const lines = calculatePrice(
      priceInput({
        nights: [night('2026-11-14', { basePrice: BASE_PRICE.DELUXE, surchargeBp: 2000 })],
      }),
    );
    expect(totalOf(lines, 'LODGING_TAX')).toBe(500);
  });

  it('[6.16] TC-PR-143 割引の後の税抜単価で判定する（プレミアム・大人2・2泊：19,550円 → 200円）', () => {
    const nights = consecutiveNights('2026-11-16', 2, { basePrice: BASE_PRICE.PREMIUM });
    const lines = calculatePrice(priceInput({ nights, counts: guests(2) }));
    expect(unitPriceOf(lines, 'LODGING_TAX', '2026-11-16')).toBe(200);
    expect(unitPriceOf(lines, 'LODGING_TAX', '2026-11-17')).toBe(200);
  });

  it('[6.16] TC-PR-146 宿泊税の明細は事前決済に含められる（PREPAID_ELIGIBLE）', () => {
    const lines = calculatePrice(priceInput());
    expect(linesOf(lines, 'LODGING_TAX')).toEqual([
      {
        category: 'LODGING_TAX',
        stayDate: '2026-11-12',
        ageCategory: 'ADULT',
        quantity: 1,
        unitPriceInclTax: 200,
        amountInclTax: 200,
        settlement: 'PREPAID_ELIGIBLE',
      },
    ]);
  });
});

describe('後から加えた人・朝食（設計の補足 L-45）', () => {
  it('[6.14][7.4] TC-PR-201 後から加えた朝食は、加えた時点の版の単価で計算する（各夜 3,800＋4,400 → 合計 16,400円）', () => {
    const version2 = { ...VERSION_1, breakfastPriceExclTax: 4000 };
    const addedLater: AddedLaterItem[] = [
      {
        stayDate: '2026-11-16',
        kind: 'BREAKFAST',
        ageCategory: 'ADULT',
        quantity: 1,
        rateVersion: version2,
      },
      {
        stayDate: '2026-11-17',
        kind: 'BREAKFAST',
        ageCategory: 'ADULT',
        quantity: 1,
        rateVersion: version2,
      },
    ];
    const lines = calculatePrice(
      priceInput({
        nights: [night('2026-11-16'), night('2026-11-17')],
        counts: guests(2),
        breakfastCounts: guests(2),
        addedLater,
      }),
    );
    expect(linesOf(lines, 'BREAKFAST')).toEqual([
      {
        category: 'BREAKFAST',
        stayDate: '2026-11-16',
        ageCategory: 'ADULT',
        quantity: 1,
        unitPriceInclTax: 3800,
        amountInclTax: 3800,
        settlement: 'PREPAID_ELIGIBLE',
      },
      {
        category: 'BREAKFAST',
        stayDate: '2026-11-16',
        ageCategory: 'ADULT',
        quantity: 1,
        unitPriceInclTax: 4400,
        amountInclTax: 4400,
        settlement: 'PREPAID_ELIGIBLE',
        addedLaterIndex: 0,
      },
      {
        category: 'BREAKFAST',
        stayDate: '2026-11-17',
        ageCategory: 'ADULT',
        quantity: 1,
        unitPriceInclTax: 3800,
        amountInclTax: 3800,
        settlement: 'PREPAID_ELIGIBLE',
      },
      {
        category: 'BREAKFAST',
        stayDate: '2026-11-17',
        ageCategory: 'ADULT',
        quantity: 1,
        unitPriceInclTax: 4400,
        amountInclTax: 4400,
        settlement: 'PREPAID_ELIGIBLE',
        addedLaterIndex: 1,
      },
    ]);
    expect(totalOf(lines, 'BREAKFAST')).toBe(16400);
  });

  it('[7.4][7.5] TC-CH-020 の計算：後から加えた人は加えた時点の版の基本料金で、率はその夜の控えの版と最終的な人数・泊数で計算する', () => {
    // 予約A（版1・大人2・3泊）に、版2（スタンダード 16,000円）の時点で大人1名を加えた
    const version2 = { ...VERSION_1 };
    const nights = consecutiveNights('2026-11-16', 3);
    const addedLater: AddedLaterItem[] = nights.map(({ stayDate }) => ({
      stayDate,
      kind: 'GUEST',
      ageCategory: 'ADULT',
      quantity: 1,
      rateVersion: version2,
      basePrice: 16000,
      earlyBirdEligible: false,
    }));
    const lines = calculatePrice(priceInput({ nights, counts: guests(3), addedLater }));

    nights.forEach(({ stayDate }, index) => {
      // もとの2名：判定人数3 → −500、3泊 → −1000：⌊15,000×8,500×11÷10^7⌋＝140
      // 加えた1名：⌊16,000×8,500×11÷10^7⌋＝149、税抜 13,600 → 宿泊税 200円
      expect(linesOf(lines, 'ROOM', { stayDate })).toEqual([
        {
          category: 'ROOM',
          stayDate,
          ageCategory: 'ADULT',
          quantity: 2,
          unitPriceInclTax: 14000,
          amountInclTax: 28000,
          settlement: 'PREPAID_ELIGIBLE',
        },
        {
          category: 'ROOM',
          stayDate,
          ageCategory: 'ADULT',
          quantity: 1,
          unitPriceInclTax: 14900,
          amountInclTax: 14900,
          settlement: 'PREPAID_ELIGIBLE',
          addedLaterIndex: index,
        },
      ]);
      expect(
        linesOf(lines, 'LODGING_TAX', { stayDate }).map((line) => [
          line.quantity,
          line.unitPriceInclTax,
          line.addedLaterIndex,
        ]),
      ).toEqual([
        [2, 200, undefined],
        [1, 200, index],
      ]);
    });
    // 差額 45,300円 ＝ 新しい合計 130,500円 − もとの合計 85,200円
    expect(totalOf(lines, 'ROOM') + totalOf(lines, 'LODGING_TAX') - 85200).toBe(45300);
  });

  it('[7.8] TC-CH-021 の計算：早期割の夜に加えた人でも、加えた分が早期割の対象でなければ早期割をかけない', () => {
    // 予約E（早期割・大人2・3泊）に、早期割の期限の後で大人1名を加えた
    const nights = consecutiveNights('2026-11-16', 3, { earlyBirdEligible: true });
    const addedLater: AddedLaterItem[] = nights.map(({ stayDate }) => ({
      stayDate,
      kind: 'GUEST',
      ageCategory: 'ADULT',
      quantity: 1,
      rateVersion: VERSION_1,
      basePrice: BASE_PRICE.STANDARD,
      earlyBirdEligible: false,
    }));
    const lines = calculatePrice(priceInput({ nights, counts: guests(3), addedLater }));

    for (const { stayDate } of nights) {
      // もとの2名：−500−1000−1000＝−2500 → 12,300円。加えた1名：−500−1000＝−1500 → 14,000円
      expect(
        linesOf(lines, 'ROOM', { stayDate }).map((line) => [line.quantity, line.unitPriceInclTax]),
      ).toEqual([
        [2, 12300],
        [1, 14000],
      ]);
    }
    // 差額 42,600円 ＝ 新しい合計 117,600円 − もとの合計 75,000円
    expect(totalOf(lines, 'ROOM') + totalOf(lines, 'LODGING_TAX') - 75000).toBe(42600);
  });

  it('[6.12] 加えた分が早期割の対象なら、その夜の控えの版の早期割の率をかける', () => {
    const nights = [night('2026-11-16', { earlyBirdEligible: true })];
    const lines = calculatePrice(
      priceInput({
        nights,
        counts: guests(2),
        addedLater: [
          {
            stayDate: '2026-11-16',
            kind: 'GUEST',
            ageCategory: 'ADULT',
            quantity: 1,
            rateVersion: VERSION_1,
            basePrice: BASE_PRICE.STANDARD,
            earlyBirdEligible: true,
          },
        ],
      }),
    );
    // 判定人数2 → −500、早期割 −1000：⌊15,000×8,500×11÷10^7⌋＝140
    expect(linesOf(lines, 'ROOM').map((line) => [line.quantity, line.unitPriceInclTax])).toEqual([
      [1, 14000],
      [1, 14000],
    ]);
  });

  it('[7.4] もとからの人が全員後から加えた人なら、もとの分の明細を作らない', () => {
    const lines = calculatePrice(
      priceInput({
        counts: guests(1),
        addedLater: [
          {
            stayDate: '2026-11-12',
            kind: 'GUEST',
            ageCategory: 'ADULT',
            quantity: 1,
            rateVersion: VERSION_1,
            basePrice: BASE_PRICE.STANDARD,
            earlyBirdEligible: false,
          },
        ],
      }),
    );
    expect(linesOf(lines, 'ROOM').map((line) => line.addedLaterIndex)).toEqual([0]);
    expect(linesOf(lines, 'LODGING_TAX').map((line) => line.addedLaterIndex)).toEqual([0]);
  });

  it('後から加えた分の夜・人数が入力と合わなければ受け付けない', () => {
    const addedGuest = {
      stayDate: '2026-11-12',
      kind: 'GUEST',
      ageCategory: 'ADULT',
      quantity: 1,
      rateVersion: VERSION_1,
      basePrice: BASE_PRICE.STANDARD,
      earlyBirdEligible: false,
    } as const;
    const addedBreakfast = {
      stayDate: '2026-11-12',
      kind: 'BREAKFAST',
      ageCategory: 'ADULT',
      quantity: 1,
      rateVersion: VERSION_1,
    } as const;
    // 控えにない夜
    expect(() =>
      calculatePrice(priceInput({ addedLater: [{ ...addedGuest, stayDate: '2026-11-13' }] })),
    ).toThrow(RangeError);
    // counts の内数を超える
    expect(() =>
      calculatePrice(priceInput({ counts: guests(1), addedLater: [addedGuest, addedGuest] })),
    ).toThrow(RangeError);
    // breakfastCounts の内数を超える
    expect(() =>
      calculatePrice(priceInput({ breakfastCounts: guests(0), addedLater: [addedBreakfast] })),
    ).toThrow(RangeError);
    // 人数が1以上の整数でない
    expect(() =>
      calculatePrice(priceInput({ addedLater: [{ ...addedGuest, quantity: 0 }] })),
    ).toThrow(RangeError);
  });
});

describe('明細の全体（TC-PR-200 の計算）', () => {
  it('[6.15][6.16] 版1 の夜と版2 の夜の2泊で、時間外は選んだ時点の版1、事前決済の対象は 30,000円', () => {
    const version2 = { ...VERSION_1, offHoursPricePerHourInclTax: 1500 };
    const lines = calculatePrice(
      priceInput({
        nights: [night('2026-11-16'), night('2026-11-17', { rateVersion: version2 })],
        offHours: [{ earlyCheckinHour: 12, earlyCheckinRate: VERSION_1 }],
      }),
    );
    expect(totalOf(lines, 'ROOM')).toBe(29600);
    expect(totalOf(lines, 'LODGING_TAX')).toBe(400);
    expect(totalOf(lines, 'EARLY_CHECKIN')).toBe(3000);
    const prepaidEligible = lines
      .filter((line) => line.settlement === 'PREPAID_ELIGIBLE')
      .reduce((sum, line) => sum + line.amountInclTax, 0);
    expect(prepaidEligible).toBe(30000);
    // 並び順：宿泊料金 → 朝食 → 時間外 → 宿泊税
    expect(lines.map((line) => line.category)).toEqual([
      'ROOM',
      'ROOM',
      'EARLY_CHECKIN',
      'LODGING_TAX',
      'LODGING_TAX',
    ]);
  });
});

describe('入力の検証', () => {
  it('夜が1つもない入力は受け付けない', () => {
    expect(() => calculatePrice(priceInput({ nights: [] }))).toThrow(RangeError);
  });

  it('同じ宿泊日の控えが2つある入力は受け付けない', () => {
    expect(() =>
      calculatePrice(priceInput({ nights: [night('2026-11-12'), night('2026-11-12')] })),
    ).toThrow(RangeError);
  });

  it('宿泊日の形が違う入力は受け付けない', () => {
    expect(() => calculatePrice(priceInput({ nights: [night('2026/11/12')] }))).toThrow(RangeError);
  });

  it('人数・朝食の人数が0以上の整数でない入力は受け付けない', () => {
    expect(() => calculatePrice(priceInput({ counts: guests(-1) }))).toThrow(RangeError);
    expect(() => calculatePrice(priceInput({ breakfastCounts: guests(0, -1) }))).toThrow(
      RangeError,
    );
  });

  it('基本料金が0以上の整数でない入力は受け付けない', () => {
    expect(() =>
      calculatePrice(priceInput({ nights: [night('2026-11-12', { basePrice: 15000.5 })] })),
    ).toThrow(RangeError);
  });
});
