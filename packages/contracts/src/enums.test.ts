import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import {
  AGE_CATEGORIES,
  AgeCategorySchema,
  CHARGE_CATEGORIES,
  CHARGE_SETTLEMENTS,
  ChargeCategorySchema,
  ChargeSettlementSchema,
  EARLY_CHECKIN_HOURS,
  EarlyCheckinHourSchema,
  LATE_CHECKOUT_HOURS,
  LateCheckoutHourSchema,
  LOCALES,
  LocaleSchema,
  NOTICE_KINDS,
  NoticeKindSchema,
  ONSITE_PAYMENT_METHODS,
  OnsitePaymentMethodSchema,
  PAYMENT_DIRECTIONS,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  PAYMENT_RECORD_METHODS,
  PAYMENT_STATUSES,
  PaymentDirectionSchema,
  PaymentKindSchema,
  PaymentMethodSchema,
  PaymentRecordMethodSchema,
  PaymentStatusSchema,
  RESERVATION_CHANNELS,
  RESERVATION_STATUSES,
  ROOM_NIGHT_KINDS,
  ROOM_STATUS_GROUPS,
  ROOM_STATUSES,
  ROOM_STATUSES_BY_GROUP,
  ReservationChannelSchema,
  ReservationStatusSchema,
  RoomNightKindSchema,
  RoomStatusSchema,
  STAFF_ROLES,
  StaffRoleSchema,
  UPGRADE_KINDS,
  UpgradeKindSchema,
} from './enums.js';

interface EnumCase {
  name: string;
  values: readonly (string | number)[];
  schema: ZodType;
  expected: readonly (string | number)[];
  rejected: readonly unknown[];
}

// 期待値は design.md の「共通の型」（packages/contracts/src/enums.ts の抜粋）、
// 「Data Models > Physical Data Model」の各列、社内用 API の表から写したもの。
const ENUM_CASES: EnumCase[] = [
  {
    name: 'Locale（言語）',
    values: LOCALES,
    schema: LocaleSchema,
    expected: ['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant'],
    rejected: ['zh', 'zh-CN', 'ja-JP', 'JA', 'fr', ''],
  },
  {
    name: 'AgeCategory（年齢区分）',
    values: AGE_CATEGORIES,
    schema: AgeCategorySchema,
    expected: ['ADULT', 'CHILD', 'INFANT'],
    rejected: ['adult', 'SENIOR', ''],
  },
  {
    name: 'StaffRole（役割）',
    values: STAFF_ROLES,
    schema: StaffRoleSchema,
    expected: ['ADMIN', 'FRONT', 'CLEANER'],
    rejected: ['MEMBER', 'admin', ''],
  },
  {
    name: 'PaymentMethod（予約の支払い方法）',
    values: PAYMENT_METHODS,
    schema: PaymentMethodSchema,
    expected: ['PREPAID', 'PAY_AT_HOTEL'],
    rejected: ['ONSITE', 'CARD', ''],
  },
  {
    name: 'ReservationStatus（予約の状態）',
    values: RESERVATION_STATUSES,
    schema: ReservationStatusSchema,
    expected: [
      'PENDING_PAYMENT',
      'CONFIRMED',
      'CHECKED_IN',
      'CHECKED_OUT',
      'CANCELLED',
      'NO_SHOW',
      'EXPIRED',
    ],
    rejected: ['HOLD', 'CANCELED', 'confirmed', ''],
  },
  {
    name: 'RoomStatus（部屋の状態）',
    values: ROOM_STATUSES,
    schema: RoomStatusSchema,
    expected: [
      'CLEANING_READY',
      'CLEANING',
      'INSPECTION',
      'CLEAN',
      'STAY_DIRTY',
      'STAY_CLEANING',
      'STAY_INSPECTION',
      'STAY_CLEAN',
      'CHECKED_IN',
      'DEPARTURE_PENDING',
      'NO_ARRIVAL',
      'OUT_OF_ORDER',
    ],
    rejected: ['DIRTY', 'VACANT', 'clean', ''],
  },
  {
    name: 'EarlyCheckinHour（アーリーチェックインの時刻）',
    values: EARLY_CHECKIN_HOURS,
    schema: EarlyCheckinHourSchema,
    expected: [12, 13, 14],
    rejected: [11, 15, 12.5, '12', null],
  },
  {
    name: 'LateCheckoutHour（レイトチェックアウトの時刻）',
    values: LATE_CHECKOUT_HOURS,
    schema: LateCheckoutHourSchema,
    expected: [13, 14, 15],
    rejected: [12, 16, 13.5, '13', null],
  },
  {
    name: 'ReservationChannel（reservations.channel）',
    values: RESERVATION_CHANNELS,
    schema: ReservationChannelSchema,
    expected: ['WEB', 'FRONT'],
    rejected: ['PHONE', 'OTA', ''],
  },
  {
    name: 'UpgradeKind（reservation_rooms.upgrade_kind）',
    values: UPGRADE_KINDS,
    schema: UpgradeKindSchema,
    expected: ['COMPLIMENTARY', 'PAID'],
    rejected: ['FREE', 'paid', ''],
  },
  {
    name: 'RoomNightKind（room_nights.kind）',
    values: ROOM_NIGHT_KINDS,
    schema: RoomNightKindSchema,
    expected: ['HOLD', 'BOOKED'],
    rejected: ['PENDING', 'CONFIRMED', ''],
  },
  {
    name: 'ChargeCategory（charge_lines.category）',
    values: CHARGE_CATEGORIES,
    schema: ChargeCategorySchema,
    expected: [
      'ROOM',
      'BREAKFAST',
      'EARLY_CHECKIN',
      'LATE_CHECKOUT',
      'UPGRADE',
      'DOWNGRADE_ADJUSTMENT',
      'CANCELLATION_FEE',
      'NO_SHOW_FEE',
      'LODGING_TAX',
    ],
    rejected: ['TAX', 'DINNER', ''],
  },
  {
    name: 'ChargeSettlement（charge_lines.settlement）',
    values: CHARGE_SETTLEMENTS,
    schema: ChargeSettlementSchema,
    expected: ['PREPAID', 'ONSITE'],
    rejected: ['PREPAID_ELIGIBLE', 'ONSITE_ONLY', 'PAY_AT_HOTEL', ''],
  },
  {
    name: 'PaymentKind（payments.kind）',
    values: PAYMENT_KINDS,
    schema: PaymentKindSchema,
    expected: ['CHARGE', 'REFUND', 'ONSITE_RECEIPT', 'ONSITE_REFUND', 'FEE_CHARGE'],
    rejected: ['RECEIPT', 'FEE', ''],
  },
  {
    name: 'PaymentRecordMethod（payments.method）',
    values: PAYMENT_RECORD_METHODS,
    schema: PaymentRecordMethodSchema,
    expected: ['CARD_ON_FILE', 'CASH', 'CARD', 'BANK_TRANSFER', 'OTHER'],
    rejected: ['PREPAID', 'cash', ''],
  },
  {
    name: 'PaymentStatus（payments.status）',
    values: PAYMENT_STATUSES,
    schema: PaymentStatusSchema,
    expected: ['PENDING', 'SUCCEEDED', 'FAILED', 'VOIDED'],
    rejected: ['DECLINED', 'SUCCESS', ''],
  },
  {
    name: 'PaymentDirection（POST /reservations/{id}/payments の direction）',
    values: PAYMENT_DIRECTIONS,
    schema: PaymentDirectionSchema,
    expected: ['RECEIPT', 'REFUND'],
    rejected: ['CHARGE', 'ONSITE_RECEIPT', ''],
  },
  {
    name: 'OnsitePaymentMethod（POST /reservations/{id}/payments の method）',
    values: ONSITE_PAYMENT_METHODS,
    schema: OnsitePaymentMethodSchema,
    expected: ['CASH', 'CARD', 'BANK_TRANSFER', 'OTHER'],
    rejected: ['CARD_ON_FILE', 'PAY_AT_HOTEL', ''],
  },
  {
    name: 'NoticeKind（notices.kind）',
    values: NOTICE_KINDS,
    schema: NoticeKindSchema,
    expected: ['FRAGMENTED_INVENTORY', 'SPLIT_FLOORS', 'TURNOVER_GAP'],
    rejected: ['WARNING', 'OUT_OF_ORDER', ''],
  },
];

describe('列挙の値', () => {
  it.each(ENUM_CASES)('$name は設計の値と同じ値を同じ順で持つ', ({ values, expected }) => {
    expect([...values]).toEqual([...expected]);
  });

  it.each(ENUM_CASES)('$name のスキーマは設計の値をすべて受け付ける', ({ schema, expected }) => {
    for (const value of expected) {
      expect(schema.safeParse(value).success).toBe(true);
    }
  });

  it.each(ENUM_CASES)('$name のスキーマは設計にない値を拒否する', ({ schema, rejected }) => {
    for (const value of rejected) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });
});

describe('部屋の状態のグループ', () => {
  it('グループは空室の清掃（VACANT）・連泊（STAY）・その他（OTHER）の3つ', () => {
    expect([...ROOM_STATUS_GROUPS]).toEqual(['VACANT', 'STAY', 'OTHER']);
  });

  it('空室の清掃グループは、清掃可・清掃中・点検待ち・清掃完了の4つ', () => {
    expect([...ROOM_STATUSES_BY_GROUP.VACANT]).toEqual([
      'CLEANING_READY',
      'CLEANING',
      'INSPECTION',
      'CLEAN',
    ]);
  });

  it('連泊グループは、清掃有・清掃中・点検待ち・清掃完了（いずれも連泊）の4つ', () => {
    expect([...ROOM_STATUSES_BY_GROUP.STAY]).toEqual([
      'STAY_DIRTY',
      'STAY_CLEANING',
      'STAY_INSPECTION',
      'STAY_CLEAN',
    ]);
  });

  it('その他のグループは、チェックイン済み・チェックアウト待ち・来客なし・故障中の4つ', () => {
    expect([...ROOM_STATUSES_BY_GROUP.OTHER]).toEqual([
      'CHECKED_IN',
      'DEPARTURE_PENDING',
      'NO_ARRIVAL',
      'OUT_OF_ORDER',
    ]);
  });

  it('すべての部屋の状態が、ちょうど1つのグループに属する', () => {
    const grouped = ROOM_STATUS_GROUPS.flatMap((group) => [...ROOM_STATUSES_BY_GROUP[group]]);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...ROOM_STATUSES].sort());
  });
});

describe('列挙どうしの関係', () => {
  it('フロントが記録する入金・払い戻しの手段は、payments.method の値に含まれる', () => {
    for (const method of ONSITE_PAYMENT_METHODS) {
      expect(PAYMENT_RECORD_METHODS).toContain(method);
    }
  });
});
