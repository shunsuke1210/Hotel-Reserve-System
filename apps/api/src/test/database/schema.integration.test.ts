// データベースのスキーマ（design.md Physical Data Model）と、データベースが保証する制約を確かめる（tasks.md 1.4）。
// テストのファイルごとに、マイグレーションを適用した空のデータベースを作って使う（test-database.ts）。
import {
  AGE_CATEGORIES,
  CHARGE_CATEGORIES,
  CHARGE_SETTLEMENTS,
  EARLY_CHECKIN_HOURS,
  LATE_CHECKOUT_HOURS,
  LOCALES,
  NOTICE_KINDS,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  PAYMENT_RECORD_METHODS,
  PAYMENT_STATUSES,
  RESERVATION_CHANNELS,
  RESERVATION_STATUSES,
  ROOM_NIGHT_KINDS,
  ROOM_STATUSES,
  STAFF_ROLES,
  UPGRADE_KINDS,
} from '@hotel/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../../shared/prisma/prisma-errors.js';
import { checkSchemaDrift } from '../../../prisma/scripts/database-admin.js';
import { connectPg, createTestDatabase, type TestDatabase } from './test-database.js';

/**
 * design.md の Physical Data Model の表と列（created_at は全テーブルにあるので省略している）。
 * 型：uuid・text・int・date・tstz・bool・jsonb。末尾の ? は null を許す列。
 */
const PHYSICAL_DATA_MODEL: Record<string, string> = {
  // マスタ・設定
  room_types:
    'id uuid, code text, name_ja text, area_sqm int, bed_description_ja text, capacity_adults int, standard_occupancy int, display_order int, description_ja text',
  rooms:
    'id uuid, room_number int, floor int, room_type_id uuid, is_accessible bool, status text, status_changed_at tstz, status_changed_by uuid?',
  rate_versions:
    'id uuid, effective_from tstz, weekend_surcharge_bp int, headcount_tiers jsonb, stay_tiers jsonb, early_bird_bp int, rate_floor_bp int, consumption_tax_bp int, breakfast_price_excl int, off_hours_price_per_hour_incl int, lodging_tax_brackets jsonb',
  room_type_prices: 'rate_version_id uuid, room_type_id uuid, base_price_excl int',
  special_surcharge_periods:
    'id uuid, start_date date, end_date date, rate_bp int, created_by uuid, deleted_at tstz?',
  holidays: 'date date, name text',
  terms_documents: 'id uuid, version int, body_ja text, published_at tstz',
  translations:
    'id uuid, entity_type text, entity_id text, field text, locale text, text text, source_hash text, is_edited bool',
  roster_fields: 'key text, label_ja text, required bool, active bool',
  // 会員・スタッフ・認証
  members:
    'id uuid, status text, email text, phone text, password_hash text?, family_name text, given_name text, postal_code text, address text, country text, is_foreign_non_resident bool, nationality text?, passport_number text?, birth_date date, preferred_locale text, email_verified_at tstz?, withdrawn_at tstz?, last_stay_date date?',
  member_cards:
    'member_id uuid, payment_token text, brand text, last4 text, exp_month int, exp_year int',
  marketing_consents: 'id uuid, member_id uuid, consented bool, method text, recorded_at tstz',
  auth_tokens:
    'id uuid, member_id uuid, purpose text, token_hash text, new_email text?, expires_at tstz, used_at tstz?',
  sessions: 'id text, realm text, subject_id uuid, expires_at tstz, last_seen_at tstz',
  staff: 'id uuid, staff_number text, name text, role text, password_hash text, is_active bool',
  // 予約・在庫・料金
  reservations:
    'id uuid, reservation_number text?, member_id uuid?, channel text, status text, payment_method text, room_type_id uuid, arrival_date date, departure_date date, adults int, children int, infants int, breakfast_adults int, breakfast_children int, breakfast_infants int, early_bird bool, is_group bool, max_room_count int, booker_is_guest bool, arrival_eta text?, companions_on_site bool, terms_version int?, terms_agreed_at tstz?, hold_expires_at tstz?, confirmed_at tstz?, no_show_at tstz?, no_show_deferred_until tstz?, cancelled_at tstz?, checked_in_at tstz?, checked_out_at tstz?, version int, creation_idempotency_key text?',
  reservation_rooms:
    'id uuid, reservation_id uuid, room_id uuid?, current_room_type_id uuid, early_checkin_hour int?, late_checkout_hour int?, upgrade_kind text?, room_guest_counts jsonb?, cancelled_at tstz?',
  room_nights: 'id uuid, reservation_room_id uuid, room_id uuid, stay_date date, kind text',
  stay_night_prices:
    'id uuid, reservation_id uuid, stay_date date, rate_version_id uuid, base_price_excl int, surcharge_bp int, early_bird_eligible bool, added_at tstz, voided_at tstz?',
  charge_lines:
    'id uuid, reservation_id uuid, reservation_room_id uuid?, category text, stay_date date?, age_category text?, quantity int, unit_price_incl int, amount_incl int, settlement text, rate_version_id uuid, voided_at tstz?, voided_reason text?, created_by text',
  payments:
    'id uuid, reservation_id uuid, kind text, amount int, method text, provider_ref text?, idempotency_key text, status text, staff_id uuid?',
  roster_entries:
    'id uuid, reservation_id uuid, is_booker bool, age_category text, family_name text?, given_name text?, address text?, contact text?, is_foreign_non_resident bool, nationality text?, passport_number text?, extra jsonb, source text',
  // 運用
  out_of_order_periods:
    'id uuid, room_id uuid, start_date date, end_date date, reason text, ended_at tstz?, created_by uuid',
  notices:
    'id uuid, kind text, dedupe_key text, message text, room_type_id uuid?, room_id uuid?, reservation_id uuid?, date_from date, date_to date, resolved_at tstz?, resolved_by uuid?',
  audit_logs:
    'id uuid, staff_id uuid?, actor_label text, action text, target_type text, target_id text, detail jsonb, at tstz',
  mail_outbox:
    'id uuid, member_id uuid?, to_address text, locale text, template text, payload jsonb, status text, attempts int, sent_at tstz?',
  mail_campaigns:
    'id uuid, subject_ja text, body_ja text, send_at tstz, repeat text, active bool, created_by uuid',
  hotel_settings: 'key text, value text',
  job_runs: 'id uuid, job text, started_at tstz, finished_at tstz?, result text, detail jsonb',
};

/** 主キー（design.md の PK） */
const PRIMARY_KEYS: Record<string, string> = {
  room_type_prices: 'rate_version_id, room_type_id',
  holidays: 'date',
  roster_fields: 'key',
  member_cards: 'member_id',
  hotel_settings: 'key',
};

/** 主キー以外のインデックス（design.md の「制約・インデックス」）。「USING btree」より後ろの部分 */
const INDEXES: Record<string, string> = {
  room_types_code_key: 'UNIQUE room_types (code)',
  rooms_room_number_key: 'UNIQUE rooms (room_number)',
  rooms_room_type_id_floor_idx: 'rooms (room_type_id, floor)',
  rate_versions_effective_from_key: 'UNIQUE rate_versions (effective_from)',
  terms_documents_version_key: 'UNIQUE terms_documents (version)',
  translations_entity_type_entity_id_field_locale_key:
    'UNIQUE translations (entity_type, entity_id, field, locale)',
  members_email_active_key:
    "UNIQUE members (lower(email)) WHERE (status = ANY (ARRAY['PENDING'::text, 'ACTIVE'::text]))",
  members_phone_active_key:
    "UNIQUE members (phone) WHERE (status = ANY (ARRAY['PENDING'::text, 'ACTIVE'::text]))",
  auth_tokens_token_hash_key: 'UNIQUE auth_tokens (token_hash)',
  sessions_realm_subject_id_idx: 'sessions (realm, subject_id)',
  staff_staff_number_key: 'UNIQUE staff (staff_number)',
  reservations_reservation_number_key: 'UNIQUE reservations (reservation_number)',
  reservations_creation_idempotency_key_key: 'UNIQUE reservations (creation_idempotency_key)',
  reservations_member_id_pending_payment_key:
    "UNIQUE reservations (member_id) WHERE ((status = 'PENDING_PAYMENT'::text) AND (channel = 'WEB'::text))",
  reservations_member_id_status_idx: 'reservations (member_id, status)',
  reservations_arrival_date_status_idx: 'reservations (arrival_date, status)',
  reservation_rooms_reservation_id_idx: 'reservation_rooms (reservation_id)',
  room_nights_room_id_stay_date_key: 'UNIQUE room_nights (room_id, stay_date)',
  room_nights_stay_date_idx: 'room_nights (stay_date)',
  stay_night_prices_reservation_id_stay_date_active_key:
    'UNIQUE stay_night_prices (reservation_id, stay_date) WHERE (voided_at IS NULL)',
  charge_lines_reservation_id_voided_at_idx: 'charge_lines (reservation_id, voided_at)',
  payments_idempotency_key_key: 'UNIQUE payments (idempotency_key)',
  roster_entries_reservation_id_idx: 'roster_entries (reservation_id)',
  out_of_order_periods_room_id_start_date_end_date_idx:
    'out_of_order_periods (room_id, start_date, end_date)',
  notices_dedupe_key_unresolved_key: 'UNIQUE notices (dedupe_key) WHERE (resolved_at IS NULL)',
  mail_outbox_status_idx: 'mail_outbox (status)',
};

/** 外部キー（design.md で FK と書いた列だけ） */
const FOREIGN_KEYS = [
  'rooms.room_type_id -> room_types',
  'room_type_prices.rate_version_id -> rate_versions',
  'room_type_prices.room_type_id -> room_types',
  'member_cards.member_id -> members',
  'marketing_consents.member_id -> members',
  'auth_tokens.member_id -> members',
  'reservations.member_id -> members',
  'reservations.room_type_id -> room_types',
  'reservation_rooms.reservation_id -> reservations',
  'reservation_rooms.room_id -> rooms',
  'reservation_rooms.current_room_type_id -> room_types',
  'room_nights.reservation_room_id -> reservation_rooms',
  'room_nights.room_id -> rooms',
  'stay_night_prices.reservation_id -> reservations',
  'stay_night_prices.rate_version_id -> rate_versions',
  'charge_lines.reservation_id -> reservations',
  'charge_lines.rate_version_id -> rate_versions',
  'payments.reservation_id -> reservations',
  'roster_entries.reservation_id -> reservations',
  'out_of_order_periods.room_id -> rooms',
];

/** 列挙の列と、取りうる値（contracts の列挙。contracts にないものは design.md の値） */
const ENUM_COLUMNS: Record<string, readonly (string | number)[]> = {
  'rooms.status': ROOM_STATUSES,
  'translations.locale': LOCALES,
  'members.status': ['PENDING', 'ACTIVE', 'WITHDRAWN'],
  'members.preferred_locale': LOCALES,
  'marketing_consents.method': ['REGISTRATION', 'PROFILE', 'UNSUBSCRIBE_LINK'],
  'auth_tokens.purpose': ['VERIFY_EMAIL', 'RESET_PASSWORD'],
  'sessions.realm': ['MEMBER', 'STAFF'],
  'staff.role': STAFF_ROLES,
  'reservations.channel': RESERVATION_CHANNELS,
  'reservations.status': RESERVATION_STATUSES,
  'reservations.payment_method': PAYMENT_METHODS,
  'reservation_rooms.early_checkin_hour': EARLY_CHECKIN_HOURS,
  'reservation_rooms.late_checkout_hour': LATE_CHECKOUT_HOURS,
  'reservation_rooms.upgrade_kind': UPGRADE_KINDS,
  'room_nights.kind': ROOM_NIGHT_KINDS,
  'charge_lines.category': CHARGE_CATEGORIES,
  'charge_lines.age_category': AGE_CATEGORIES,
  'charge_lines.settlement': CHARGE_SETTLEMENTS,
  'payments.kind': PAYMENT_KINDS,
  'payments.method': PAYMENT_RECORD_METHODS,
  'payments.status': PAYMENT_STATUSES,
  'roster_entries.age_category': AGE_CATEGORIES,
  'roster_entries.source': RESERVATION_CHANNELS,
  'notices.kind': NOTICE_KINDS,
  'mail_outbox.locale': LOCALES,
  'mail_outbox.status': ['PENDING', 'SENT', 'FAILED'],
  'mail_campaigns.repeat': ['NONE', 'WEEKLY', 'MONTHLY'],
};

const PG_TYPES: Record<string, string> = {
  uuid: 'uuid',
  text: 'text',
  int: 'integer',
  date: 'date',
  tstz: 'timestamp with time zone',
  bool: 'boolean',
  jsonb: 'jsonb',
};

/** 'id uuid, x text?' → ['id uuid NOT NULL', 'x text NULL', …, 'created_at timestamp with time zone NOT NULL'] */
function expectedColumns(spec: string): string[] {
  const columns = spec.split(',').map((part) => {
    const [name, rawType] = part.trim().split(/\s+/);
    const nullable = rawType!.endsWith('?');
    const type = PG_TYPES[rawType!.replace('?', '')];
    if (!name || !type) throw new Error(`表の定義の誤り：${part}`);
    return `${name} ${type} ${nullable ? 'NULL' : 'NOT NULL'}`;
  });
  return [...columns, 'created_at timestamp with time zone NOT NULL'].sort();
}

const DATE = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const AT = (iso: string): Date => new Date(iso);

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

// --- 前提のデータ（テストごとに必要な行だけを作る） ---

async function createRoomType(code = `T${randomUUID().slice(0, 8)}`) {
  return db.prisma.roomType.create({
    data: {
      code,
      nameJa: 'スタンダード ツイン',
      areaSqm: 25,
      bedDescriptionJa: 'シングル2台',
      capacityAdults: 2,
      standardOccupancy: 2,
      displayOrder: 1,
      descriptionJa: '説明',
    },
  });
}

let nextRoomNumber = 401;
async function createRoom(roomTypeId: string) {
  return db.prisma.room.create({
    data: {
      roomNumber: nextRoomNumber++,
      floor: 4,
      roomTypeId,
      isAccessible: false,
      status: 'CLEAN',
      statusChangedAt: AT('2026-11-01T00:00:00Z'),
    },
  });
}

let nextPhone = 9_012_340_000;
async function createMember(
  overrides: Partial<{ status: string; email: string; phone: string }> = {},
) {
  return db.prisma.member.create({
    data: {
      status: 'ACTIVE',
      email: `m-${randomUUID()}@example.com`,
      phone: `0${nextPhone++}`,
      passwordHash: 'argon2id$dummy',
      familyName: '山田',
      givenName: '太郎',
      postalCode: '9200000',
      address: '石川県金沢市',
      country: 'JP',
      isForeignNonResident: false,
      birthDate: DATE('1990-04-01'),
      preferredLocale: 'ja',
      ...overrides,
    },
  });
}

/** 10文字の予約番号（テスト用） */
const newReservationNumber = (): string =>
  randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();

async function createReservation(
  roomTypeId: string,
  overrides: Partial<{
    reservationNumber: string | null;
    memberId: string | null;
    channel: string;
    status: string;
    creationIdempotencyKey: string | null;
  }> = {},
) {
  const status = overrides.status ?? 'CONFIRMED';
  return db.prisma.reservation.create({
    data: {
      // 予約番号は確定の時点で発行する。決済待ち（確保の間）は空（L-52）
      reservationNumber: status === 'PENDING_PAYMENT' ? null : newReservationNumber(),
      memberId: null,
      channel: 'WEB',
      status: 'CONFIRMED',
      paymentMethod: 'PREPAID',
      roomTypeId,
      arrivalDate: DATE('2026-12-01'),
      departureDate: DATE('2026-12-03'),
      adults: 2,
      children: 0,
      infants: 0,
      breakfastAdults: 0,
      breakfastChildren: 0,
      breakfastInfants: 0,
      earlyBird: false,
      isGroup: false,
      maxRoomCount: 1,
      bookerIsGuest: true,
      companionsOnSite: false,
      version: 1,
      ...overrides,
    },
  });
}

async function createReservationRoom(reservationId: string, roomTypeId: string, roomId: string) {
  return db.prisma.reservationRoom.create({
    data: { reservationId, roomId, currentRoomTypeId: roomTypeId },
  });
}

/** effective_from は一意なので、版ごとに1日ずつずらす */
let nextRateVersionDay = 1;
async function createRateVersion() {
  const day = String(nextRateVersionDay++).padStart(2, '0');
  return db.prisma.rateVersion.create({
    data: {
      effectiveFrom: AT(`2026-01-${day}T00:00:00+09:00`),
      weekendSurchargeBp: 2000,
      headcountTiers: [],
      stayTiers: [],
      earlyBirdBp: 1000,
      rateFloorBp: -5000,
      consumptionTaxBp: 1000,
      breakfastPriceExcl: 3500,
      offHoursPricePerHourIncl: 1000,
      lodgingTaxBrackets: [],
    },
  });
}

/** 一意制約の違反で拒否されることを確かめる */
async function expectUniqueViolation(promise: Promise<unknown>, constraint: string): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error, `${constraint} の違反で拒否されるはずが、成功した`).toBeDefined();
  expect(isUniqueViolation(error, constraint), String(error)).toBe(true);
}

describe('スキーマの適用（design.md Physical Data Model）', () => {
  it('[1.3][4.18][9.1][10.9][18.2] マイグレーションをすべて適用した、空のテスト用データベースが用意される', async () => {
    // ほかのテストの行に左右されないように、このテストだけのデータベースで確かめる
    const fresh = await createTestDatabase();
    const owner = await connectPg(fresh.ownerUrl);
    try {
      const migrations = await owner.query<{ migration_name: string; ok: boolean }>(
        `SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok
           FROM _prisma_migrations ORDER BY migration_name`,
      );
      expect(migrations.rows.length).toBeGreaterThan(0);
      expect(migrations.rows.every((row) => row.ok)).toBe(true);

      for (const table of Object.keys(PHYSICAL_DATA_MODEL)) {
        const { rows } = await owner.query<{ count: string }>(
          `SELECT count(*) AS count FROM ${table}`,
        );
        expect(Number(rows[0]?.count), `${table} が空でない`).toBe(0);
      }
    } finally {
      await owner.end();
      await fresh.drop();
    }
  });

  it('Physical Data Model のすべてのテーブルが、design.md のとおりの列・型・null の可否で作られている', async () => {
    const owner = await connectPg(db.ownerUrl);
    try {
      const { rows } = await owner.query<{
        table_name: string;
        column: string;
      }>(
        `SELECT table_name,
                column_name || ' ' || data_type || ' ' ||
                  CASE is_nullable WHEN 'YES' THEN 'NULL' ELSE 'NOT NULL' END AS column
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'`,
      );
      const actual: Record<string, string[]> = {};
      for (const row of rows) (actual[row.table_name] ??= []).push(row.column);
      for (const columns of Object.values(actual)) columns.sort();

      const expected = Object.fromEntries(
        Object.entries(PHYSICAL_DATA_MODEL).map(([table, spec]) => [table, expectedColumns(spec)]),
      );
      expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
      expect(actual).toEqual(expected);
    } finally {
      await owner.end();
    }
  });

  it('主キー・インデックス・外部キーが design.md の「制約・インデックス」のとおりにある', async () => {
    const owner = await connectPg(db.ownerUrl);
    try {
      const primaryKeys = await owner.query<{ table: string; columns: string }>(
        `SELECT c.conrelid::regclass::text AS table,
                string_agg(a.attname, ', ' ORDER BY k.ord) AS columns
           FROM pg_constraint c
           CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
          WHERE c.contype = 'p' AND c.connamespace = 'public'::regnamespace
            AND c.conrelid::regclass::text <> '_prisma_migrations'
          GROUP BY c.conrelid`,
      );
      const expectedPrimaryKeys = Object.fromEntries(
        Object.keys(PHYSICAL_DATA_MODEL).map((table) => [table, PRIMARY_KEYS[table] ?? 'id']),
      );
      expect(Object.fromEntries(primaryKeys.rows.map((row) => [row.table, row.columns]))).toEqual(
        expectedPrimaryKeys,
      );

      const indexes = await owner.query<{ name: string; definition: string }>(
        `SELECT indexname AS name,
                regexp_replace(indexdef, '^CREATE (UNIQUE )?INDEX \\S+ ON public\\.(\\S+) USING btree ', '\\1\\2 ')
                  AS definition
           FROM pg_indexes
          WHERE schemaname = 'public' AND indexname NOT LIKE '%\\_pkey'`,
      );
      expect(Object.fromEntries(indexes.rows.map((row) => [row.name, row.definition]))).toEqual(
        INDEXES,
      );

      const foreignKeys = await owner.query<{ fk: string }>(
        `SELECT c.conrelid::regclass::text || '.' || a.attname || ' -> ' || c.confrelid::regclass::text AS fk
           FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
          WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`,
      );
      expect(foreignKeys.rows.map((row) => row.fk).sort()).toEqual([...FOREIGN_KEYS].sort());
    } finally {
      await owner.end();
    }
  });

  it('列挙の列は、contracts の列挙と同じ値だけを CHECK 制約で受け付ける', async () => {
    const owner = await connectPg(db.ownerUrl);
    try {
      const { rows } = await owner.query<{ name: string; definition: string }>(
        `SELECT conname AS name, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE contype = 'c' AND connamespace = 'public'::regnamespace`,
      );
      const actual = Object.fromEntries(
        rows.map((row) => [
          row.name,
          [...row.definition.matchAll(/'([^']*)'::text|\b(\d+)\b/g)].map((match) =>
            match[1] !== undefined ? match[1] : Number(match[2]),
          ),
        ]),
      );
      const expected = Object.fromEntries(
        Object.entries(ENUM_COLUMNS).map(([column, values]) => [
          `${column.replace('.', '_')}_check`,
          [...values],
        ]),
      );
      expect(actual).toEqual(expected);
    } finally {
      await owner.end();
    }

    // 決まった値以外は拒否される
    const roomType = await createRoomType();
    await expect(
      db.prisma.room.create({
        data: {
          roomNumber: 9999,
          floor: 99,
          roomTypeId: roomType.id,
          isAccessible: false,
          status: 'BROKEN',
          statusChangedAt: AT('2026-11-01T00:00:00Z'),
        },
      }),
    ).rejects.toThrow(/rooms_status_check/);
  });

  it('スキーマの定義（schema.prisma）とマイグレーションの結果に差がない', async () => {
    const drift = await checkSchemaDrift({ ownerUrl: db.ownerUrl, appUrl: db.appUrl });
    expect(drift).toEqual({ hasDrift: false, summary: expect.any(String) });
  }, 120_000);
});

describe('[9.1] 部屋×宿泊日の一意制約（二重割り当ての防止。ADR-06）', () => {
  it('[9.1] 同じ部屋・同じ宿泊日の room_nights の2行目は、データベースが拒否する', async () => {
    const roomType = await createRoomType();
    const room = await createRoom(roomType.id);
    const otherRoom = await createRoom(roomType.id);
    const first = await createReservation(roomType.id);
    const second = await createReservation(roomType.id);
    const firstRoom = await createReservationRoom(first.id, roomType.id, room.id);
    const secondRoom = await createReservationRoom(second.id, roomType.id, room.id);

    await db.prisma.roomNight.create({
      data: {
        reservationRoomId: firstRoom.id,
        roomId: room.id,
        stayDate: DATE('2026-12-01'),
        kind: 'BOOKED',
      },
    });
    await expectUniqueViolation(
      db.prisma.roomNight.create({
        data: {
          reservationRoomId: secondRoom.id,
          roomId: room.id,
          stayDate: DATE('2026-12-01'),
          kind: 'HOLD',
        },
      }),
      'room_nights_room_id_stay_date_key',
    );

    // 別の日・別の部屋なら入る
    await db.prisma.roomNight.create({
      data: {
        reservationRoomId: secondRoom.id,
        roomId: room.id,
        stayDate: DATE('2026-12-02'),
        kind: 'HOLD',
      },
    });
    await db.prisma.roomNight.create({
      data: {
        reservationRoomId: secondRoom.id,
        roomId: otherRoom.id,
        stayDate: DATE('2026-12-01'),
        kind: 'HOLD',
      },
    });
    const nights = await db.prisma.roomNight.findMany({
      where: { roomId: room.id, stayDate: DATE('2026-12-01') },
    });
    expect(nights.map((night) => night.reservationRoomId)).toEqual([firstRoom.id]);
  });

  it('[9.1] 同じ部屋・同じ宿泊日を同時に確保しても、片方だけが成功する', async () => {
    const roomType = await createRoomType();
    const room = await createRoom(roomType.id);
    const holds = await Promise.all(
      [0, 1].map(async () => {
        const reservation = await createReservation(roomType.id, { status: 'PENDING_PAYMENT' });
        return createReservationRoom(reservation.id, roomType.id, room.id);
      }),
    );

    const results = await Promise.allSettled(
      holds.map((hold) =>
        db.prisma.$transaction(async (tx) => {
          await tx.roomNight.create({
            data: {
              reservationRoomId: hold.id,
              roomId: room.id,
              stayDate: DATE('2026-12-10'),
              kind: 'HOLD',
            },
          });
          await tx.roomNight.create({
            data: {
              reservationRoomId: hold.id,
              roomId: room.id,
              stayDate: DATE('2026-12-11'),
              kind: 'HOLD',
            },
          });
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(isUniqueViolation(rejected?.reason, 'room_nights_room_id_stay_date_key')).toBe(true);
    // 負けた側の夜は1つも残らない（トランザクションごと取り消される）
    const nights = await db.prisma.roomNight.findMany({ where: { roomId: room.id } });
    expect(nights).toHaveLength(2);
    expect(new Set(nights.map((night) => night.reservationRoomId)).size).toBe(1);
  });
});

describe('[1.3] メールアドレス・電話番号は有効な会員（PENDING・ACTIVE）の間で一意', () => {
  it('[1.3] 有効な会員と同じメールアドレス（大文字・小文字の違いを含む）・電話番号の会員は登録できない', async () => {
    const active = await createMember({ email: 'Hanako@Example.com', phone: '0761234567' });
    await expectUniqueViolation(
      createMember({ status: 'PENDING', email: 'hanako@example.COM' }),
      'members_email_active_key',
    );
    await expectUniqueViolation(
      createMember({ status: 'PENDING', phone: active.phone }),
      'members_phone_active_key',
    );
  });

  it('[1.3] 退会（WITHDRAWN）した会員・削除した会員と同じメールアドレス・電話番号なら登録できる', async () => {
    const withdrawn = await createMember({ email: 'jiro@example.com', phone: '0769999999' });
    await db.prisma.member.update({ where: { id: withdrawn.id }, data: { status: 'WITHDRAWN' } });
    const again = await createMember({ email: 'JIRO@example.com', phone: '0769999999' });
    expect(again.status).toBe('ACTIVE');

    // 退会した行が複数あってもよい
    await db.prisma.member.update({ where: { id: again.id }, data: { status: 'WITHDRAWN' } });
    const third = await createMember({ email: 'jiro@example.com', phone: '0769999999' });

    // 削除した会員（自動削除など）の後も登録できる
    await db.prisma.member.delete({ where: { id: third.id } });
    await expect(
      createMember({ status: 'PENDING', email: 'jiro@example.com', phone: '0769999999' }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });
});

describe('[4.18] 同じ会員の決済待ち（PENDING_PAYMENT）は1件まで', () => {
  it('[4.18] 同じ会員の Web の決済待ちの2件目はデータベースが拒否し、ほかの会員や確定・期限切れの後は入る', async () => {
    const roomType = await createRoomType();
    const member = await createMember();
    const otherMember = await createMember();

    const hold = await createReservation(roomType.id, {
      memberId: member.id,
      status: 'PENDING_PAYMENT',
    });
    await expectUniqueViolation(
      createReservation(roomType.id, { memberId: member.id, status: 'PENDING_PAYMENT' }),
      'reservations_member_id_pending_payment_key',
    );
    // ほかの会員は確保できる（TC-RS-122）
    await createReservation(roomType.id, { memberId: otherMember.id, status: 'PENDING_PAYMENT' });

    // 期限切れ（EXPIRED）にした後は、次の確保ができる（TC-RS-124）
    await db.prisma.reservation.update({ where: { id: hold.id }, data: { status: 'EXPIRED' } });
    const next = await createReservation(roomType.id, {
      memberId: member.id,
      status: 'PENDING_PAYMENT',
    });
    // 確定（CONFIRMED）した後も、次の確保ができる（TC-RS-123）
    await db.prisma.reservation.update({ where: { id: next.id }, data: { status: 'CONFIRMED' } });
    await createReservation(roomType.id, { memberId: member.id, status: 'PENDING_PAYMENT' });
  });

  it('[4.18] フロントの登録（確保と確定を続けて行う）には当てない（DT-M10・TC-RS-220）', async () => {
    const roomType = await createRoomType();
    const member = await createMember();
    await createReservation(roomType.id, { memberId: member.id, status: 'PENDING_PAYMENT' });
    const front = await createReservation(roomType.id, {
      memberId: member.id,
      channel: 'FRONT',
      status: 'PENDING_PAYMENT',
    });
    expect(front.status).toBe('PENDING_PAYMENT');
  });

  it('[4.18] 同じ会員が同時に2件を確保しても、決済待ちは1件だけ作られる（TC-RS-121）', async () => {
    const roomType = await createRoomType();
    const member = await createMember();
    const results = await Promise.allSettled([
      createReservation(roomType.id, { memberId: member.id, status: 'PENDING_PAYMENT' }),
      createReservation(roomType.id, { memberId: member.id, status: 'PENDING_PAYMENT' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      await db.prisma.reservation.count({
        where: { memberId: member.id, status: 'PENDING_PAYMENT' },
      }),
    ).toBe(1);
  });
});

describe('[10.9] 解決していないお知らせの重複のまとめ（dedupe_key）', () => {
  const notice = (dedupeKey: string) =>
    db.prisma.notice.create({
      data: {
        kind: 'FRAGMENTED_INVENTORY',
        dedupeKey,
        message: '連泊できない在庫なし',
        dateFrom: DATE('2026-12-01'),
        dateTo: DATE('2026-12-03'),
      },
    });

  it('[10.9] 同じ dedupe_key の未解決のお知らせは1件までで、解決した後は新しく作れる', async () => {
    const key = `FRAG:SK:2026-12-01:${randomUUID()}`;
    const first = await notice(key);
    await expectUniqueViolation(notice(key), 'notices_dedupe_key_unresolved_key');

    await db.prisma.notice.update({
      where: { id: first.id },
      data: { resolvedAt: AT('2026-11-20T10:00:00Z'), resolvedBy: randomUUID() },
    });
    const second = await notice(key);
    await db.prisma.notice.update({
      where: { id: second.id },
      data: { resolvedAt: AT('2026-11-21T10:00:00Z') },
    });
    await notice(key);

    expect(await db.prisma.notice.count({ where: { dedupeKey: key } })).toBe(3);
    expect(await db.prisma.notice.count({ where: { dedupeKey: key, resolvedAt: null } })).toBe(1);
  });
});

describe('[18.2] 操作履歴（audit_logs）は追記だけ', () => {
  const insertAuditLog = `INSERT INTO audit_logs (staff_id, actor_label, action, target_type, target_id, detail, at)
       VALUES ($1, 'S001', 'CHECK_IN', 'reservation', $2, '{"fields":["status"]}'::jsonb, now())
       RETURNING id, action`;

  it('[18.2] アプリの利用者は追記と参照ができ、UPDATE・DELETE・TRUNCATE は権限がなく拒否される（TC-MB-220・221）', async () => {
    const app = await connectPg(db.appUrl);
    try {
      const inserted = await app.query<{ id: string; action: string }>(insertAuditLog, [
        randomUUID(),
        randomUUID(),
      ]);
      const id = inserted.rows[0]!.id;

      await expect(
        app.query(`UPDATE audit_logs SET action = 'TAMPERED' WHERE id = $1`, [id]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(app.query('DELETE FROM audit_logs WHERE id = $1', [id])).rejects.toMatchObject({
        code: '42501',
      });
      await expect(app.query('TRUNCATE audit_logs')).rejects.toMatchObject({ code: '42501' });

      const { rows } = await app.query<{ action: string }>(
        'SELECT action FROM audit_logs WHERE id = $1',
        [id],
      );
      expect(rows).toEqual([{ action: 'CHECK_IN' }]);
    } finally {
      await app.end();
    }
  });

  it('[18.2] API（Prisma）から操作履歴を変更・削除しようとしても、データベースが拒否する', async () => {
    const log = await db.prisma.auditLog.create({
      data: {
        staffId: null,
        actorLabel: 'job:no-show',
        action: 'NO_SHOW',
        targetType: 'reservation',
        targetId: randomUUID(),
        detail: { fields: ['status'] },
        at: AT('2026-12-02T01:00:00+09:00'),
      },
    });
    await expect(
      db.prisma.auditLog.update({ where: { id: log.id }, data: { action: 'TAMPERED' } }),
    ).rejects.toThrow(/permission denied/);
    await expect(db.prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.prisma.auditLog.findUniqueOrThrow({ where: { id: log.id } }),
    ).resolves.toMatchObject({ action: 'NO_SHOW' });
  });

  it('[18.2] テーブルの所有者でも、UPDATE・DELETE・TRUNCATE はトリガーで拒否される（TC-MB-222・223）', async () => {
    const owner = await connectPg(db.ownerUrl);
    try {
      const inserted = await owner.query<{ id: string }>(insertAuditLog, [null, randomUUID()]);
      const id = inserted.rows[0]!.id;

      for (const statement of [
        `UPDATE audit_logs SET action = 'TAMPERED' WHERE id = '${id}'`,
        `DELETE FROM audit_logs WHERE id = '${id}'`,
        'TRUNCATE audit_logs',
      ]) {
        await expect(owner.query(statement), statement).rejects.toThrow(/audit_logs/);
      }
      const { rows } = await owner.query<{ action: string }>(
        'SELECT action FROM audit_logs WHERE id = $1',
        [id],
      );
      expect(rows).toEqual([{ action: 'CHECK_IN' }]);
    } finally {
      await owner.end();
    }
  });

  it('[18.2] アプリの利用者はテーブルの所有者でもスーパーユーザーでもなく、操作履歴以外のテーブルは読み書きできる', async () => {
    const app = await connectPg(db.appUrl);
    try {
      const role = await app.query<{ superuser: boolean; owns: string }>(
        `SELECT rolsuper AS superuser,
                (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user)::text AS owns
           FROM pg_roles WHERE rolname = current_user`,
      );
      expect(role.rows[0]).toEqual({ superuser: false, owns: '0' });

      const { rows } = await app.query<{ table: string; privileges: string }>(
        `SELECT c.relname AS table,
                concat_ws(',',
                  CASE WHEN has_table_privilege(c.oid, 'SELECT') THEN 'SELECT' END,
                  CASE WHEN has_table_privilege(c.oid, 'INSERT') THEN 'INSERT' END,
                  CASE WHEN has_table_privilege(c.oid, 'UPDATE') THEN 'UPDATE' END,
                  CASE WHEN has_table_privilege(c.oid, 'DELETE') THEN 'DELETE' END,
                  CASE WHEN has_table_privilege(c.oid, 'TRUNCATE') THEN 'TRUNCATE' END) AS privileges
           FROM pg_class c
          WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'`,
      );
      const expected = Object.fromEntries([
        ...Object.keys(PHYSICAL_DATA_MODEL).map((table) => [
          table,
          table === 'audit_logs' ? 'SELECT,INSERT' : 'SELECT,INSERT,UPDATE,DELETE',
        ]),
        // マイグレーションの記録は、アプリから触れない
        ['_prisma_migrations', ''],
      ]);
      expect(Object.fromEntries(rows.map((row) => [row.table, row.privileges]))).toEqual(expected);
    } finally {
      await app.end();
    }
  });
});

describe('冪等キー・料金の控えの一意制約', () => {
  it('[4.19] 決済の冪等キー（payments.idempotency_key）は一意（L-15）', async () => {
    const roomType = await createRoomType();
    const reservation = await createReservation(roomType.id);
    const otherReservation = await createReservation(roomType.id);
    const payment = (reservationId: string) =>
      db.prisma.payment.create({
        data: {
          reservationId,
          kind: 'CHARGE',
          amount: 31_600,
          method: 'CARD_ON_FILE',
          idempotencyKey: 'idem-key-1',
          status: 'PENDING',
        },
      });
    await payment(reservation.id);
    await expectUniqueViolation(payment(otherReservation.id), 'payments_idempotency_key_key');
  });

  it('[4.22] 予約番号は空でない行の中で一意で、まだ発行していない（空の）予約は何件でもよい（L-52）', async () => {
    const roomType = await createRoomType();
    const holds = await Promise.all(
      [0, 1].map(() =>
        createReservation(roomType.id, { status: 'PENDING_PAYMENT', reservationNumber: null }),
      ),
    );
    expect(holds.map((hold) => hold.reservationNumber)).toEqual([null, null]);

    const number = newReservationNumber();
    await db.prisma.reservation.update({
      where: { id: holds[0]!.id },
      data: { status: 'CONFIRMED', reservationNumber: number },
    });
    await expectUniqueViolation(
      db.prisma.reservation.update({
        where: { id: holds[1]!.id },
        data: { status: 'CONFIRMED', reservationNumber: number },
      }),
      'reservations_reservation_number_key',
    );
    await expectUniqueViolation(
      createReservation(roomType.id, { reservationNumber: number }),
      'reservations_reservation_number_key',
    );
    await expect(
      db.prisma.reservation.findUniqueOrThrow({ where: { id: holds[1]!.id } }),
    ).resolves.toMatchObject({ status: 'PENDING_PAYMENT', reservationNumber: null });
  });

  it('[5.1] フロントの登録の冪等キー（reservations.creation_idempotency_key）は一意で、空なら何件でもよい（L-25）', async () => {
    const roomType = await createRoomType();
    const key = `front-${randomUUID()}`;
    await createReservation(roomType.id, { channel: 'FRONT', creationIdempotencyKey: key });
    await expectUniqueViolation(
      createReservation(roomType.id, { channel: 'FRONT', creationIdempotencyKey: key }),
      'reservations_creation_idempotency_key_key',
    );
    await createReservation(roomType.id, { creationIdempotencyKey: null });
    await createReservation(roomType.id, { creationIdempotencyKey: null });
  });

  it('[6.18] 夜ごとの料金の控えは、取り消していない行の中で予約×宿泊日ごとに1件', async () => {
    const roomType = await createRoomType();
    const rateVersion = await createRateVersion();
    const reservation = await createReservation(roomType.id);
    const price = () =>
      db.prisma.stayNightPrice.create({
        data: {
          reservationId: reservation.id,
          stayDate: DATE('2026-12-01'),
          rateVersionId: rateVersion.id,
          basePriceExcl: 15_000,
          surchargeBp: 0,
          earlyBirdEligible: false,
          addedAt: AT('2026-11-01T10:00:00+09:00'),
        },
      });
    const first = await price();
    await expectUniqueViolation(price(), 'stay_night_prices_reservation_id_stay_date_active_key');
    await db.prisma.stayNightPrice.update({
      where: { id: first.id },
      data: { voidedAt: AT('2026-11-02T10:00:00+09:00') },
    });
    await expect(price()).resolves.toMatchObject({ voidedAt: null });
  });
});
