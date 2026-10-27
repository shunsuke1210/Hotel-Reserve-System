// キャンセル料と宿泊税の返金のルール（design.md CancellationPolicy、処理仕様 P-06・P-07 手順3、
// 設計の補足 DT-M21・DT-M23・DT-M25・DT-M42・DT-M44・DT-M51、brief.md PY-17a）。
// テストケースは test-cases/04-change-cancel.md の 2.4・2.5・2.8〜2.11・2.13 と 05-operations.md の TC-OP-293〜296 の
// CancellationPolicy で決まる部分（キャンセル料・返金しない額・宿泊税の返金と付け替え）。保存・決済・メールは 6.x で確かめる。
// 予約の明細は 04 の 2.0 の共通の前提（料金の版1）から PriceCalculator で作る。
import type { AgeCategory, GuestCounts } from '@hotel/contracts';
import { describe, expect, it } from 'vitest';
import { addDays, atJapanTime } from '../calendar/business-date.js';
import { calculatePrice } from '../pricing/price-calculator.js';
import type { NightSnapshot, PricedLine, PriceInput, RateVersionValues } from '../pricing/types.js';
import {
  cancellationPolicy,
  evaluateCancellation,
  evaluateNoShow,
  groupCancellationPercent,
  removedLinesFromPriced,
} from './cancellation-policy.js';
import type {
  CancellationContext,
  CancellationEvaluation,
  NoShowContext,
  RemovalScope,
  RemovedLines,
  RemovedLodgingTaxLine,
  RemovedStayLine,
} from './types.js';

/** 初期データの料金の版1（04 の 2.0） */
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

/** 版1 の基本料金（スタンダード・デラックス） */
const STANDARD = 15000;
const DELUXE = 18000;

const guests = (adults: number, children = 0, infants = 0): GuestCounts => ({
  adults,
  children,
  infants,
});

/** 夜の控え（記載がなければ版1・スタンダード・割増なし・早期割の対象外） */
function night(stayDate: string, options: Partial<Omit<NightSnapshot, 'stayDate'>> = {}) {
  return {
    stayDate,
    rateVersion: VERSION_1,
    basePrice: STANDARD,
    surchargeBp: 0,
    earlyBirdEligible: false,
    ...options,
  } satisfies NightSnapshot;
}

function stay(
  arrivalDate: string,
  count: number,
  options: Partial<Omit<NightSnapshot, 'stayDate'>> = {},
): NightSnapshot[] {
  return Array.from({ length: count }, (_, i) => night(addDays(arrivalDate, i), options));
}

interface Booking {
  input: PriceInput;
  lines: PricedLine[];
}

/** 予約の明細（1室・朝食なし・時間外なしが既定） */
function book(nights: NightSnapshot[], counts: GuestCounts, extra: Partial<PriceInput> = {}) {
  const input: PriceInput = {
    nights,
    counts,
    roomCount: 1,
    standardOccupancyPerRoom: 2,
    breakfastCounts: guests(0),
    offHours: [],
    ...extra,
  };
  return { input, lines: calculatePrice(input) } satisfies Booking;
}

const EB = { earlyBirdEligible: true } as const;

// 04 の 2.0 の予約（夜はすべて 2026年）
/** 予約A：1室・大人2名・夜 11/16〜11/18。ROOM 1泊 28,000円、宿泊税 1泊 400円、支払い済み 85,200円。期限 11/14 15:00 */
const RES_A = book(stay('2026-11-16', 3), guests(2));
/** 予約A3：予約A で大人3名。支払い済み 127,800円 */
const RES_A3 = book(stay('2026-11-16', 3), guests(3));
/** 予約B：2室・大人3名・子ども1名・夜 11/16・11/17。ROOM 1泊 46,200円、支払い済み 94,000円 */
const RES_B = book(stay('2026-11-16', 2), guests(3, 1), { roomCount: 2 });
/** 予約C：1室・大人2名・夜 11/15〜11/18。支払い済み 113,600円。期限 11/13 15:00 */
const RES_C = book(stay('2026-11-15', 4), guests(2));
/** 予約D：3室・大人6名・夜 11/16・11/17。ROOM 1泊 79,200円、支払い済み 160,800円 */
const RES_D = book(stay('2026-11-16', 2), guests(6), { roomCount: 3 });
/** 予約E：予約A を早期割で確定。ROOM 1泊 24,600円、支払い済み 75,000円 */
const RES_E = book(stay('2026-11-16', 3, EB), guests(2));
/** 予約F：夜 11/12 木 14,000円・11/13 金 17,300円・11/14 土 17,300円。支払い済み 98,400円。期限 11/10 15:00 */
const RES_F = book(
  [
    night('2026-11-12'),
    night('2026-11-13', { surchargeBp: 2000 }),
    night('2026-11-14', { surchargeBp: 2000 }),
  ],
  guests(2),
);
/** 予約G：団体・5室・大人10名・夜 11/30〜12/2。ROOM 1泊 123,000円、宿泊税 1泊 2,000円、支払い済み 375,000円 */
const RES_G = book(stay('2026-11-30', 3), guests(10), { roomCount: 5 });
/** 予約I：1室・大人2名・1泊（夜 11/16）。ROOM 31,200円、宿泊税 400円 */
const RES_I = book(stay('2026-11-16', 1), guests(2));
/** TC-CH-046 の変更の後：予約E に 11/19 を早期割なしで追加（11/16〜11/18 は 12,300円、11/19 は 14,000円）。支払い済み 103,400円 */
const RES_E_PLUS_1119 = book([...stay('2026-11-16', 3, EB), night('2026-11-19')], guests(2));
/** TC-CH-050 の変更の後：予約E の到着日を 11/15 に早めた（11/15 は早期割なしの 14,000円）。支払い済み 103,400円 */
const RES_E_PLUS_1115 = book([night('2026-11-15'), ...stay('2026-11-16', 3, EB)], guests(2));

/** 取り消す時刻（日本時間） */
const jst = atJapanTime;
const millisecondBefore = (instant: Date): Date => new Date(instant.getTime() - 1);

/** 事前決済の個人の予約（到着 11/16）の文脈 */
function ctx(at: Date, overrides: Partial<CancellationContext> = {}): CancellationContext {
  return {
    arrivalDate: '2026-11-16',
    isGroup: false,
    earlyBird: false,
    paymentMethod: 'PREPAID',
    at,
    ...overrides,
  };
}

const groupCtx = (at: Date, overrides: Partial<CancellationContext> = {}) =>
  ctx(at, { arrivalDate: '2026-11-30', isGroup: true, ...overrides });

const noShowCtx = (overrides: Partial<NoShowContext> = {}): NoShowContext => ({
  isGroup: false,
  earlyBird: false,
  paymentMethod: 'PREPAID',
  ...overrides,
});

const onNights =
  (...dates: string[]) =>
  (line: PricedLine): boolean =>
    line.stayDate !== undefined && dates.includes(line.stayDate);

/** 予約の明細のうち filter に当たるものを取り消す範囲 */
function scopeOf(
  booking: Booking,
  kind: RemovalScope['kind'],
  filter: (line: PricedLine) => boolean = () => true,
) {
  return {
    kind,
    ...removedLinesFromPriced(booking.lines.filter(filter), booking.input),
  } satisfies RemovalScope<RemovedLodgingTaxLine & { priced: PricedLine }>;
}

/** 年齢区分の quantity 人分の宿泊料金と宿泊税の明細（単価 × 人数。filter に当たる夜だけ） */
function portionsOf(
  booking: Booking,
  ageCategory: AgeCategory,
  quantity: number,
  filter: (line: PricedLine) => boolean = () => true,
): PricedLine[] {
  return booking.lines
    .filter(
      (line) =>
        line.ageCategory === ageCategory &&
        (line.category === 'ROOM' || line.category === 'LODGING_TAX') &&
        filter(line),
    )
    .map((line) => ({ ...line, quantity, amountInclTax: line.unitPriceInclTax * quantity }));
}

/** 年齢区分の人を quantity 人減らす（減らした人の宿泊料金と宿泊税を、単価 × 人数の明細にする） */
function personsScope(booking: Booking, ageCategory: AgeCategory, quantity: number) {
  return {
    kind: 'PERSONS',
    ...removedLinesFromPriced(portionsOf(booking, ageCategory, quantity), booking.input),
  } satisfies RemovalScope<RemovedLodgingTaxLine & { priced: PricedLine }>;
}

const sum = (lines: readonly { amountInclTax: number }[]): number =>
  lines.reduce((total, line) => total + line.amountInclTax, 0);

/** 宿泊税の明細を夜ごとの額にまとめる */
function byNight(lines: readonly RemovedLodgingTaxLine[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const line of lines) {
    totals[line.stayDate] = (totals[line.stayDate] ?? 0) + line.amountInclTax;
  }
  return totals;
}

/** 事前決済の返金のうち、取り消した宿泊料金と宿泊税の分（朝食は呼び出し側で返金する） */
const refundOf = (result: CancellationEvaluation): number =>
  result.releasedStayAmount + result.releasedLodgingTaxAmount;

/** 返金しない額（キャンセル料・ノーショー料 ＋ 早期割で返金しない宿泊料金 ＋ 返金しない宿泊税） */
const retainedOf = (result: CancellationEvaluation): number =>
  result.feeAmount + result.nonRefundableAmount + result.retainedLodgingTaxAmount;

function totalOf(booking: Booking): number {
  return sum(booking.lines);
}

describe('前提の予約の金額（04 の 2.0。PriceCalculator の明細）', () => {
  it('予約A・A3・B・C・D・E・F・G・I と、TC-CH-046・TC-CH-050 の変更の後の支払い済みの額', () => {
    expect(totalOf(RES_A)).toBe(85_200);
    expect(totalOf(RES_A3)).toBe(127_800);
    expect(totalOf(RES_B)).toBe(94_000);
    expect(totalOf(RES_C)).toBe(113_600);
    expect(totalOf(RES_D)).toBe(160_800);
    expect(totalOf(RES_E)).toBe(75_000);
    expect(totalOf(RES_F)).toBe(98_400);
    expect(totalOf(RES_G)).toBe(375_000);
    expect(totalOf(RES_I)).toBe(31_600);
    expect(totalOf(RES_E_PLUS_1119)).toBe(103_400);
    expect(totalOf(RES_E_PLUS_1115)).toBe(103_400);
  });
});

describe('groupCancellationPercent（団体の段階：到着日の30日前・7日前・前日の各 0:00 から）', () => {
  // 予約G（到着 11/30）の境目：30日前 10/31 0:00、7日前 11/23 0:00、前日 11/29 0:00（brief.md PY-13）
  it.each([
    ['TC-CH-085 30日前の前日 23:59 は 0%', jst('2026-10-30', 23, 59), 0],
    ['30日前 0:00 の1ミリ秒前は 0%', millisecondBefore(jst('2026-10-31', 0)), 0],
    ['TC-CH-086 30日前 0:00 ちょうどは 20%', jst('2026-10-31', 0), 20],
    ['TC-CH-087 30日前 0:01 は 20%', jst('2026-10-31', 0, 1), 20],
    ['TC-CH-088 7日前の前日 23:59 は 20%', jst('2026-11-22', 23, 59), 20],
    ['7日前 0:00 の1ミリ秒前は 20%', millisecondBefore(jst('2026-11-23', 0)), 20],
    ['TC-CH-089 7日前 0:00 ちょうどは 50%', jst('2026-11-23', 0), 50],
    ['TC-CH-090 7日前 0:01 は 50%', jst('2026-11-23', 0, 1), 50],
    ['TC-CH-091 前日の前日 23:59 は 50%', jst('2026-11-28', 23, 59), 50],
    ['前日 0:00 の1ミリ秒前は 50%', millisecondBefore(jst('2026-11-29', 0)), 50],
    ['TC-CH-092 前日 0:00 ちょうどは 100%', jst('2026-11-29', 0), 100],
    ['TC-CH-093 前日 0:01 は 100%', jst('2026-11-29', 0, 1), 100],
    ['到着日の後（滞在中の早期チェックアウト）も 100%', jst('2026-12-02', 10), 100],
  ])('[8.6] %s', (_, at, percent) => {
    expect(groupCancellationPercent(at, '2026-11-30')).toBe(percent);
  });

  it('[8.6] 段階の境目は日本時間の 0:00（UTC の 0:00 ではない）：11/30 到着の30日前 0:00 は 2026-10-30T15:00Z', () => {
    expect(groupCancellationPercent(new Date('2026-10-30T14:59:59.999Z'), '2026-11-30')).toBe(0);
    expect(groupCancellationPercent(new Date('2026-10-30T15:00:00.000Z'), '2026-11-30')).toBe(20);
  });

  it('時刻として無効な Date・存在しない到着日は受け付けない', () => {
    expect(() => groupCancellationPercent(new Date(Number.NaN), '2026-11-30')).toThrow(RangeError);
    expect(() => groupCancellationPercent(jst('2026-11-01', 10), '2026-11-31')).toThrow(RangeError);
  });
});

describe('団体のキャンセル料の各段階の境目のちょうどの時刻（8.6）', () => {
  // 予約G を全体キャンセル（ROOM 369,000円）
  it.each([
    ['TC-CH-085', jst('2026-10-30', 23, 59), [{ kind: 'FREE' }], 0],
    [
      'TC-CH-086',
      jst('2026-10-31', 0),
      [{ kind: 'GROUP_PERCENT', percent: 20, amount: 73_800 }],
      73_800,
    ],
    [
      'TC-CH-087',
      jst('2026-10-31', 0, 1),
      [{ kind: 'GROUP_PERCENT', percent: 20, amount: 73_800 }],
      73_800,
    ],
    [
      'TC-CH-088',
      jst('2026-11-22', 23, 59),
      [{ kind: 'GROUP_PERCENT', percent: 20, amount: 73_800 }],
      73_800,
    ],
    [
      'TC-CH-089',
      jst('2026-11-23', 0),
      [{ kind: 'GROUP_PERCENT', percent: 50, amount: 184_500 }],
      184_500,
    ],
    [
      'TC-CH-090',
      jst('2026-11-23', 0, 1),
      [{ kind: 'GROUP_PERCENT', percent: 50, amount: 184_500 }],
      184_500,
    ],
    [
      'TC-CH-091',
      jst('2026-11-28', 23, 59),
      [{ kind: 'GROUP_PERCENT', percent: 50, amount: 184_500 }],
      184_500,
    ],
    [
      'TC-CH-092',
      jst('2026-11-29', 0),
      [{ kind: 'GROUP_PERCENT', percent: 100, amount: 369_000 }],
      369_000,
    ],
    [
      'TC-CH-093',
      jst('2026-11-29', 0, 1),
      [{ kind: 'GROUP_PERCENT', percent: 100, amount: 369_000 }],
      369_000,
    ],
  ])('[8.6] %s 予約G の全体キャンセル', (_, at, rules, feeAmount) => {
    const result = evaluateCancellation(scopeOf(RES_G, 'FULL'), groupCtx(at));
    expect(result.rules).toEqual(rules);
    expect(result.feeAmount).toBe(feeAmount);
    expect(result.feeCategory).toBe('CANCELLATION_FEE');
  });
});

describe('個人の無料キャンセルの期限（8.3, 8.4。到着日 15:00 の48時間前、ちょうどを含む）', () => {
  // 予約A（到着 11/16 → 期限 11/14（土）15:00）を全体キャンセル
  it('[8.3] TC-CH-078 期限の1分前（11/14 14:59）はキャンセル料0円で、宿泊料金と宿泊税をすべて返金する', () => {
    const result = evaluateCancellation(scopeOf(RES_A, 'FULL'), ctx(jst('2026-11-14', 14, 59)));
    expect(result.rules).toEqual([{ kind: 'FREE' }]);
    expect(result.feeAmount).toBe(0);
    expect(refundOf(result)).toBe(85_200);
  });

  it('[8.3] TC-CH-079 期限ちょうど（11/14 15:00）は無料の側', () => {
    const result = evaluateCancellation(scopeOf(RES_A, 'FULL'), ctx(jst('2026-11-14', 15)));
    expect(result.rules).toEqual([{ kind: 'FREE' }]);
    expect(result.feeAmount).toBe(0);
  });

  it('[8.4] 期限の1ミリ秒後からは1泊分', () => {
    const at = new Date(jst('2026-11-14', 15).getTime() + 1);
    const result = evaluateCancellation(scopeOf(RES_A, 'FULL'), ctx(at));
    expect(result.rules).toEqual([{ kind: 'FIRST_REMOVED_NIGHT', amount: 28_000 }]);
  });

  it('[8.4] [8.5] TC-CH-080 期限の1分後（11/14 15:01）は1泊分の 28,000円（1泊目 11/16 の ROOM：14,000×2）', () => {
    const result = evaluateCancellation(scopeOf(RES_A, 'FULL'), ctx(jst('2026-11-14', 15, 1)));
    expect(result.rules).toEqual([{ kind: 'FIRST_REMOVED_NIGHT', amount: 28_000 }]);
    expect(result.feeAmount).toBe(28_000);
  });

  it('[7.6] [8.3] TC-CH-030・TC-CH-031 予約C を2泊に減らす：期限前（11/01 10:00）と期限ちょうど（11/13 15:00）は0円で、返金 56,800円', () => {
    const scope = scopeOf(RES_C, 'NIGHTS', onNights('2026-11-17', '2026-11-18'));
    for (const at of [jst('2026-11-01', 10), jst('2026-11-13', 15)]) {
      const result = evaluateCancellation(scope, ctx(at, { arrivalDate: '2026-11-15' }));
      expect(result.rules).toEqual([{ kind: 'FREE' }]);
      expect(result.releasedStayAmount).toBe(56_000);
      expect(result.releasedLodgingTaxAmount).toBe(800);
      expect(refundOf(result)).toBe(56_800);
    }
  });

  it('[8.3] TC-CH-115 現地払いの予約A を期限ちょうどにキャンセル：キャンセル料0円（カードに請求しない）', () => {
    const result = evaluateCancellation(
      scopeOf(RES_A, 'FULL'),
      ctx(jst('2026-11-14', 15), { paymentMethod: 'PAY_AT_HOTEL' }),
    );
    expect(result.rules).toEqual([{ kind: 'FREE' }]);
    expect(result.feeAmount).toBe(0);
  });
});

describe('P-06 宿泊税の返金の例（8.19、付け替えは 20.7）', () => {
  it('[8.19] 例1 TC-CH-117 期限前に全体をキャンセル：宿泊料金も宿泊税も3泊とも返金（返金 85,200円）', () => {
    const result = evaluateCancellation(scopeOf(RES_A, 'FULL'), ctx(jst('2026-11-01', 10)));
    expect(result.releasedStayAmount).toBe(84_000);
    expect(byNight(result.releasedLodgingTaxLines)).toEqual({
      '2026-11-16': 400,
      '2026-11-17': 400,
      '2026-11-18': 400,
    });
    expect(result.retainedLodgingTaxLines).toEqual([]);
    expect(refundOf(result)).toBe(85_200);
  });

  it('[8.19] [20.7] 例2 TC-CH-118・TC-CH-125 期限後に全体をキャンセル：1泊目はキャンセル料で宿泊税も返金せず CANCELLATION_FEE に付け替え、2・3泊目は返金', () => {
    const result = evaluateCancellation(scopeOf(RES_A, 'FULL'), ctx(jst('2026-11-15', 10)));
    expect(result.feeAmount).toBe(28_000);
    expect(result.feeCategory).toBe('CANCELLATION_FEE');
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({ '2026-11-16': 400 });
    expect(byNight(result.releasedLodgingTaxLines)).toEqual({
      '2026-11-17': 400,
      '2026-11-18': 400,
    });
    expect(result.releasedStayAmount).toBe(56_000);
    // 返金の合計 56,800円 ＝ 85,200 − 28,000 − 400
    expect(refundOf(result)).toBe(56_800);
    expect(85_200 - retainedOf(result)).toBe(56_800);
  });

  it('[8.19] [20.7] 例3 TC-CH-119・TC-CH-126・TC-CH-147 ノーショー：1泊目はノーショー料で宿泊税も返金せず NO_SHOW_FEE に付け替え、2・3泊目は返金', () => {
    const result = evaluateNoShow(scopeOf(RES_A, 'FULL'), noShowCtx());
    expect(result.rules).toEqual([{ kind: 'FIRST_REMOVED_NIGHT', amount: 28_000 }]);
    expect(result.feeAmount).toBe(28_000);
    expect(result.feeCategory).toBe('NO_SHOW_FEE');
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({ '2026-11-16': 400 });
    expect(byNight(result.releasedLodgingTaxLines)).toEqual({
      '2026-11-17': 400,
      '2026-11-18': 400,
    });
    expect(refundOf(result)).toBe(56_800);
  });

  it('[8.9] [8.19] [20.7] 例4 TC-CH-120・TC-CH-130 早期割の予約をキャンセル：宿泊料金 73,800円も宿泊税 1,200円も返金せず、どちらも CANCELLATION_FEE の区分', () => {
    const result = evaluateCancellation(
      scopeOf(RES_E, 'FULL'),
      ctx(jst('2026-11-01', 10), { earlyBird: true }),
    );
    expect(result.rules).toEqual([{ kind: 'NON_REFUNDABLE', amount: 73_800 }]);
    expect(result.feeAmount).toBe(0);
    expect(result.nonRefundableAmount).toBe(73_800);
    expect(result.feeCategory).toBe('CANCELLATION_FEE');
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({
      '2026-11-16': 400,
      '2026-11-17': 400,
      '2026-11-18': 400,
    });
    expect(result.releasedLodgingTaxLines).toEqual([]);
    expect(refundOf(result)).toBe(0);
  });

  it('[8.6] [8.19] [20.7] 例5 TC-CH-121・TC-CH-128・TC-CH-113 団体で7日前にキャンセル（50%）：各夜の半額を返金し、宿泊税は全額返金（付け替えない）', () => {
    const result = evaluateCancellation(scopeOf(RES_G, 'FULL'), groupCtx(jst('2026-11-25', 10)));
    expect(result.rules).toEqual([{ kind: 'GROUP_PERCENT', percent: 50, amount: 184_500 }]);
    // 123,000 × 50% ＝ 61,500円 × 3夜
    expect(result.releasedStayAmount).toBe(184_500);
    expect(byNight(result.releasedLodgingTaxLines)).toEqual({
      '2026-11-30': 2_000,
      '2026-12-01': 2_000,
      '2026-12-02': 2_000,
    });
    expect(result.retainedLodgingTaxLines).toEqual([]);
    // 返金 190,500円（375,000 − 184,500）
    expect(refundOf(result)).toBe(190_500);
  });

  it('[8.25] [8.19] [20.7] 例6 TC-CH-231・TC-CH-232 団体のノーショー：全泊の宿泊料金 369,000円がノーショー料で、宿泊税 6,000円も返金せず NO_SHOW_FEE に付け替え', () => {
    const result = evaluateNoShow(scopeOf(RES_G, 'FULL'), noShowCtx({ isGroup: true }));
    expect(result.rules).toEqual([{ kind: 'GROUP_PERCENT', percent: 100, amount: 369_000 }]);
    expect(result.feeAmount).toBe(369_000);
    expect(result.feeCategory).toBe('NO_SHOW_FEE');
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({
      '2026-11-30': 2_000,
      '2026-12-01': 2_000,
      '2026-12-02': 2_000,
    });
    expect(result.releasedStayAmount).toBe(0);
    expect(refundOf(result)).toBe(0);
    expect(375_000 - retainedOf(result)).toBe(0);
  });
});

describe('個人のキャンセル料：1泊分＝取り消した部屋・人の、取り消した最初の夜（8.4, 8.5）', () => {
  it('[8.5] TC-CH-081 2室の予約B の全体キャンセル：全室・全員の1泊目 46,200円（13,200×3＋6,600）', () => {
    const result = evaluateCancellation(scopeOf(RES_B, 'FULL'), ctx(jst('2026-11-15', 10)));
    expect(result.rules).toEqual([{ kind: 'FIRST_REMOVED_NIGHT', amount: 46_200 }]);
  });

  it('[8.5] TC-CH-082 予約F：1泊目 11/12 木の 28,000円（割増のある 11/13・11/14 の 34,600円ではない）', () => {
    const result = evaluateCancellation(
      scopeOf(RES_F, 'FULL'),
      ctx(jst('2026-11-11', 10), { arrivalDate: '2026-11-12' }),
    );
    expect(result.feeAmount).toBe(28_000);
  });

  it('[8.5] TC-CH-083 朝食を含めない：朝食つきの予約A でも 28,000円（朝食の明細は取り消す範囲に入らない）', () => {
    const withBreakfast = book(stay('2026-11-16', 3), guests(2), { breakfastCounts: guests(2) });
    expect(totalOf(withBreakfast)).toBe(108_000);
    const scope = scopeOf(withBreakfast, 'FULL');
    expect(scope.removedRoomLines.every((line) => line.category === 'ROOM')).toBe(true);
    const result = evaluateCancellation(scope, ctx(jst('2026-11-15', 10)));
    expect(result.feeAmount).toBe(28_000);
    expect(refundOf(result)).toBe(56_800);
  });

  it('[8.5] TC-CH-084 時間外を含めない：レイトチェックアウト 14:00（2,000円）つきの予約A でも 28,000円', () => {
    const withLate = book(stay('2026-11-16', 3), guests(2), {
      offHours: [{ lateCheckoutHour: 14, lateCheckoutRate: VERSION_1 }],
    });
    const result = evaluateCancellation(scopeOf(withLate, 'FULL'), ctx(jst('2026-11-15', 10)));
    expect(result.feeAmount).toBe(28_000);
  });

  it('[7.6] [8.5] [8.19] TC-CH-032・TC-CH-033 予約C を期限後に2泊に減らす：減らした最初の夜 11/17 の 28,000円、11/17 の宿泊税は返金しない（返金 28,400円）', () => {
    const result = evaluateCancellation(
      scopeOf(RES_C, 'NIGHTS', onNights('2026-11-17', '2026-11-18')),
      ctx(jst('2026-11-14', 10), { arrivalDate: '2026-11-15' }),
    );
    expect(result.rules).toEqual([{ kind: 'FIRST_REMOVED_NIGHT', amount: 28_000 }]);
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({ '2026-11-17': 400 });
    expect(byNight(result.releasedLodgingTaxLines)).toEqual({ '2026-11-18': 400 });
    // 113,600 − 56,800（新しい2泊）− 28,000 − 400 ＝ 28,400
    expect(refundOf(result)).toBe(28_400);
  });

  it('[7.6] [8.5] TC-CH-034・TC-CH-035 予約F を1泊に減らす：減らした最初の夜 11/13 金の 34,600円（予約の1泊目の料金ではない）。返金 31,800円', () => {
    const result = evaluateCancellation(
      scopeOf(RES_F, 'NIGHTS', onNights('2026-11-13', '2026-11-14')),
      ctx(jst('2026-11-11', 10), { arrivalDate: '2026-11-12' }),
    );
    expect(result.rules).toEqual([{ kind: 'FIRST_REMOVED_NIGHT', amount: 34_600 }]);
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({ '2026-11-13': 400 });
    // 残る 11/12 は1泊で連泊割0%に再計算（15,600×2＋400＝31,600円）
    const remaining = book([night('2026-11-12')], guests(2));
    expect(totalOf(remaining)).toBe(31_600);
    expect(98_400 - totalOf(remaining) - retainedOf(result)).toBe(31_800);
  });

  it('[7.6] [8.5] [20.7] TC-CH-036・TC-CH-037・TC-CH-129 予約A3 の大人を1名減らす：その1名の最初の夜の 14,000円。その夜の宿泊税 200円を付け替え、返金 28,400円', () => {
    const result = evaluateCancellation(
      personsScope(RES_A3, 'ADULT', 1),
      ctx(jst('2026-11-15', 10)),
    );
    expect(result.rules).toEqual([{ kind: 'FIRST_REMOVED_NIGHT', amount: 14_000 }]);
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({ '2026-11-16': 200 });
    expect(result.feeCategory).toBe('CANCELLATION_FEE');
    const remaining = book(stay('2026-11-16', 3), guests(2));
    expect(127_800 - totalOf(remaining) - retainedOf(result)).toBe(28_400);
  });

  it('[7.6] [8.5] TC-CH-038 予約D を2室・大人4名にする：減らした2名の最初の夜の 26,400円（13,200×2）', () => {
    const scope = { ...personsScope(RES_D, 'ADULT', 2), kind: 'ROOMS' as const };
    const result = evaluateCancellation(scope, ctx(jst('2026-11-15', 10)));
    expect(result.rules).toEqual([{ kind: 'FIRST_REMOVED_NIGHT', amount: 26_400 }]);
  });

  it('[7.6] [8.5] [8.19] TC-CH-206 予約B の子どもを0名にする：子どもの最初の夜の 6,600円、その夜の子どもの宿泊税 200円は返金しない（返金 2,000円）', () => {
    const result = evaluateCancellation(
      personsScope(RES_B, 'CHILD', 1),
      ctx(jst('2026-11-15', 10)),
    );
    expect(result.rules).toEqual([{ kind: 'FIRST_REMOVED_NIGHT', amount: 6_600 }]);
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({ '2026-11-16': 200 });
    expect(byNight(result.releasedLodgingTaxLines)).toEqual({ '2026-11-17': 200 });
    const remaining = book(stay('2026-11-16', 2), guests(3), { roomCount: 2 });
    expect(totalOf(remaining)).toBe(85_200);
    expect(94_000 - totalOf(remaining) - retainedOf(result)).toBe(2_000);
  });

  describe('人数と泊数を同時に減らす：減らした部屋・人ごとの、減らした最初の夜の合計（DT-M53）', () => {
    // 予約A3（大人3名・夜 11/16〜11/18）を期限後に大人2名・2泊（夜 11/16・11/17）にする。
    // 減らした組：3人目（11/16〜11/18）と、残る大人2名の 11/18
    const thirdAdult = removedLinesFromPriced(
      portionsOf(RES_A3, 'ADULT', 1),
      RES_A3.input,
      '3人目',
    );
    const lastNightOfTwo = removedLinesFromPriced(
      portionsOf(RES_A3, 'ADULT', 2, onNights('2026-11-18')),
      RES_A3.input,
      '大人2名の 11/18',
    );
    const combined: RemovalScope<RemovedLodgingTaxLine & { priced: PricedLine }> = {
      kind: 'PERSONS',
      removedRoomLines: [...thirdAdult.removedRoomLines, ...lastNightOfTwo.removedRoomLines],
      removedLodgingTaxLines: [
        ...thirdAdult.removedLodgingTaxLines,
        ...lastNightOfTwo.removedLodgingTaxLines,
      ],
    };
    const at = jst('2026-11-15', 10);

    it('[7.6] [8.5] [8.19] TC-CH-253 キャンセル料 42,000円（3人目の 11/16 の 14,000円＋大人2名の 11/18 の 28,000円）。宿泊税は 11/16 の3人目の 200円だけ返金せず、一部を返金する 11/18 は全額返金（返金 28,800円）', () => {
      const result = evaluateCancellation(combined, ctx(at));
      expect(result.rules).toEqual([{ kind: 'FIRST_REMOVED_NIGHT', amount: 42_000 }]);
      expect(result.feeAmount).toBe(42_000);
      expect(byNight(result.retainedLodgingTaxLines)).toEqual({ '2026-11-16': 200 });
      expect(byNight(result.releasedLodgingTaxLines)).toEqual({
        '2026-11-17': 200,
        '2026-11-18': 600,
      });
      const remaining = book(stay('2026-11-16', 2), guests(2));
      expect(totalOf(remaining)).toBe(56_800);
      // 127,800 − 56,800 − 42,000 − 200 ＝ 28,800
      expect(127_800 - totalOf(remaining) - retainedOf(result)).toBe(28_800);
      expect(refundOf(result)).toBe(28_800);
    });

    it('[8.5] 人数と泊数を別々に減らしたときのキャンセル料の合計と同じ額になる', () => {
      const separately =
        evaluateCancellation({ kind: 'PERSONS', ...thirdAdult }, ctx(at)).feeAmount +
        evaluateCancellation({ kind: 'NIGHTS', ...lastNightOfTwo }, ctx(at)).feeAmount;
      expect(separately).toBe(14_000 + 28_000);
      expect(evaluateCancellation(combined, ctx(at)).feeAmount).toBe(separately);
    });

    it('[8.3] 期限内なら組に分けても0円で、宿泊料金と宿泊税をすべて返金する', () => {
      const result = evaluateCancellation(combined, ctx(jst('2026-11-14', 15)));
      expect(result.rules).toEqual([{ kind: 'FREE' }]);
      expect(refundOf(result)).toBe(14_000 * 3 + 28_000 + 200 * 3 + 400);
    });
  });

  it('[8.5] [8.19] TC-CH-114・TC-CH-124 現地払いの予約A を期限後にキャンセル：キャンセル料 28,000円（宿泊税を上乗せしない）。取り消した夜の宿泊税は1泊目を含めて請求しない', () => {
    const result = evaluateCancellation(
      scopeOf(RES_A, 'FULL'),
      ctx(jst('2026-11-15', 10), { paymentMethod: 'PAY_AT_HOTEL' }),
    );
    expect(result.feeAmount).toBe(28_000);
    expect(result.retainedLodgingTaxLines).toEqual([]);
    expect(result.retainedLodgingTaxAmount).toBe(0);
    expect(result.releasedLodgingTaxAmount).toBe(1_200);
  });

  it('[7.6] TC-CH-041 現地払いの予約C を期限後に2泊に減らす：キャンセル料 28,000円、取り消した夜の宿泊税は請求しない', () => {
    const result = evaluateCancellation(
      scopeOf(RES_C, 'NIGHTS', onNights('2026-11-17', '2026-11-18')),
      ctx(jst('2026-11-14', 10), { arrivalDate: '2026-11-15', paymentMethod: 'PAY_AT_HOTEL' }),
    );
    expect(result.feeAmount).toBe(28_000);
    expect(result.retainedLodgingTaxLines).toEqual([]);
    expect(result.releasedLodgingTaxAmount).toBe(800);
  });
});

describe('人数を変えずに室数だけを減らす変更（7.19、CH-11）', () => {
  it('[7.19] TC-CH-039 予約D を2室（大人6名のまま）にする：取り消す宿泊料金の明細がないのでキャンセル料0円', () => {
    const result = evaluateCancellation(
      { kind: 'ROOMS', removedRoomLines: [], removedLodgingTaxLines: [] },
      ctx(jst('2026-11-15', 10)),
    );
    expect(result).toEqual({
      feeCategory: 'CANCELLATION_FEE',
      rules: [{ kind: 'FREE' }],
      feeAmount: 0,
      nonRefundableAmount: 0,
      releasedStayAmount: 0,
      retainedLodgingTaxLines: [],
      retainedLodgingTaxAmount: 0,
      releasedLodgingTaxLines: [],
      releasedLodgingTaxAmount: 0,
    });
  });

  it('[7.19] [8.6] TC-CH-209 団体の予約G を4室（大人10名のまま）にする：50%の段階でもキャンセル料0円', () => {
    const result = evaluateCancellation(
      { kind: 'ROOMS', removedRoomLines: [], removedLodgingTaxLines: [] },
      groupCtx(jst('2026-11-25', 10)),
    );
    expect(result.rules).toEqual([{ kind: 'FREE' }]);
    expect(result.feeAmount).toBe(0);
  });

  it('[7.19] TC-CH-185 3室・大人4名を2室にする：キャンセル料0円で、差額 6,400円は人数割の再計算（PriceCalculator）だけで決まる', () => {
    const before = book(stay('2026-11-16', 2), guests(4), { roomCount: 3 });
    const after = book(stay('2026-11-16', 2), guests(4), { roomCount: 2 });
    const result = evaluateCancellation(
      { kind: 'ROOMS', removedRoomLines: [], removedLodgingTaxLines: [] },
      ctx(jst('2026-11-15', 10)),
    );
    expect(result.feeAmount).toBe(0);
    expect(totalOf(before) - totalOf(after) - retainedOf(result)).toBe(6_400);
  });
});

describe('団体のキャンセル料（8.6。取り消した分の宿泊料金の総額 × 段階の率）', () => {
  it('[8.6] TC-CH-094 朝食つきの予約G を20%の段階で全体キャンセル：73,800円（朝食・宿泊税を含めない）', () => {
    const withBreakfast = book(stay('2026-11-30', 3), guests(10), {
      roomCount: 5,
      breakfastCounts: guests(10),
    });
    const result = evaluateCancellation(
      scopeOf(withBreakfast, 'FULL'),
      groupCtx(jst('2026-11-01', 10)),
    );
    expect(result.rules).toEqual([{ kind: 'GROUP_PERCENT', percent: 20, amount: 73_800 }]);
  });

  it('[8.6] [8.19] TC-CH-095 予約G を50%の段階で4室・大人8名にする：減らした2名×3泊の 73,800円の50%＝36,900円。宿泊税は全額返金（返金 16,500円）', () => {
    const result = evaluateCancellation(
      { ...personsScope(RES_G, 'ADULT', 2), kind: 'ROOMS' },
      groupCtx(jst('2026-11-25', 10)),
    );
    expect(result.rules).toEqual([{ kind: 'GROUP_PERCENT', percent: 50, amount: 36_900 }]);
    expect(result.releasedLodgingTaxAmount).toBe(1_200);
    expect(result.retainedLodgingTaxLines).toEqual([]);
    const remaining = book(stay('2026-11-30', 3), guests(8), { roomCount: 4 });
    expect(totalOf(remaining)).toBe(321_600);
    expect(375_000 - totalOf(remaining) - retainedOf(result)).toBe(16_500);
  });

  it('[8.6] TC-CH-099 室数が減った後の団体（4室・大人8名・ROOM 316,800円）の全体キャンセル：20%で 63,360円', () => {
    const reduced = book(stay('2026-11-30', 3), guests(8), { roomCount: 4 });
    const result = evaluateCancellation(scopeOf(reduced, 'FULL'), groupCtx(jst('2026-11-01', 10)));
    expect(result.rules).toEqual([{ kind: 'GROUP_PERCENT', percent: 20, amount: 63_360 }]);
  });

  it('[8.6] TC-CH-104 合算で団体になった予約X（到着 11/16・ROOM 158,400円）を 11/01 にキャンセル：20%で 31,680円（個人の期限前の0円ではない）', () => {
    const reservationX = book(stay('2026-11-16', 2), guests(6), { roomCount: 3 });
    const result = evaluateCancellation(
      scopeOf(reservationX, 'FULL'),
      ctx(jst('2026-11-01', 10), { isGroup: true }),
    );
    expect(result.rules).toEqual([{ kind: 'GROUP_PERCENT', percent: 20, amount: 31_680 }]);
  });

  it('[8.6] TC-CH-096 4室の予約K（団体でない）を 11/01 にキャンセル：個人の規定で0円', () => {
    const reservationK = book(stay('2026-11-16', 2), guests(8), { roomCount: 4 });
    const result = evaluateCancellation(scopeOf(reservationK, 'FULL'), ctx(jst('2026-11-01', 10)));
    expect(result.rules).toEqual([{ kind: 'FREE' }]);
  });

  it('[8.6] [8.19] TC-CH-123 予約G を20%の段階でキャンセル：宿泊税 6,000円は全額返金（返金 301,200円）', () => {
    const result = evaluateCancellation(scopeOf(RES_G, 'FULL'), groupCtx(jst('2026-11-01', 10)));
    expect(result.feeAmount).toBe(73_800);
    expect(result.releasedLodgingTaxAmount).toBe(6_000);
    expect(refundOf(result)).toBe(301_200);
  });

  it('[8.6] [8.19] [20.7] TC-CH-122・TC-CH-127 予約G を100%の段階でキャンセル：宿泊税 6,000円を返金せず CANCELLATION_FEE に付け替え（返金 0円）', () => {
    const result = evaluateCancellation(scopeOf(RES_G, 'FULL'), groupCtx(jst('2026-11-29', 10)));
    expect(result.rules).toEqual([{ kind: 'GROUP_PERCENT', percent: 100, amount: 369_000 }]);
    expect(result.feeCategory).toBe('CANCELLATION_FEE');
    expect(result.retainedLodgingTaxAmount).toBe(6_000);
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({
      '2026-11-30': 2_000,
      '2026-12-01': 2_000,
      '2026-12-02': 2_000,
    });
    expect(refundOf(result)).toBe(0);
  });
});

describe('早期チェックアウト：残りの夜の部分キャンセル（8.10）', () => {
  it('[8.10] [8.5] [8.19] TC-CH-108・TC-CH-109 予約C を 11/17 に出発：取り消した最初の夜 11/17 の 28,000円、11/17 の宿泊税は返金せず、返金 28,400円', () => {
    const result = evaluateCancellation(
      scopeOf(RES_C, 'EARLY_DEPARTURE', onNights('2026-11-17', '2026-11-18')),
      ctx(jst('2026-11-17', 10), { arrivalDate: '2026-11-15' }),
    );
    expect(result.rules).toEqual([{ kind: 'FIRST_REMOVED_NIGHT', amount: 28_000 }]);
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({ '2026-11-17': 400 });
    expect(refundOf(result)).toBe(28_400);
  });

  it('[8.10] TC-CH-112 現地払いの予約C の早期チェックアウト：キャンセル料 28,000円、取り消した 11/17・11/18 の宿泊税は請求しない', () => {
    const result = evaluateCancellation(
      scopeOf(RES_C, 'EARLY_DEPARTURE', onNights('2026-11-17', '2026-11-18')),
      ctx(jst('2026-11-17', 10), { arrivalDate: '2026-11-15', paymentMethod: 'PAY_AT_HOTEL' }),
    );
    expect(result.feeAmount).toBe(28_000);
    expect(result.retainedLodgingTaxLines).toEqual([]);
    expect(byNight(result.releasedLodgingTaxLines)).toEqual({
      '2026-11-17': 400,
      '2026-11-18': 400,
    });
  });

  it('[8.10] [8.9] TC-CH-111 早期割の予約E を 11/18 に出発：11/18 の ROOM 24,600円と宿泊税 400円を返金しない（返金 0円）', () => {
    const result = evaluateCancellation(
      scopeOf(RES_E, 'EARLY_DEPARTURE', onNights('2026-11-18')),
      ctx(jst('2026-11-18', 10), { earlyBird: true }),
    );
    expect(result.rules).toEqual([{ kind: 'NON_REFUNDABLE', amount: 24_600 }]);
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({ '2026-11-18': 400 });
    expect(refundOf(result)).toBe(0);
  });

  it('[8.10] [8.6] [8.19] TC-CH-224 団体の予約G4（4泊）を 12/02 に出発：取り消した2夜の ROOM 246,000円の100%（1泊分の 123,000円ではない）。宿泊税 4,000円も返金しない', () => {
    const reservationG4 = book(stay('2026-11-30', 4), guests(10), { roomCount: 5 });
    expect(totalOf(reservationG4)).toBe(500_000);
    const result = evaluateCancellation(
      scopeOf(reservationG4, 'EARLY_DEPARTURE', onNights('2026-12-02', '2026-12-03')),
      groupCtx(jst('2026-12-02', 10)),
    );
    expect(result.rules).toEqual([{ kind: 'GROUP_PERCENT', percent: 100, amount: 246_000 }]);
    expect(result.retainedLodgingTaxAmount).toBe(4_000);
    expect(refundOf(result)).toBe(0);
  });
});

describe('早期割：返金しないのは早期割を適用した夜の宿泊料金と宿泊税だけ（7.7, 8.9、PY-09a、DT-M25）', () => {
  it('[7.7] [8.9] TC-CH-043 予約E を期限前に2泊に減らす：減らした 11/18 の ROOM 24,600円と宿泊税 400円を返金しない', () => {
    const result = evaluateCancellation(
      scopeOf(RES_E, 'NIGHTS', onNights('2026-11-18')),
      ctx(jst('2026-11-01', 10), { earlyBird: true }),
    );
    expect(result.rules).toEqual([{ kind: 'NON_REFUNDABLE', amount: 24_600 }]);
    expect(result.retainedLodgingTaxAmount).toBe(400);
    expect(refundOf(result)).toBe(0);
  });

  it('[7.7] [8.9] TC-CH-044 予約E の大人を1名にする：減らした1名分（ROOM 36,900円＋宿泊税 600円）は返金せず、再計算と合わせて差額 2,700円を追加で決済する', () => {
    const result = evaluateCancellation(
      personsScope(RES_E, 'ADULT', 1),
      ctx(jst('2026-11-01', 10), { earlyBird: true }),
    );
    expect(result.rules).toEqual([{ kind: 'NON_REFUNDABLE', amount: 36_900 }]);
    expect(result.retainedLodgingTaxAmount).toBe(600);
    const remaining = book(stay('2026-11-16', 3, EB), guests(1));
    expect(totalOf(remaining)).toBe(40_200);
    expect(totalOf(remaining) + retainedOf(result) - 75_000).toBe(2_700);
  });

  it('[7.7] [8.9] TC-CH-051 早期割なしで加えた 11/19 を期限前に減らす：個人の規定で0円、ROOM 28,000円と宿泊税 400円を返金', () => {
    const result = evaluateCancellation(
      scopeOf(RES_E_PLUS_1119, 'NIGHTS', onNights('2026-11-19')),
      ctx(jst('2026-11-01', 10), { earlyBird: true }),
    );
    expect(result.rules).toEqual([{ kind: 'FREE' }]);
    expect(refundOf(result)).toBe(28_400);
  });

  it('[7.7] [8.9] TC-CH-173 早期割の 11/18 と早期割なしの 11/19 を期限前に減らす：11/18 は返金せず、11/19 は返金（返金 28,400円）', () => {
    const result = evaluateCancellation(
      scopeOf(RES_E_PLUS_1119, 'NIGHTS', onNights('2026-11-18', '2026-11-19')),
      ctx(jst('2026-11-01', 10), { earlyBird: true }),
    );
    expect(result.rules).toEqual([{ kind: 'FREE' }, { kind: 'NON_REFUNDABLE', amount: 24_600 }]);
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({ '2026-11-18': 400 });
    expect(byNight(result.releasedLodgingTaxLines)).toEqual({ '2026-11-19': 400 });
    expect(refundOf(result)).toBe(28_400);
  });

  it('[8.9] [8.3] TC-CH-174 早期割の夜と早期割なしの夜を期限前に全体キャンセル：返金 28,400円（103,400 − 75,000）', () => {
    const result = evaluateCancellation(
      scopeOf(RES_E_PLUS_1119, 'FULL'),
      ctx(jst('2026-11-01', 10), { earlyBird: true }),
    );
    expect(result.rules).toEqual([{ kind: 'FREE' }, { kind: 'NON_REFUNDABLE', amount: 73_800 }]);
    expect(result.retainedLodgingTaxAmount).toBe(1_200);
    expect(refundOf(result)).toBe(28_400);
    expect(103_400 - retainedOf(result)).toBe(28_400);
  });

  it('[7.7] [8.9] [8.5] [8.19] TC-CH-252 早期割なしで加えた 11/19 がある予約を期限後にキャンセル：1泊分は早期割なしの夜の中で最初の 11/19 の 28,000円で、その夜の宿泊税 400円も返金しない（返金 0円。DT-M52）', () => {
    const result = evaluateCancellation(
      scopeOf(RES_E_PLUS_1119, 'FULL'),
      ctx(jst('2026-11-15', 10), { earlyBird: true }),
    );
    expect(result.rules).toEqual([
      { kind: 'FIRST_REMOVED_NIGHT', amount: 28_000 },
      { kind: 'NON_REFUNDABLE', amount: 73_800 },
    ]);
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({
      '2026-11-16': 400,
      '2026-11-17': 400,
      '2026-11-18': 400,
      '2026-11-19': 400,
    });
    expect(result.releasedLodgingTaxLines).toEqual([]);
    expect(refundOf(result)).toBe(0);
    // 103,400 − 73,800 − 1,200 − 28,000 − 400 ＝ 0
    expect(103_400 - retainedOf(result)).toBe(0);
  });

  it('[8.9] [8.6] TC-CH-107 早期割の団体を0%の段階でキャンセル：返金 0円（早期割の返金不可を団体の0%より優先）', () => {
    const earlyBirdGroup = book(stay('2026-11-30', 3, EB), guests(10), { roomCount: 5 });
    expect(totalOf(earlyBirdGroup)).toBe(327_000);
    const result = evaluateCancellation(
      scopeOf(earlyBirdGroup, 'FULL'),
      groupCtx(jst('2026-10-01', 10), { earlyBird: true }),
    );
    expect(result.rules).toEqual([{ kind: 'NON_REFUNDABLE', amount: 321_000 }]);
    expect(result.retainedLodgingTaxAmount).toBe(6_000);
    expect(refundOf(result)).toBe(0);
  });

  it('[8.9] TC-CH-225 朝食つきの早期割の予約をキャンセル：朝食は返金する（取り消す範囲に入らず、返金しないのは ROOM 73,800円と宿泊税 1,200円だけ）', () => {
    const withBreakfast = book(stay('2026-11-16', 3, EB), guests(2), {
      breakfastCounts: guests(2),
    });
    expect(totalOf(withBreakfast)).toBe(97_800);
    const result = evaluateCancellation(
      scopeOf(withBreakfast, 'FULL'),
      ctx(jst('2026-11-01', 10), { earlyBird: true }),
    );
    expect(result.nonRefundableAmount).toBe(73_800);
    expect(result.retainedLodgingTaxAmount).toBe(1_200);
    expect(97_800 - retainedOf(result)).toBe(22_800);
  });

  it('[7.7] [8.9] TC-CH-048 早期割の予約E の日程の変更：もとの3夜は返金しない', () => {
    const result = evaluateCancellation(
      scopeOf(RES_E, 'FULL'),
      ctx(jst('2026-10-20', 10), { earlyBird: true }),
    );
    expect(result.rules).toEqual([{ kind: 'NON_REFUNDABLE', amount: 73_800 }]);
    expect(refundOf(result)).toBe(0);
  });

  it('[7.7] [8.9] [8.19] TC-CH-254 早期割の予約に早期割なしで加えた人は、早期割を適用した夜でも個人の規定で返金する（7.8 の追加分、DT-M54）', () => {
    // 予約E の3夜に、早期割の期限の後に大人1名を加えた（加えた人は −15% の 14,000円、もとの2名は 12,300円）
    const withAddedGuest = book(stay('2026-11-16', 3, EB), guests(3), {
      addedLater: ['2026-11-16', '2026-11-17', '2026-11-18'].map((stayDate) => ({
        kind: 'GUEST' as const,
        stayDate,
        ageCategory: 'ADULT' as const,
        quantity: 1,
        rateVersion: VERSION_1,
        basePrice: STANDARD,
        earlyBirdEligible: false,
      })),
    });
    const result = evaluateCancellation(
      scopeOf(withAddedGuest, 'FULL'),
      ctx(jst('2026-11-01', 10), { earlyBird: true }),
    );
    expect(result.rules).toEqual([{ kind: 'FREE' }, { kind: 'NON_REFUNDABLE', amount: 73_800 }]);
    expect(result.releasedStayAmount).toBe(42_000);
    expect(result.retainedLodgingTaxAmount).toBe(1_200);
    expect(result.releasedLodgingTaxAmount).toBe(600);
  });
});

describe('日程の変更：もとの夜の規定は、もとの到着日を基準に判定する（DT-M44）', () => {
  it('[7.6] [8.4] [8.19] TC-CH-029 予約A を期限後に 11/24 到着へ変える：もとの到着日 11/16 の期限で 28,000円。11/16 の宿泊税は返金せず、返金 56,800円', () => {
    const result = evaluateCancellation(scopeOf(RES_A, 'FULL'), ctx(jst('2026-11-15', 10)));
    expect(result.rules).toEqual([{ kind: 'FIRST_REMOVED_NIGHT', amount: 28_000 }]);
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({ '2026-11-16': 400 });
    expect(refundOf(result)).toBe(56_800);
    // 新しい到着日 11/24 を基準にすると期限前の0円になる（呼び出し側はもとの到着日を渡す）
    const byNewArrival = evaluateCancellation(
      scopeOf(RES_A, 'FULL'),
      ctx(jst('2026-11-15', 10), { arrivalDate: '2026-11-24' }),
    );
    expect(byNewArrival.rules).toEqual([{ kind: 'FREE' }]);
  });

  it('[8.3] TC-CH-251 予約L（到着 11/24）を 11/16 到着に早める：もとの到着日 11/24 の期限 11/22 15:00 の前なので0円', () => {
    const reservationL = book(stay('2026-11-24', 3), guests(2));
    const result = evaluateCancellation(
      scopeOf(reservationL, 'FULL'),
      ctx(jst('2026-11-15', 10), { arrivalDate: '2026-11-24' }),
    );
    expect(result.rules).toEqual([{ kind: 'FREE' }]);
    expect(refundOf(result)).toBe(85_200);
  });

  it('[8.6] [8.19] TC-CH-219 団体の予約G を 12/7 到着へ変える：もとの到着日 11/30 の段階で50%の 184,500円（12/7 基準の20%の 73,800円ではない）。宿泊税 6,000円は全額返金', () => {
    const result = evaluateCancellation(scopeOf(RES_G, 'FULL'), groupCtx(jst('2026-11-25', 10)));
    expect(result.rules).toEqual([{ kind: 'GROUP_PERCENT', percent: 50, amount: 184_500 }]);
    expect(result.releasedLodgingTaxAmount).toBe(6_000);
    const byNewArrival = evaluateCancellation(
      scopeOf(RES_G, 'FULL'),
      groupCtx(jst('2026-11-25', 10), { arrivalDate: '2026-12-07' }),
    );
    expect(byNewArrival.feeAmount).toBe(73_800);
  });

  it('[8.4] TC-CH-204・TC-CH-249 現地払いの予約A の日程の変更（期限後）：キャンセル料 28,000円、取り消した夜の宿泊税は請求しない', () => {
    const result = evaluateCancellation(
      scopeOf(RES_A, 'FULL'),
      ctx(jst('2026-11-15', 10), { paymentMethod: 'PAY_AT_HOTEL' }),
    );
    expect(result.feeAmount).toBe(28_000);
    expect(result.retainedLodgingTaxLines).toEqual([]);
  });
});

describe('客室タイプを移した夜：差額を含めた額を1泊分・団体の基準額にする（8.5, 8.6、DT-M21・DT-M51）', () => {
  /** 予約 B3：デラックス キング1室・大人2名・夜 11/10・11/11（ROOM 16,800×2）。スタンダードへ移し、各夜 −5,600円を返金済み */
  const RES_B3 = book(stay('2026-11-10', 2, { basePrice: DELUXE }), guests(2));
  const downgrade = (stayDate: string, amountInclTax: number): RemovedStayLine => ({
    category: 'DOWNGRADE_ADJUSTMENT',
    stayDate,
    amountInclTax,
    earlyBirdApplied: false,
  });
  const upgrade = (stayDate: string, amountInclTax: number): RemovedStayLine => ({
    category: 'UPGRADE',
    stayDate,
    amountInclTax,
    earlyBirdApplied: false,
  });
  function withAdjustments<T extends RemovedLodgingTaxLine>(
    lines: RemovedLines<T>,
    adjustments: RemovedStayLine[],
  ): RemovalScope<T> {
    return {
      kind: 'FULL',
      removedRoomLines: [...lines.removedRoomLines, ...adjustments],
      removedLodgingTaxLines: lines.removedLodgingTaxLines,
    };
  }

  it('[8.5] [8.19] TC-OP-293 下位へ移した予約 B3 を期限後にキャンセル：1泊目の移した後の料金 28,000円（33,600 − 5,600）。返金 28,400円', () => {
    expect(totalOf(RES_B3)).toBe(68_000);
    const scope = withAdjustments(scopeOf(RES_B3, 'FULL'), [
      downgrade('2026-11-10', -5_600),
      downgrade('2026-11-11', -5_600),
    ]);
    const result = evaluateCancellation(
      scope,
      ctx(jst('2026-11-09', 10), { arrivalDate: '2026-11-10' }),
    );
    expect(result.rules).toEqual([{ kind: 'FIRST_REMOVED_NIGHT', amount: 28_000 }]);
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({ '2026-11-10': 400 });
    // 支払い済み 68,000 − 返金済み 11,200 − 28,000 − 400 ＝ 28,400
    expect(refundOf(result)).toBe(28_400);
    expect(68_000 - 11_200 - retainedOf(result)).toBe(28_400);
  });

  it('[8.5] TC-OP-294 有償で上位へ移した現地払いの予約 A5 を期限後にキャンセル：1泊目の移した後の料金 33,600円（28,000 ＋ 5,600）。宿泊税は請求しない', () => {
    const reservationA5 = book(stay('2026-11-10', 2), guests(2));
    const scope = withAdjustments(scopeOf(reservationA5, 'FULL'), [
      upgrade('2026-11-10', 5_600),
      upgrade('2026-11-11', 5_600),
    ]);
    const result = evaluateCancellation(
      scope,
      ctx(jst('2026-11-09', 10), { arrivalDate: '2026-11-10', paymentMethod: 'PAY_AT_HOTEL' }),
    );
    expect(result.rules).toEqual([{ kind: 'FIRST_REMOVED_NIGHT', amount: 33_600 }]);
    expect(result.retainedLodgingTaxLines).toEqual([]);
    expect(result.releasedLodgingTaxAmount).toBe(800);
  });

  it('[8.6] [8.19] TC-OP-295 1室を下位へ移した団体 GD を50%の段階でキャンセル：基準額 162,400円（168,000 − 5,600）の50%＝81,200円。宿泊税は全額返金（返金 83,200円）', () => {
    const reservationGD = book(stay('2026-11-10', 1, { basePrice: DELUXE }), guests(10), {
      roomCount: 5,
    });
    expect(totalOf(reservationGD)).toBe(170_000);
    const scope = withAdjustments(scopeOf(reservationGD, 'FULL'), [
      downgrade('2026-11-10', -5_600),
    ]);
    const result = evaluateCancellation(
      scope,
      ctx(jst('2026-11-05', 10, 30), { arrivalDate: '2026-11-10', isGroup: true }),
    );
    expect(result.rules).toEqual([{ kind: 'GROUP_PERCENT', percent: 50, amount: 81_200 }]);
    expect(result.releasedLodgingTaxAmount).toBe(2_000);
    expect(refundOf(result)).toBe(83_200);
    expect(170_000 - 5_600 - retainedOf(result)).toBe(83_200);
  });

  it('[8.5] [8.16] TC-OP-296 下位へ移した予約 B3 のノーショー：ノーショー料 28,000円。返金は2泊目の差額を含めた 28,000円と宿泊税 400円（DT-M51）', () => {
    const scope = withAdjustments(scopeOf(RES_B3, 'FULL'), [
      downgrade('2026-11-10', -5_600),
      downgrade('2026-11-11', -5_600),
    ]);
    const result = evaluateNoShow(scope, noShowCtx());
    expect(result.rules).toEqual([{ kind: 'FIRST_REMOVED_NIGHT', amount: 28_000 }]);
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({ '2026-11-10': 400 });
    expect(result.releasedStayAmount).toBe(28_000);
    expect(refundOf(result)).toBe(28_400);
  });
});

describe('ノーショー（P-07 手順3。1泊目がノーショー料、団体は全泊の100%）', () => {
  it('[8.16] [8.19] TC-CH-150 現地払いの予約A のノーショー：ノーショー料 28,000円を請求し、宿泊税は請求しない', () => {
    const result = evaluateNoShow(
      scopeOf(RES_A, 'FULL'),
      noShowCtx({ paymentMethod: 'PAY_AT_HOTEL' }),
    );
    expect(result.feeAmount).toBe(28_000);
    expect(result.retainedLodgingTaxLines).toEqual([]);
    expect(result.releasedLodgingTaxAmount).toBe(1_200);
  });

  it('[8.9] [8.16] [20.7] TC-CH-152・TC-CH-153・TC-CH-250 早期割の予約E のノーショー：請求額は1泊目の 24,600円、2泊目以降の 49,200円と宿泊税 1,200円も返金せず NO_SHOW_FEE の区分（返金 0円）', () => {
    const result = evaluateNoShow(scopeOf(RES_E, 'FULL'), noShowCtx({ earlyBird: true }));
    expect(result.rules).toEqual([
      { kind: 'FIRST_REMOVED_NIGHT', amount: 24_600 },
      { kind: 'NON_REFUNDABLE', amount: 49_200 },
    ]);
    expect(result.feeAmount).toBe(24_600);
    expect(result.nonRefundableAmount).toBe(49_200);
    expect(result.feeCategory).toBe('NO_SHOW_FEE');
    expect(result.retainedLodgingTaxAmount).toBe(1_200);
    expect(refundOf(result)).toBe(0);
    expect(75_000 - retainedOf(result)).toBe(0);
  });

  it('[8.16] TC-CH-154 2室の予約B のノーショー：全室・全員の1泊目 46,200円', () => {
    const result = evaluateNoShow(scopeOf(RES_B, 'FULL'), noShowCtx());
    expect(result.feeAmount).toBe(46_200);
  });

  it('[8.16] [8.19] TC-CH-155 1泊だけの予約I のノーショー：ノーショー料 31,200円と宿泊税 400円で、返金 0円', () => {
    const result = evaluateNoShow(scopeOf(RES_I, 'FULL'), noShowCtx());
    expect(result.feeAmount).toBe(31_200);
    expect(result.retainedLodgingTaxAmount).toBe(400);
    expect(refundOf(result)).toBe(0);
  });

  it('[8.9] [8.16] TC-CH-175 1泊目が早期割で、早期割なしの 11/19 を加えた予約のノーショー：11/19 の ROOM 28,000円と宿泊税 400円だけ返金（返金 28,400円）', () => {
    const result = evaluateNoShow(scopeOf(RES_E_PLUS_1119, 'FULL'), noShowCtx({ earlyBird: true }));
    expect(result.rules).toEqual([
      { kind: 'FIRST_REMOVED_NIGHT', amount: 24_600 },
      { kind: 'NON_REFUNDABLE', amount: 49_200 },
    ]);
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({
      '2026-11-16': 400,
      '2026-11-17': 400,
      '2026-11-18': 400,
    });
    expect(byNight(result.releasedLodgingTaxLines)).toEqual({ '2026-11-19': 400 });
    expect(result.releasedStayAmount).toBe(28_000);
    expect(refundOf(result)).toBe(28_400);
    // 103,400 − 24,600 − 400 − 49,200 − 800 ＝ 28,400
    expect(103_400 - retainedOf(result)).toBe(28_400);
  });

  it('[8.16] [8.19] TC-CH-233 日程の変更の後（夜 11/24〜11/26）のノーショー：新しい1泊目 11/24 の 28,000円。返金は2泊目以降の 56,800円（前のキャンセル料は範囲に入らない）', () => {
    const changed = book(stay('2026-11-24', 3), guests(2));
    const result = evaluateNoShow(scopeOf(changed, 'FULL'), noShowCtx());
    expect(result.feeAmount).toBe(28_000);
    expect(byNight(result.retainedLodgingTaxLines)).toEqual({ '2026-11-24': 400 });
    expect(refundOf(result)).toBe(56_800);
  });

  it('[8.9] [8.16] TC-CH-234 到着日の前に早期割なしの夜を足した早期割の予約のノーショー：ノーショー料は1泊目 11/15 の 28,000円、11/16〜11/18 の 73,800円と全泊の宿泊税 1,600円は返金しない（返金 0円）', () => {
    const result = evaluateNoShow(scopeOf(RES_E_PLUS_1115, 'FULL'), noShowCtx({ earlyBird: true }));
    expect(result.rules).toEqual([
      { kind: 'FIRST_REMOVED_NIGHT', amount: 28_000 },
      { kind: 'NON_REFUNDABLE', amount: 73_800 },
    ]);
    expect(result.retainedLodgingTaxAmount).toBe(1_600);
    expect(refundOf(result)).toBe(0);
  });

  it('[8.25] 早期割の団体のノーショー：全泊の宿泊料金をノーショー料（100%）にし、宿泊税も返金しない', () => {
    const earlyBirdGroup = book(stay('2026-11-30', 3, EB), guests(10), { roomCount: 5 });
    const result = evaluateNoShow(
      scopeOf(earlyBirdGroup, 'FULL'),
      noShowCtx({ isGroup: true, earlyBird: true }),
    );
    expect(result.rules).toEqual([{ kind: 'GROUP_PERCENT', percent: 100, amount: 321_000 }]);
    expect(result.nonRefundableAmount).toBe(0);
    expect(result.retainedLodgingTaxAmount).toBe(6_000);
    expect(refundOf(result)).toBe(0);
  });
});

describe('removedLinesFromPriced（PriceCalculator の明細から、取り消す宿泊料金と宿泊税の明細を作る）', () => {
  it('[8.5] 朝食・時間外の明細を除き、ROOM と LODGING_TAX を夜・額・早期割の有無とともに取り出す', () => {
    const booking = book(stay('2026-11-16', 1, EB), guests(1, 1), {
      breakfastCounts: guests(1),
      offHours: [{ earlyCheckinHour: 14, earlyCheckinRate: VERSION_1 }],
    });
    const lines = removedLinesFromPriced(booking.lines, booking.input);
    // 判定人数2（−5%）・1泊（0%）・早期割（−10%）→ −15%：大人 14,000円、子ども 7,000円
    expect(lines.removedRoomLines).toEqual([
      { category: 'ROOM', stayDate: '2026-11-16', amountInclTax: 14_000, earlyBirdApplied: true },
      { category: 'ROOM', stayDate: '2026-11-16', amountInclTax: 7_000, earlyBirdApplied: true },
    ]);
    expect(
      lines.removedLodgingTaxLines.map(({ priced, ...line }) => ({
        ...line,
        ageCategory: priced.ageCategory,
      })),
    ).toEqual([
      {
        category: 'LODGING_TAX',
        stayDate: '2026-11-16',
        amountInclTax: 200,
        earlyBirdApplied: true,
        ageCategory: 'ADULT',
      },
      {
        category: 'LODGING_TAX',
        stayDate: '2026-11-16',
        amountInclTax: 200,
        earlyBirdApplied: true,
        ageCategory: 'CHILD',
      },
    ]);
  });

  it('[7.7] 後から加えた人の明細は、加えた分の早期割の対象（AddedGuest.earlyBirdEligible）で決める', () => {
    const booking = book(stay('2026-11-16', 1, EB), guests(2), {
      addedLater: [
        {
          kind: 'GUEST',
          stayDate: '2026-11-16',
          ageCategory: 'ADULT',
          quantity: 1,
          rateVersion: VERSION_1,
          basePrice: STANDARD,
          earlyBirdEligible: false,
        },
      ],
    });
    const lines = removedLinesFromPriced(booking.lines, booking.input);
    expect(lines.removedRoomLines.map((line) => line.earlyBirdApplied)).toEqual([true, false]);
    expect(lines.removedLodgingTaxLines.map((line) => line.earlyBirdApplied)).toEqual([
      true,
      false,
    ]);
  });

  it('宿泊税の明細は、もとの PricedLine を priced に持つ（付け替える明細を呼び出し側が見分けるため）', () => {
    const lines = removedLinesFromPriced(RES_I.lines, RES_I.input);
    const taxLine = RES_I.lines.find((line) => line.category === 'LODGING_TAX');
    expect(lines.removedLodgingTaxLines[0]?.priced).toBe(taxLine);
    const result = evaluateNoShow(lines, noShowCtx());
    expect(result.retainedLodgingTaxLines[0]?.priced).toBe(taxLine);
  });

  it('料金の入力にない夜・後から加えた分の明細は受け付けない', () => {
    const stray: PricedLine = {
      category: 'ROOM',
      stayDate: '2026-11-20',
      ageCategory: 'ADULT',
      quantity: 1,
      unitPriceInclTax: 14_000,
      amountInclTax: 14_000,
      settlement: 'PREPAID_ELIGIBLE',
    };
    expect(() => removedLinesFromPriced([stray], RES_A.input)).toThrow(RangeError);
    expect(() =>
      removedLinesFromPriced(
        [{ ...stray, stayDate: '2026-11-16', addedLaterIndex: 0 }],
        RES_A.input,
      ),
    ).toThrow(RangeError);
  });
});

describe('入力の検証（呼び出し側の組み立ての誤りは RangeError）', () => {
  const roomLine = (overrides: Partial<RemovedStayLine> = {}): RemovedStayLine => ({
    category: 'ROOM',
    stayDate: '2026-11-16',
    amountInclTax: 28_000,
    earlyBirdApplied: false,
    ...overrides,
  });
  const taxLine = (overrides: Partial<RemovedLodgingTaxLine> = {}): RemovedLodgingTaxLine => ({
    category: 'LODGING_TAX',
    stayDate: '2026-11-16',
    amountInclTax: 400,
    earlyBirdApplied: false,
    ...overrides,
  });
  const scope = (
    removedRoomLines: RemovedStayLine[],
    removedLodgingTaxLines: RemovedLodgingTaxLine[] = [],
  ): RemovalScope => ({ kind: 'FULL', removedRoomLines, removedLodgingTaxLines });
  const at = jst('2026-11-15', 10);

  it('宿泊日の形の誤り・存在しない到着日・時刻として無効な Date', () => {
    expect(() =>
      evaluateCancellation(scope([roomLine({ stayDate: '2026/11/16' })]), ctx(at)),
    ).toThrow(RangeError);
    expect(() =>
      evaluateCancellation(scope([roomLine()]), ctx(at, { arrivalDate: '2026-02-30' })),
    ).toThrow(RangeError);
    expect(() => evaluateCancellation(scope([roomLine()]), ctx(new Date(Number.NaN)))).toThrow(
      RangeError,
    );
  });

  it('早期割でない予約に、早期割をかけた明細がある', () => {
    expect(() =>
      evaluateCancellation(scope([roomLine({ earlyBirdApplied: true })]), ctx(at)),
    ).toThrow(RangeError);
    expect(() =>
      evaluateNoShow(scope([roomLine({ earlyBirdApplied: true })]), noShowCtx()),
    ).toThrow(RangeError);
  });

  it('宿泊税の明細の夜（と早期割の有無）に、取り消す宿泊料金の明細がない', () => {
    expect(() =>
      evaluateCancellation(scope([roomLine()], [taxLine({ stayDate: '2026-11-17' })]), ctx(at)),
    ).toThrow(RangeError);
    expect(() =>
      evaluateCancellation(
        scope([roomLine()], [taxLine({ earlyBirdApplied: true })]),
        ctx(at, { earlyBird: true }),
      ),
    ).toThrow(RangeError);
  });

  it('額の符号・整数の誤り、宿泊料金の明細でない区分、夜の宿泊料金の合計が負', () => {
    const invalid: RemovedStayLine[] = [
      roomLine({ amountInclTax: -1 }),
      roomLine({ amountInclTax: 100.5 }),
      roomLine({ category: 'UPGRADE', amountInclTax: -100 }),
      roomLine({ category: 'DOWNGRADE_ADJUSTMENT', amountInclTax: 100 }),
      roomLine({ category: 'BREAKFAST' as unknown as RemovedStayLine['category'] }),
    ];
    for (const line of invalid) {
      expect(() => evaluateCancellation(scope([line]), ctx(at))).toThrow(RangeError);
    }
    expect(() =>
      evaluateCancellation(
        scope([roomLine(), roomLine({ category: 'DOWNGRADE_ADJUSTMENT', amountInclTax: -28_100 })]),
        ctx(at),
      ),
    ).toThrow(RangeError);
    expect(() =>
      evaluateCancellation(scope([roomLine()], [taxLine({ amountInclTax: 0.5 })]), ctx(at)),
    ).toThrow(RangeError);
  });

  it('ノーショーで宿泊料金の明細がない', () => {
    expect(() => evaluateNoShow(scope([]), noShowCtx())).toThrow(RangeError);
  });
});

describe('cancellationPolicy（design.md の CancellationPolicy のインターフェース）', () => {
  it('evaluate・evaluateNoShow は evaluateCancellation・evaluateNoShow と同じ結果を返す', () => {
    const scope = scopeOf(RES_A, 'FULL');
    const at = jst('2026-11-15', 10);
    expect(cancellationPolicy.evaluate(scope, ctx(at))).toEqual(
      evaluateCancellation(scope, ctx(at)),
    );
    expect(cancellationPolicy.evaluateNoShow(scope, noShowCtx())).toEqual(
      evaluateNoShow(scope, noShowCtx()),
    );
  });
});
