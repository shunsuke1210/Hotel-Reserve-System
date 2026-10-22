// 予約・部屋・役割・年齢区分・言語などの列挙（design.md「共通の型」と「Data Models」）。
// 各列挙は、値の配列（例：LOCALES）・型（Locale）・zod スキーマ（LocaleSchema）の3つを組で定める。
import { z } from 'zod';

/** 宿泊客アプリの言語。 */
export const LOCALES = ['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant'] as const;
export type Locale = (typeof LOCALES)[number];
export const LocaleSchema = z.enum(LOCALES);

/** 年齢区分（大人・子ども・幼児）。 */
export const AGE_CATEGORIES = ['ADULT', 'CHILD', 'INFANT'] as const;
export type AgeCategory = (typeof AGE_CATEGORIES)[number];
export const AgeCategorySchema = z.enum(AGE_CATEGORIES);

/** スタッフの役割（管理者 ＞ フロント ＞ 清掃員）。 */
export const STAFF_ROLES = ['ADMIN', 'FRONT', 'CLEANER'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const StaffRoleSchema = z.enum(STAFF_ROLES);

/** 予約の支払い方法（事前決済・現地払い）。 */
export const PAYMENT_METHODS = ['PREPAID', 'PAY_AT_HOTEL'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PaymentMethodSchema = z.enum(PAYMENT_METHODS);

/** 予約の状態。 */
export const RESERVATION_STATUSES = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
  'NO_SHOW',
  'EXPIRED',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export const ReservationStatusSchema = z.enum(RESERVATION_STATUSES);

/** 部屋の状態のグループ（空室の清掃グループ・連泊グループ・その他）。 */
export const ROOM_STATUS_GROUPS = ['VACANT', 'STAY', 'OTHER'] as const;
export type RoomStatusGroup = (typeof ROOM_STATUS_GROUPS)[number];
export const RoomStatusGroupSchema = z.enum(ROOM_STATUS_GROUPS);

const VACANT_ROOM_STATUSES = ['CLEANING_READY', 'CLEANING', 'INSPECTION', 'CLEAN'] as const;
const STAY_ROOM_STATUSES = [
  'STAY_DIRTY',
  'STAY_CLEANING',
  'STAY_INSPECTION',
  'STAY_CLEAN',
] as const;
const OTHER_ROOM_STATUSES = [
  'CHECKED_IN',
  'DEPARTURE_PENDING',
  'NO_ARRIVAL',
  'OUT_OF_ORDER',
] as const;

/** 部屋の状態（客室の清掃状況）。 */
export const ROOM_STATUSES = [
  ...VACANT_ROOM_STATUSES,
  ...STAY_ROOM_STATUSES,
  ...OTHER_ROOM_STATUSES,
] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];
export const RoomStatusSchema = z.enum(ROOM_STATUSES);

/** グループごとの部屋の状態。役割ごとの変更の可否は domain の RoomStatusRules が決める。 */
export const ROOM_STATUSES_BY_GROUP = {
  VACANT: VACANT_ROOM_STATUSES,
  STAY: STAY_ROOM_STATUSES,
  OTHER: OTHER_ROOM_STATUSES,
} as const satisfies Record<RoomStatusGroup, readonly RoomStatus[]>;

/** アーリーチェックインの開始時刻（時）。 */
export const EARLY_CHECKIN_HOURS = [12, 13, 14] as const;
export type EarlyCheckinHour = (typeof EARLY_CHECKIN_HOURS)[number];
export const EarlyCheckinHourSchema = z.literal(EARLY_CHECKIN_HOURS);

/** レイトチェックアウトの終了時刻（時）。 */
export const LATE_CHECKOUT_HOURS = [13, 14, 15] as const;
export type LateCheckoutHour = (typeof LATE_CHECKOUT_HOURS)[number];
export const LateCheckoutHourSchema = z.literal(LATE_CHECKOUT_HOURS);

/** 予約の経路（reservations.channel）。 */
export const RESERVATION_CHANNELS = ['WEB', 'FRONT'] as const;
export type ReservationChannel = (typeof RESERVATION_CHANNELS)[number];
export const ReservationChannelSchema = z.enum(RESERVATION_CHANNELS);

/** 上位タイプへの移動の無償・有償（reservation_rooms.upgrade_kind）。 */
export const UPGRADE_KINDS = ['COMPLIMENTARY', 'PAID'] as const;
export type UpgradeKind = (typeof UPGRADE_KINDS)[number];
export const UpgradeKindSchema = z.enum(UPGRADE_KINDS);

/** 部屋×宿泊日の占有の種類（room_nights.kind。確保中・確定）。 */
export const ROOM_NIGHT_KINDS = ['HOLD', 'BOOKED'] as const;
export type RoomNightKind = (typeof ROOM_NIGHT_KINDS)[number];
export const RoomNightKindSchema = z.enum(ROOM_NIGHT_KINDS);

/** 請求の明細の区分（charge_lines.category）。 */
export const CHARGE_CATEGORIES = [
  'ROOM',
  'BREAKFAST',
  'EARLY_CHECKIN',
  'LATE_CHECKOUT',
  'UPGRADE',
  'DOWNGRADE_ADJUSTMENT',
  'CANCELLATION_FEE',
  'NO_SHOW_FEE',
  'LODGING_TAX',
] as const;
export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number];
export const ChargeCategorySchema = z.enum(CHARGE_CATEGORIES);

/** 請求の明細の精算先（charge_lines.settlement。事前決済・現地）。 */
export const CHARGE_SETTLEMENTS = ['PREPAID', 'ONSITE'] as const;
export type ChargeSettlement = (typeof CHARGE_SETTLEMENTS)[number];
export const ChargeSettlementSchema = z.enum(CHARGE_SETTLEMENTS);

/** 入金・返金の記録の種類（payments.kind）。 */
export const PAYMENT_KINDS = [
  'CHARGE',
  'REFUND',
  'ONSITE_RECEIPT',
  'ONSITE_REFUND',
  'FEE_CHARGE',
] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const PaymentKindSchema = z.enum(PAYMENT_KINDS);

/** 入金・返金の記録の手段（payments.method）。 */
export const PAYMENT_RECORD_METHODS = [
  'CARD_ON_FILE',
  'CASH',
  'CARD',
  'BANK_TRANSFER',
  'OTHER',
] as const;
export type PaymentRecordMethod = (typeof PAYMENT_RECORD_METHODS)[number];
export const PaymentRecordMethodSchema = z.enum(PAYMENT_RECORD_METHODS);

/** 入金・返金の記録の状態（payments.status）。 */
export const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'VOIDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);

/** フロントが記録する現地の入金・払い戻しの向き（POST /reservations/{id}/payments の direction）。 */
export const PAYMENT_DIRECTIONS = ['RECEIPT', 'REFUND'] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];
export const PaymentDirectionSchema = z.enum(PAYMENT_DIRECTIONS);

/** フロントが記録する現地の入金・払い戻しの手段（POST /reservations/{id}/payments の method）。 */
export const ONSITE_PAYMENT_METHODS = [
  'CASH',
  'CARD',
  'BANK_TRANSFER',
  'OTHER',
] as const satisfies readonly PaymentRecordMethod[];
export type OnsitePaymentMethod = (typeof ONSITE_PAYMENT_METHODS)[number];
export const OnsitePaymentMethodSchema = z.enum(ONSITE_PAYMENT_METHODS);

/** お知らせの種類（notices.kind。連泊できない在庫・離れた部屋・前後の客の間が2時間未満）。 */
export const NOTICE_KINDS = ['FRAGMENTED_INVENTORY', 'SPLIT_FLOORS', 'TURNOVER_GAP'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export const NoticeKindSchema = z.enum(NOTICE_KINDS);

/** 年齢区分ごとの人数。 */
export interface GuestCounts {
  adults: number;
  children: number;
  infants: number;
}

// 金額はすべて円の整数。率はベーシスポイント（1% = 100bp）の整数で扱う
export type Yen = number;
export type BasisPoints = number;
