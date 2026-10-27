// 料金の計算（PriceCalculator。design.md Components and Interfaces、処理仕様 P-01、設計の補足 L-34・L-45）。
//
// 予約の内容と夜ごとの料金の控えから、請求の明細を作る。入力だけから結果が決まる純粋な関数で、
// データベースと現在時刻を使わない。金額は円の整数、率は bp の整数で計算し、小数を使わない（tax.ts）。
import {
  AGE_CATEGORIES,
  type AgeCategory,
  type BasisPoints,
  type EarlyCheckinHour,
  type ErrorCode,
  type ErrorDetails,
  type GuestCounts,
  type LateCheckoutHour,
  type Yen,
} from '@hotel/contracts';
import { parseDate } from '../calendar/business-date.js';
import { earlyBirdDiscountBp } from './early-bird.js';
import { lodgingTaxPerPersonNight, taxInclusiveUnitPrice, type UnitBase } from './tax.js';
import type {
  AddedBreakfast,
  AddedGuest,
  AddedLaterItem,
  NightSnapshot,
  OffHoursSelection,
  PriceCalculator,
  PricedLine,
  PricedLineCategory,
  PriceInput,
  RateVersionValues,
} from './types.js';

/**
 * 利用者が直せる入力の誤り（API では VALIDATION_FAILED）。朝食の人数が区分の人数を超えたときに投げる（P-01 手順5）。
 * domain はフレームワークの例外を使わないので、呼び出し側（modules のサービス）が code と details で業務エラーにする。
 * 呼び出し側の組み立ての誤り（版の渡し忘れ、後から加えた分の食い違いなど）は、通常の RangeError を投げる。
 */
export class PricingValidationError extends RangeError {
  readonly code: Extract<ErrorCode, 'VALIDATION_FAILED'> = 'VALIDATION_FAILED';
  readonly details: ErrorDetails;

  constructor(message: string, details: ErrorDetails) {
    super(message);
    this.name = 'PricingValidationError';
    this.details = details;
  }
}

/** アーリーチェックインの開始時刻ごとの時間数（チェックイン 15:00 まで。P-01 手順6） */
export const EARLY_CHECKIN_CHARGED_HOURS: Readonly<Record<EarlyCheckinHour, number>> = {
  12: 3,
  13: 2,
  14: 1,
};

/** レイトチェックアウトの終了時刻ごとの時間数（チェックアウト 12:00 から。P-01 手順6） */
export const LATE_CHECKOUT_CHARGED_HOURS: Readonly<Record<LateCheckoutHour, number>> = {
  13: 1,
  14: 2,
  15: 3,
};

const COUNT_KEYS: Readonly<Record<AgeCategory, keyof GuestCounts>> = {
  ADULT: 'adults',
  CHILD: 'children',
  INFANT: 'infants',
};

/**
 * 人数割の判定人数 ＝ 宿泊人数 − max(0, 予約した部屋の基準人数の合計 − 宿泊人数)。宿泊人数は幼児を含む全員（要件 6.10）。
 * 例：2名・1室 → 2、10名・10室 → 0、10名・5室 → 10。0以下になる入力もそのまま返す（人数割は0%）。
 */
export function judgedHeadcount(
  counts: GuestCounts,
  roomCount: number,
  standardOccupancyPerRoom: number,
): number {
  assertGuestCounts(counts, '人数');
  assertPositiveInteger(roomCount, '室数');
  assertPositiveInteger(standardOccupancyPerRoom, '基準人数');
  const persons = counts.adults + counts.children + counts.infants;
  return persons - Math.max(0, standardOccupancyPerRoom * roomCount - persons);
}

/**
 * その夜の合算した率 ＝ 割増 − 人数割 − 連泊割 − 早期割。版の下限（−50%）を下回れば下限にする（要件 6.4・6.5、P-01 手順1）。
 * 人数割・連泊割の段階は最終的な判定人数・泊数で決め、率はその夜の控えの版から取る（brief.md CH-02a）。
 */
export function combinedRateBp(params: {
  surchargeBp: BasisPoints;
  rateVersion: RateVersionValues;
  earlyBirdEligible: boolean;
  judgedHeadcount: number;
  nightCount: number;
}): BasisPoints {
  const { rateVersion } = params;
  const total =
    params.surchargeBp -
    headcountDiscountBp(rateVersion, params.judgedHeadcount) -
    stayDiscountBp(rateVersion, params.nightCount) -
    earlyBirdDiscountBp(params.earlyBirdEligible, rateVersion);
  return Math.max(total, rateVersion.rateFloorBp);
}

/**
 * 請求の明細を作る（P-01 手順1〜7）。
 * - ROOM・BREAKFAST・LODGING_TAX は夜×年齢区分ごと（人数が0の区分は作らない）。後から加えた分は別の明細にする
 * - EARLY_CHECKIN・LATE_CHECKOUT は部屋ごとで、常に現地で精算する（ONSITE_ONLY）
 * - 並び順は 宿泊料金 → 朝食 → 時間外 → 宿泊税（それぞれ夜の順・大人→子ども→幼児の順）
 *
 * 朝食の人数が区分の人数を超えたら PricingValidationError（VALIDATION_FAILED）。
 */
export function calculatePrice(input: PriceInput): PricedLine[] {
  const addedLater = input.addedLater ?? [];
  validateInput(input, addedLater);
  const judged = judgedHeadcount(input.counts, input.roomCount, input.standardOccupancyPerRoom);
  const nightCount = input.nights.length;

  const roomLines: PricedLine[] = [];
  const breakfastLines: PricedLine[] = [];
  const lodgingTaxLines: PricedLine[] = [];
  for (const night of input.nights) {
    const version = night.rateVersion;
    const rateFor = (earlyBirdEligible: boolean): BasisPoints =>
      combinedRateBp({
        surchargeBp: night.surchargeBp,
        rateVersion: version,
        earlyBirdEligible,
        judgedHeadcount: judged,
        nightCount,
      });
    const addStay = (
      ageCategory: AgeCategory,
      quantity: number,
      adultBasePrice: Yen,
      rateBp: BasisPoints,
      addedLaterIndex?: number,
    ): void => {
      if (quantity === 0) {
        return;
      }
      const unitBase = unitBaseOf(ageCategory, adultBasePrice);
      roomLines.push(
        nightLine(
          'ROOM',
          night.stayDate,
          ageCategory,
          quantity,
          taxInclusiveUnitPrice(unitBase, rateBp, version.consumptionTaxBp),
          addedLaterIndex,
        ),
      );
      lodgingTaxLines.push(
        nightLine(
          'LODGING_TAX',
          night.stayDate,
          ageCategory,
          quantity,
          lodgingTaxPerPersonNight(unitBase, rateBp, version.lodgingTaxBrackets),
          addedLaterIndex,
        ),
      );
    };
    const addBreakfast = (
      ageCategory: AgeCategory,
      quantity: number,
      adultBreakfastPrice: Yen,
      addedLaterIndex?: number,
    ): void => {
      if (quantity === 0) {
        return;
      }
      // 朝食には割増・割引の率をかけない（要件 6.14）
      const unitBase = unitBaseOf(ageCategory, adultBreakfastPrice);
      breakfastLines.push(
        nightLine(
          'BREAKFAST',
          night.stayDate,
          ageCategory,
          quantity,
          taxInclusiveUnitPrice(unitBase, 0, version.consumptionTaxBp),
          addedLaterIndex,
        ),
      );
    };

    for (const ageCategory of AGE_CATEGORIES) {
      const added = addedLaterOn(addedLater, night.stayDate, ageCategory);

      // 宿泊料金と宿泊税：もとからの人はその夜の控え、後から加えた人は加えた時点の基本料金と、加えた分の早期割の対象
      addStay(
        ageCategory,
        countOf(input.counts, ageCategory) - sumQuantity(added.guests),
        night.basePrice,
        rateFor(night.earlyBirdEligible),
      );
      for (const { item, index } of added.guests) {
        addStay(ageCategory, item.quantity, item.basePrice, rateFor(item.earlyBirdEligible), index);
      }

      // 朝食：全泊に同じ人数。後から加えた分は加えた時点の版の朝食の単価
      addBreakfast(
        ageCategory,
        countOf(input.breakfastCounts, ageCategory) - sumQuantity(added.breakfasts),
        version.breakfastPriceExclTax,
      );
      for (const { item, index } of added.breakfasts) {
        addBreakfast(ageCategory, item.quantity, item.rateVersion.breakfastPriceExclTax, index);
      }
    }
  }

  const offHoursLines = input.offHours.flatMap(offHoursLinesOf);
  return [...roomLines, ...breakfastLines, ...offHoursLines, ...lodgingTaxLines];
}

/** design.md の PriceCalculator のインターフェース */
export const priceCalculator: PriceCalculator = {
  calculate: calculatePrice,
  judgedHeadcount,
};

/** 年齢区分ごとの単価のもと：大人＝大人の料金、子ども＝その半額（端数を保つ）、幼児＝0（要件 6.2・6.14、P-01 手順2） */
function unitBaseOf(ageCategory: AgeCategory, adultPrice: Yen): UnitBase {
  switch (ageCategory) {
    case 'ADULT':
      return { numerator: adultPrice, denominator: 1 };
    case 'CHILD':
      return { numerator: adultPrice, denominator: 2 };
    case 'INFANT':
      return { numerator: 0, denominator: 1 };
  }
}

/** 判定人数が当てはまる段階のうち、下限が最も高い段階の率（判定人数が1以下なら、版1 では段階がなく0%。要件 6.9） */
function headcountDiscountBp(rateVersion: RateVersionValues, judged: number): BasisPoints {
  let best: { min: number; discountBp: BasisPoints } | undefined;
  for (const tier of rateVersion.headcountTiers) {
    if (tier.minPersons <= judged && (best === undefined || tier.minPersons > best.min)) {
      best = { min: tier.minPersons, discountBp: tier.discountBp };
    }
  }
  return best?.discountBp ?? 0;
}

/** 泊数が当てはまる段階のうち、下限が最も高い段階の率（要件 6.11） */
function stayDiscountBp(rateVersion: RateVersionValues, nightCount: number): BasisPoints {
  let best: { min: number; discountBp: BasisPoints } | undefined;
  for (const tier of rateVersion.stayTiers) {
    if (tier.minNights <= nightCount && (best === undefined || tier.minNights > best.min)) {
      best = { min: tier.minNights, discountBp: tier.discountBp };
    }
  }
  return best?.discountBp ?? 0;
}

/** 部屋ごとの時間外の明細（選んだ時点の版の1時間あたりの税込み料金 × 時間数。要件 6.15・11.5、L-34） */
function offHoursLinesOf(selection: OffHoursSelection, roomIndex: number): PricedLine[] {
  const lines: PricedLine[] = [];
  if (selection.earlyCheckinHour !== undefined) {
    lines.push(
      offHoursLine(
        'EARLY_CHECKIN',
        chargedHoursOf(
          EARLY_CHECKIN_CHARGED_HOURS,
          selection.earlyCheckinHour,
          'アーリーチェックイン',
        ),
        selection.earlyCheckinRate,
        roomIndex,
      ),
    );
  }
  if (selection.lateCheckoutHour !== undefined) {
    lines.push(
      offHoursLine(
        'LATE_CHECKOUT',
        chargedHoursOf(
          LATE_CHECKOUT_CHARGED_HOURS,
          selection.lateCheckoutHour,
          'レイトチェックアウト',
        ),
        selection.lateCheckoutRate,
        roomIndex,
      ),
    );
  }
  return lines;
}

function offHoursLine(
  category: Extract<PricedLineCategory, 'EARLY_CHECKIN' | 'LATE_CHECKOUT'>,
  hours: number,
  rateVersion: RateVersionValues | undefined,
  roomIndex: number,
): PricedLine {
  if (rateVersion === undefined) {
    throw new RangeError(
      `${category} の料金の版（選んだ時点の版）を指定してください（部屋 ${roomIndex}）`,
    );
  }
  const pricePerHour = rateVersion.offHoursPricePerHourInclTax;
  assertNonNegativeInteger(pricePerHour, '時間外の1時間の料金');
  return {
    category,
    quantity: hours,
    unitPriceInclTax: pricePerHour,
    amountInclTax: pricePerHour * hours,
    settlement: 'ONSITE_ONLY',
    roomIndex,
  };
}

function chargedHoursOf<H extends number>(
  table: Readonly<Record<H, number>>,
  hour: H,
  label: string,
): number {
  if (!Object.hasOwn(table, hour)) {
    throw new RangeError(`${label}の時刻が選択肢にありません: ${hour}`);
  }
  return table[hour];
}

function nightLine(
  category: Extract<PricedLineCategory, 'ROOM' | 'BREAKFAST' | 'LODGING_TAX'>,
  stayDate: string,
  ageCategory: AgeCategory,
  quantity: number,
  unitPriceInclTax: Yen,
  addedLaterIndex: number | undefined,
): PricedLine {
  const line: PricedLine = {
    category,
    stayDate,
    ageCategory,
    quantity,
    unitPriceInclTax,
    amountInclTax: unitPriceInclTax * quantity,
    settlement: 'PREPAID_ELIGIBLE',
  };
  if (addedLaterIndex !== undefined) {
    line.addedLaterIndex = addedLaterIndex;
  }
  return line;
}

interface Indexed<T> {
  item: T;
  index: number;
}

/** その夜・年齢区分の、後から加えた人と朝食（addedLater の位置つき） */
function addedLaterOn(
  addedLater: readonly AddedLaterItem[],
  stayDate: string,
  ageCategory: AgeCategory,
): { guests: Indexed<AddedGuest>[]; breakfasts: Indexed<AddedBreakfast>[] } {
  const guests: Indexed<AddedGuest>[] = [];
  const breakfasts: Indexed<AddedBreakfast>[] = [];
  addedLater.forEach((item, index) => {
    if (item.stayDate !== stayDate || item.ageCategory !== ageCategory) {
      return;
    }
    if (item.kind === 'GUEST') {
      guests.push({ item, index });
    } else {
      breakfasts.push({ item, index });
    }
  });
  return { guests, breakfasts };
}

function sumQuantity(items: readonly Indexed<AddedLaterItem>[]): number {
  return items.reduce((sum, { item }) => sum + item.quantity, 0);
}

function countOf(counts: GuestCounts, ageCategory: AgeCategory): number {
  return counts[COUNT_KEYS[ageCategory]];
}

function validateInput(input: PriceInput, addedLater: readonly AddedLaterItem[]): void {
  if (input.nights.length === 0) {
    throw new RangeError('宿泊する夜を1つ以上指定してください');
  }
  const stayDates = new Set<string>();
  for (const night of input.nights) {
    validateNight(night);
    if (stayDates.has(night.stayDate)) {
      throw new RangeError(`同じ宿泊日の控えが重複しています: ${night.stayDate}`);
    }
    stayDates.add(night.stayDate);
  }

  assertGuestCounts(input.counts, '人数');
  assertGuestCounts(input.breakfastCounts, '朝食の人数');
  assertPositiveInteger(input.roomCount, '室数');
  assertPositiveInteger(input.standardOccupancyPerRoom, '基準人数');
  for (const ageCategory of AGE_CATEGORIES) {
    const breakfastCount = countOf(input.breakfastCounts, ageCategory);
    const guestCount = countOf(input.counts, ageCategory);
    if (breakfastCount > guestCount) {
      throw new PricingValidationError('朝食の人数が、その区分の人数を超えています', {
        ageCategory,
        breakfastCount,
        guestCount,
      });
    }
  }

  if (input.offHours.length > input.roomCount) {
    throw new RangeError(
      `時間外の部屋の数（${input.offHours.length}）が室数（${input.roomCount}）を超えています`,
    );
  }

  validateAddedLater(input, addedLater, stayDates);
}

function validateNight(night: NightSnapshot): void {
  parseDate(night.stayDate);
  assertNonNegativeInteger(night.basePrice, '基本料金');
  assertNonNegativeInteger(night.surchargeBp, '割増の率');
}

/** 後から加えた分は counts・breakfastCounts の内数（L-45）。夜・区分ごとの合計が内数に収まるかを確かめる */
function validateAddedLater(
  input: PriceInput,
  addedLater: readonly AddedLaterItem[],
  stayDates: ReadonlySet<string>,
): void {
  const totals = new Map<string, number>();
  for (const item of addedLater) {
    if (!stayDates.has(item.stayDate)) {
      throw new RangeError(`後から加えた分の夜が、夜の控えにありません: ${item.stayDate}`);
    }
    assertPositiveInteger(item.quantity, '後から加えた人数');
    if (item.kind === 'GUEST') {
      assertNonNegativeInteger(item.basePrice, '後から加えた人の基本料金');
    }
    const key = `${item.kind}:${item.stayDate}:${item.ageCategory}`;
    const total = (totals.get(key) ?? 0) + item.quantity;
    totals.set(key, total);
    const limit = countOf(
      item.kind === 'GUEST' ? input.counts : input.breakfastCounts,
      item.ageCategory,
    );
    if (total > limit) {
      throw new RangeError(
        `後から加えた分（${key}）の合計 ${total} が、${item.kind === 'GUEST' ? '人数' : '朝食の人数'} ${limit} を超えています`,
      );
    }
  }
}

function assertGuestCounts(counts: GuestCounts, label: string): void {
  for (const ageCategory of AGE_CATEGORIES) {
    assertNonNegativeInteger(countOf(counts, ageCategory), `${label}（${ageCategory}）`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label}は0以上の整数で指定してください: ${value}`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label}は1以上の整数で指定してください: ${value}`);
  }
}
