-- 初期のスキーマ（design.md Physical Data Model。tasks.md 1.4）。
-- 前半は schema.prisma から prisma migrate diff で作った SQL、後半は手で書いた SQL。

-- CreateTable
CREATE TABLE "room_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name_ja" TEXT NOT NULL,
    "area_sqm" INTEGER NOT NULL,
    "bed_description_ja" TEXT NOT NULL,
    "capacity_adults" INTEGER NOT NULL,
    "standard_occupancy" INTEGER NOT NULL,
    "display_order" INTEGER NOT NULL,
    "description_ja" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "room_number" INTEGER NOT NULL,
    "floor" INTEGER NOT NULL,
    "room_type_id" UUID NOT NULL,
    "is_accessible" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL,
    "status_changed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "weekend_surcharge_bp" INTEGER NOT NULL,
    "headcount_tiers" JSONB NOT NULL,
    "stay_tiers" JSONB NOT NULL,
    "early_bird_bp" INTEGER NOT NULL,
    "rate_floor_bp" INTEGER NOT NULL,
    "consumption_tax_bp" INTEGER NOT NULL,
    "breakfast_price_excl" INTEGER NOT NULL,
    "off_hours_price_per_hour_incl" INTEGER NOT NULL,
    "lodging_tax_brackets" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_type_prices" (
    "rate_version_id" UUID NOT NULL,
    "room_type_id" UUID NOT NULL,
    "base_price_excl" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_type_prices_pkey" PRIMARY KEY ("rate_version_id","room_type_id")
);

-- CreateTable
CREATE TABLE "special_surcharge_periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "rate_bp" INTEGER NOT NULL,
    "created_by" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "special_surcharge_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "terms_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INTEGER NOT NULL,
    "body_ja" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terms_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source_hash" TEXT NOT NULL,
    "is_edited" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_fields" (
    "key" TEXT NOT NULL,
    "label_ja" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roster_fields_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "family_name" TEXT NOT NULL,
    "given_name" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "is_foreign_non_resident" BOOLEAN NOT NULL,
    "nationality" TEXT,
    "passport_number" TEXT,
    "birth_date" DATE NOT NULL,
    "preferred_locale" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ(6),
    "withdrawn_at" TIMESTAMPTZ(6),
    "last_stay_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_cards" (
    "member_id" UUID NOT NULL,
    "payment_token" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "exp_month" INTEGER NOT NULL,
    "exp_year" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_cards_pkey" PRIMARY KEY ("member_id")
);

-- CreateTable
CREATE TABLE "marketing_consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "member_id" UUID NOT NULL,
    "consented" BOOLEAN NOT NULL,
    "method" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "member_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_number" TEXT NOT NULL,
    "member_id" UUID,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "room_type_id" UUID NOT NULL,
    "arrival_date" DATE NOT NULL,
    "departure_date" DATE NOT NULL,
    "adults" INTEGER NOT NULL,
    "children" INTEGER NOT NULL,
    "infants" INTEGER NOT NULL,
    "breakfast_adults" INTEGER NOT NULL,
    "breakfast_children" INTEGER NOT NULL,
    "breakfast_infants" INTEGER NOT NULL,
    "early_bird" BOOLEAN NOT NULL,
    "is_group" BOOLEAN NOT NULL,
    "max_room_count" INTEGER NOT NULL,
    "booker_is_guest" BOOLEAN NOT NULL,
    "arrival_eta" TEXT,
    "companions_on_site" BOOLEAN NOT NULL,
    "terms_version" INTEGER,
    "terms_agreed_at" TIMESTAMPTZ(6),
    "hold_expires_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "no_show_at" TIMESTAMPTZ(6),
    "no_show_deferred_until" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "checked_in_at" TIMESTAMPTZ(6),
    "checked_out_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL,
    "creation_idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_id" UUID NOT NULL,
    "room_id" UUID,
    "current_room_type_id" UUID NOT NULL,
    "early_checkin_hour" INTEGER,
    "late_checkout_hour" INTEGER,
    "upgrade_kind" TEXT,
    "room_guest_counts" JSONB,
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservation_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_nights" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_room_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "stay_date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_nights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stay_night_prices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_id" UUID NOT NULL,
    "stay_date" DATE NOT NULL,
    "rate_version_id" UUID NOT NULL,
    "base_price_excl" INTEGER NOT NULL,
    "surcharge_bp" INTEGER NOT NULL,
    "early_bird_eligible" BOOLEAN NOT NULL,
    "added_at" TIMESTAMPTZ(6) NOT NULL,
    "voided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stay_night_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_id" UUID NOT NULL,
    "reservation_room_id" UUID,
    "category" TEXT NOT NULL,
    "stay_date" DATE,
    "age_category" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price_incl" INTEGER NOT NULL,
    "amount_incl" INTEGER NOT NULL,
    "settlement" TEXT NOT NULL,
    "rate_version_id" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ(6),
    "voided_reason" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "charge_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "provider_ref" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "staff_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_id" UUID NOT NULL,
    "is_booker" BOOLEAN NOT NULL,
    "age_category" TEXT NOT NULL,
    "family_name" TEXT NOT NULL,
    "given_name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "is_foreign_non_resident" BOOLEAN NOT NULL,
    "nationality" TEXT,
    "passport_number" TEXT,
    "extra" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roster_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "out_of_order_periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "room_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "out_of_order_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "room_type_id" UUID,
    "room_id" UUID,
    "reservation_id" UUID,
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_id" UUID,
    "actor_label" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "member_id" UUID,
    "to_address" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_ja" TEXT NOT NULL,
    "body_ja" TEXT NOT NULL,
    "send_at" TIMESTAMPTZ(6) NOT NULL,
    "repeat" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "result" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "room_types_code_key" ON "room_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_room_number_key" ON "rooms"("room_number");

-- CreateIndex
CREATE INDEX "rooms_room_type_id_floor_idx" ON "rooms"("room_type_id", "floor");

-- CreateIndex
CREATE UNIQUE INDEX "rate_versions_effective_from_key" ON "rate_versions"("effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "terms_documents_version_key" ON "terms_documents"("version");

-- CreateIndex
CREATE UNIQUE INDEX "translations_entity_type_entity_id_field_locale_key" ON "translations"("entity_type", "entity_id", "field", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "members_phone_active_key" ON "members"("phone") WHERE (status = ANY (ARRAY['PENDING'::text, 'ACTIVE'::text]));

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_realm_subject_id_idx" ON "sessions"("realm", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_staff_number_key" ON "staff"("staff_number");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_reservation_number_key" ON "reservations"("reservation_number");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_creation_idempotency_key_key" ON "reservations"("creation_idempotency_key");

-- CreateIndex
CREATE INDEX "reservations_member_id_status_idx" ON "reservations"("member_id", "status");

-- CreateIndex
CREATE INDEX "reservations_arrival_date_status_idx" ON "reservations"("arrival_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_member_id_pending_payment_key" ON "reservations"("member_id") WHERE ((status = 'PENDING_PAYMENT'::text) AND (channel = 'WEB'::text));

-- CreateIndex
CREATE INDEX "reservation_rooms_reservation_id_idx" ON "reservation_rooms"("reservation_id");

-- CreateIndex
CREATE INDEX "room_nights_stay_date_idx" ON "room_nights"("stay_date");

-- CreateIndex
CREATE UNIQUE INDEX "room_nights_room_id_stay_date_key" ON "room_nights"("room_id", "stay_date");

-- CreateIndex
CREATE UNIQUE INDEX "stay_night_prices_reservation_id_stay_date_active_key" ON "stay_night_prices"("reservation_id", "stay_date") WHERE (voided_at IS NULL);

-- CreateIndex
CREATE INDEX "charge_lines_reservation_id_voided_at_idx" ON "charge_lines"("reservation_id", "voided_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "roster_entries_reservation_id_idx" ON "roster_entries"("reservation_id");

-- CreateIndex
CREATE INDEX "out_of_order_periods_room_id_start_date_end_date_idx" ON "out_of_order_periods"("room_id", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "notices_dedupe_key_unresolved_key" ON "notices"("dedupe_key") WHERE (resolved_at IS NULL);

-- CreateIndex
CREATE INDEX "mail_outbox_status_idx" ON "mail_outbox"("status");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_type_prices" ADD CONSTRAINT "room_type_prices_rate_version_id_fkey" FOREIGN KEY ("rate_version_id") REFERENCES "rate_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_type_prices" ADD CONSTRAINT "room_type_prices_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_cards" ADD CONSTRAINT "member_cards_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_consents" ADD CONSTRAINT "marketing_consents_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_room_type_id_fkey" FOREIGN KEY ("room_type_id") REFERENCES "room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_current_room_type_id_fkey" FOREIGN KEY ("current_room_type_id") REFERENCES "room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_nights" ADD CONSTRAINT "room_nights_reservation_room_id_fkey" FOREIGN KEY ("reservation_room_id") REFERENCES "reservation_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_nights" ADD CONSTRAINT "room_nights_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_night_prices" ADD CONSTRAINT "stay_night_prices_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stay_night_prices" ADD CONSTRAINT "stay_night_prices_rate_version_id_fkey" FOREIGN KEY ("rate_version_id") REFERENCES "rate_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_rate_version_id_fkey" FOREIGN KEY ("rate_version_id") REFERENCES "rate_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "out_of_order_periods" ADD CONSTRAINT "out_of_order_periods_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- ここから下は、Prisma のスキーマの書き方で表せないもの（手で書いた SQL）。
-- Prisma はこれらを比較の対象にしないので、schema.prisma を変えても消えない。
-- ===========================================================================

-- 列挙の値（packages/contracts の列挙と同じ。contracts にないものは design.md Physical Data Model の値）
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_status_check" CHECK ("status" IN ('CLEANING_READY', 'CLEANING', 'INSPECTION', 'CLEAN', 'STAY_DIRTY', 'STAY_CLEANING', 'STAY_INSPECTION', 'STAY_CLEAN', 'CHECKED_IN', 'DEPARTURE_PENDING', 'NO_ARRIVAL', 'OUT_OF_ORDER'));
ALTER TABLE "translations" ADD CONSTRAINT "translations_locale_check" CHECK ("locale" IN ('ja', 'en', 'ko', 'zh-Hans', 'zh-Hant'));
ALTER TABLE "members" ADD CONSTRAINT "members_status_check" CHECK ("status" IN ('PENDING', 'ACTIVE', 'WITHDRAWN'));
ALTER TABLE "members" ADD CONSTRAINT "members_preferred_locale_check" CHECK ("preferred_locale" IN ('ja', 'en', 'ko', 'zh-Hans', 'zh-Hant'));
ALTER TABLE "marketing_consents" ADD CONSTRAINT "marketing_consents_method_check" CHECK ("method" IN ('REGISTRATION', 'PROFILE', 'UNSUBSCRIBE_LINK'));
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_purpose_check" CHECK ("purpose" IN ('VERIFY_EMAIL', 'RESET_PASSWORD'));
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_realm_check" CHECK ("realm" IN ('MEMBER', 'STAFF'));
ALTER TABLE "staff" ADD CONSTRAINT "staff_role_check" CHECK ("role" IN ('ADMIN', 'FRONT', 'CLEANER'));
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_channel_check" CHECK ("channel" IN ('WEB', 'FRONT'));
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_status_check" CHECK ("status" IN ('PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW', 'EXPIRED'));
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_payment_method_check" CHECK ("payment_method" IN ('PREPAID', 'PAY_AT_HOTEL'));
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_early_checkin_hour_check" CHECK ("early_checkin_hour" IN (12, 13, 14));
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_late_checkout_hour_check" CHECK ("late_checkout_hour" IN (13, 14, 15));
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_upgrade_kind_check" CHECK ("upgrade_kind" IN ('COMPLIMENTARY', 'PAID'));
ALTER TABLE "room_nights" ADD CONSTRAINT "room_nights_kind_check" CHECK ("kind" IN ('HOLD', 'BOOKED'));
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_category_check" CHECK ("category" IN ('ROOM', 'BREAKFAST', 'EARLY_CHECKIN', 'LATE_CHECKOUT', 'UPGRADE', 'DOWNGRADE_ADJUSTMENT', 'CANCELLATION_FEE', 'NO_SHOW_FEE', 'LODGING_TAX'));
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_age_category_check" CHECK ("age_category" IN ('ADULT', 'CHILD', 'INFANT'));
ALTER TABLE "charge_lines" ADD CONSTRAINT "charge_lines_settlement_check" CHECK ("settlement" IN ('PREPAID', 'ONSITE'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_kind_check" CHECK ("kind" IN ('CHARGE', 'REFUND', 'ONSITE_RECEIPT', 'ONSITE_REFUND', 'FEE_CHARGE'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_check" CHECK ("method" IN ('CARD_ON_FILE', 'CASH', 'CARD', 'BANK_TRANSFER', 'OTHER'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_check" CHECK ("status" IN ('PENDING', 'SUCCEEDED', 'FAILED', 'VOIDED'));
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_age_category_check" CHECK ("age_category" IN ('ADULT', 'CHILD', 'INFANT'));
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_source_check" CHECK ("source" IN ('WEB', 'FRONT'));
ALTER TABLE "notices" ADD CONSTRAINT "notices_kind_check" CHECK ("kind" IN ('FRAGMENTED_INVENTORY', 'SPLIT_FLOORS', 'TURNOVER_GAP'));
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_locale_check" CHECK ("locale" IN ('ja', 'en', 'ko', 'zh-Hans', 'zh-Hant'));
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_status_check" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED'));
ALTER TABLE "mail_campaigns" ADD CONSTRAINT "mail_campaigns_repeat_check" CHECK ("repeat" IN ('NONE', 'WEEKLY', 'MONTHLY'));

-- 会員のメールアドレスは、大文字・小文字を区別せず、有効な会員（PENDING・ACTIVE）の間で一意（要件 1.3）。
-- 式のインデックスは Prisma のスキーマで書けないので、ここで作る（電話番号の部分一意インデックスは schema.prisma にある）
CREATE UNIQUE INDEX "members_email_active_key" ON "members" (lower("email")) WHERE ("status" IN ('PENDING', 'ACTIVE'));

-- 操作履歴は追記だけ（要件 18.2）。テーブルの所有者を含め、UPDATE・DELETE・TRUNCATE をトリガーで拒否する
CREATE FUNCTION "audit_logs_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '操作履歴（audit_logs）は追記だけです。% はできません', TG_OP
    USING ERRCODE = 'insufficient_privilege',
          HINT = '操作履歴を直す場合は、訂正の操作を新しい行として追記してください';
END;
$$;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_logs_reject_change"();

-- アプリ（API）の権限。ログインしないロール hotel_app にまとめ、API が接続に使う利用者（DATABASE_URL の利用者）を
-- そのメンバーにする（利用者の作成とパスワードの設定は pnpm db:migrate と結合テストの準備が行う。prisma/scripts/database-admin.ts）。
-- ロールはサーバー全体で共有されるので、すでにあれば作らない（マイグレーション用の利用者に CREATEROLE がない環境では、先に作っておく）
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hotel_app') THEN
    CREATE ROLE "hotel_app" NOLOGIN;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA "public" TO "hotel_app";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "room_types", "rooms", "rate_versions", "room_type_prices", "special_surcharge_periods", "holidays",
  "terms_documents", "translations", "roster_fields",
  "members", "member_cards", "marketing_consents", "auth_tokens", "sessions", "staff",
  "reservations", "reservation_rooms", "room_nights", "stay_night_prices", "charge_lines", "payments",
  "roster_entries",
  "out_of_order_periods", "notices", "mail_outbox", "mail_campaigns", "hotel_settings", "job_runs"
  TO "hotel_app";
-- 操作履歴は追記と参照だけ（UPDATE・DELETE・TRUNCATE の権限を与えない）
GRANT SELECT, INSERT ON TABLE "audit_logs" TO "hotel_app";

-- 後のマイグレーションで作るテーブルにも、同じ読み書きの権限を与える（追記だけのテーブルを作るときは、そのマイグレーションで REVOKE する）
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "hotel_app";
