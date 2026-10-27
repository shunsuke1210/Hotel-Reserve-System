// PriceCalculator の入出力の型（design.md Components and Interfaces > PriceCalculator、設計の補足 L-34・L-45）。
// 金額はすべて円の整数（Yen）、率はベーシスポイントの整数（BasisPoints。1% ＝ 100bp）。
import type {
  AgeCategory,
  BasisPoints,
  ChargeCategory,
  EarlyCheckinHour,
  GuestCounts,
  LateCheckoutHour,
  Yen,
} from '@hotel/contracts';

/** 人数割の段階（判定人数が minPersons 以上なら discountBp。要件 6.9） */
export interface HeadcountTier {
  minPersons: number;
  discountBp: BasisPoints;
}

/** 連泊割の段階（泊数が minNights 以上なら discountBp。要件 6.11） */
export interface StayTier {
  minNights: number;
  discountBp: BasisPoints;
}

/** 宿泊税の区分（1人1泊の税抜の素泊まり料金が minExclTax 以上なら taxPerPersonNight。要件 6.16） */
export interface LodgingTaxBracket {
  minExclTax: Yen;
  taxPerPersonNight: Yen;
}

/** 料金の版（rate_versions）のうち、料金の計算に使う値 */
export interface RateVersionValues {
  /** 例：[{2,500},{4,1000},{10,1500}] */
  headcountTiers: readonly HeadcountTier[];
  /** 例：[{2,1000},{5,2000}] */
  stayTiers: readonly StayTier[];
  /** 例：1000 */
  earlyBirdBp: BasisPoints;
  /** 合算した率の下限。例：-5000 */
  rateFloorBp: BasisPoints;
  /** 例：1000 */
  consumptionTaxBp: BasisPoints;
  /** 大人1人1食の朝食の料金（税抜）。例：3500 */
  breakfastPriceExclTax: Yen;
  /** 時間外の1室1時間の料金（税込み）。例：1000 */
  offHoursPricePerHourInclTax: Yen;
  /** 例：[{0,0},{5000,200},{20000,500}] */
  lodgingTaxBrackets: readonly LodgingTaxBracket[];
}

/** 夜ごとの料金の控え（stay_night_prices） */
export interface NightSnapshot {
  /** YYYY-MM-DD（宿泊日） */
  stayDate: string;
  /** その夜を予約した時点の料金の版 */
  rateVersion: RateVersionValues;
  /** その夜の、客室タイプの基本料金（税抜・大人1人） */
  basePrice: Yen;
  /** その夜に適用する割増（曜日・特定期間のうち高いほう。なければ0） */
  surchargeBp: BasisPoints;
  /** その夜が早期割の対象か（domain/calendar の isEarlyBirdBooking などで、控えを作るときに判定した結果） */
  earlyBirdEligible: boolean;
}

/** 部屋ごとの時間外の選択。料金は選んだ時点の版で計算する（設計の補足 L-34） */
export interface OffHoursSelection {
  earlyCheckinHour?: EarlyCheckinHour;
  /** アーリーチェックインを選んだ時点の料金の版（earlyCheckinHour があるときは必須） */
  earlyCheckinRate?: RateVersionValues;
  lateCheckoutHour?: LateCheckoutHour;
  /** レイトチェックアウトを選んだ時点の料金の版（lateCheckoutHour があるときは必須） */
  lateCheckoutRate?: RateVersionValues;
}

interface AddedLaterBase {
  /** 加えた夜（nights のどれかの stayDate） */
  stayDate: string;
  ageCategory: AgeCategory;
  /** 加えた人数（1以上） */
  quantity: number;
  /** 加えた時点の料金の版（明細に記録する版。L-14） */
  rateVersion: RateVersionValues;
}

/** 既存の夜に後から加えた人（counts の内数） */
export interface AddedGuest extends AddedLaterBase {
  kind: 'GUEST';
  /** 加えた時点の版の、客室タイプの基本料金（税抜・大人1人） */
  basePrice: Yen;
  /**
   * 加えた人に早期割をかけるか。早期割の予約でも、条件を満たさない追加分は早期割なしで計算する（要件 7.8、brief.md CH-03）。
   * 呼び出し側が、予約の到着日と加えた日で判定する（domain/calendar の isEarlyBirdBooking）
   */
  earlyBirdEligible: boolean;
}

/** 既存の夜に後から加えた朝食（breakfastCounts の内数）。朝食の単価は rateVersion から取る */
export interface AddedBreakfast extends AddedLaterBase {
  kind: 'BREAKFAST';
}

/**
 * 後から加えた人・朝食（設計の補足 L-45）。基本料金・朝食の単価は加えた時点の版から、
 * 人数割・連泊割などの率はその夜の控えの版から取る（brief.md CH-02a）
 */
export type AddedLaterItem = AddedGuest | AddedBreakfast;

export interface PriceInput {
  nights: readonly NightSnapshot[];
  counts: GuestCounts;
  roomCount: number;
  /** 基準人数（全タイプ2） */
  standardOccupancyPerRoom: number;
  /** 朝食をつける人数（区分ごとに counts 以下）。全泊に同じ人数を適用 */
  breakfastCounts: GuestCounts;
  /** 部屋ごとの時間外（要素の位置が部屋の順番。時間外のない部屋は空のオブジェクトか、末尾なら省略できる） */
  offHours: readonly OffHoursSelection[];
  /** 後から加えた人・朝食（counts・breakfastCounts の内数） */
  addedLater?: readonly AddedLaterItem[];
}

/** PriceCalculator が作る明細の区分 */
export type PricedLineCategory = Extract<
  ChargeCategory,
  'ROOM' | 'BREAKFAST' | 'EARLY_CHECKIN' | 'LATE_CHECKOUT' | 'LODGING_TAX'
>;

/** 精算先：事前決済に含められる明細と、常に現地で精算する明細（時間外。要件 6.15・11.5） */
export type PricedLineSettlement = 'PREPAID_ELIGIBLE' | 'ONSITE_ONLY';

export interface PricedLine {
  category: PricedLineCategory;
  /** ROOM・BREAKFAST・LODGING_TAX の夜（時間外は部屋ごとで夜に属さないので持たない） */
  stayDate?: string;
  /** ROOM・BREAKFAST・LODGING_TAX の年齢区分 */
  ageCategory?: AgeCategory;
  /** 人数（ROOM・BREAKFAST・LODGING_TAX）または時間数（EARLY_CHECKIN・LATE_CHECKOUT） */
  quantity: number;
  /** 1人1泊（朝食は1人1食、時間外は1室1時間）の税込みの単価 */
  unitPriceInclTax: Yen;
  amountInclTax: Yen;
  settlement: PricedLineSettlement;
  /** 時間外の明細の部屋（PriceInput.offHours の位置） */
  roomIndex?: number;
  /** 後から加えた分の明細（PriceInput.addedLater の位置。明細には、その要素の加えた時点の版を記録する） */
  addedLaterIndex?: number;
}

export interface PriceCalculator {
  calculate(input: PriceInput): PricedLine[];
  judgedHeadcount(counts: GuestCounts, roomCount: number, standardOccupancyPerRoom: number): number;
}
