// メール（mail_outbox）を確かめるテストの補助（tasks.md 3.4）。
//
//   const app = await createTestListenerApp('staff', { prisma: db.prisma, clock });   // MailSettings は TEST_MAIL_SETTINGS
//   await runInTransaction(db.prisma, (tx) =>
//     app.get(MailService).enqueue(tx, memberId, 'RESERVATION_CONFIRMED', SAMPLE_MAIL_PAYLOADS.RESERVATION_CONFIRMED));
//   const rows = await listOutbox(db.prisma, { memberId });
//   const mail = renderOutboxRow(rows[0]);   // 件名・本文（送るときと同じ内容）
import type { Locale } from '@hotel/contracts';
import type { MailPayload, MailTemplate } from '../modules/notifications/mail-templates.js';
import { renderMail, type RenderedMail } from '../modules/notifications/mail-renderer.js';
import { MailSettings } from '../modules/notifications/mail-settings.js';
import type { Prisma } from '../shared/prisma/generated/client.js';
import type { PrismaService } from '../shared/prisma/prisma.service.js';

/** テスト用のメールの設定（リンクの基点と、配信停止のリンクの署名の鍵） */
export const TEST_MAIL_SETTINGS = new MailSettings({
  guestWebBaseUrl: 'http://guest.test',
  unsubscribeTokenSecret: 'test-unsubscribe-secret-0123456789abcdef',
});

/** テンプレートごとの内容の例（金額などはテストケースの値） */
export const SAMPLE_MAIL_PAYLOADS: { readonly [T in MailTemplate]: MailPayload<T> } = {
  VERIFY_EMAIL: { token: 'verify-token-abc' },
  PASSWORD_RESET: { token: 'reset-token-abc' },
  RESERVATION_CONFIRMED: {
    reservationNumber: 'AB12CD34EF',
    roomTypeName: 'スタンダード キング',
    arrivalDate: '2026-11-20',
    departureDate: '2026-11-22',
    roomCount: 1,
    guests: { adults: 2, children: 1, infants: 0 },
    paymentMethod: 'PREPAID',
    totalAmount: 61_900,
    payAtHotelAmount: 2_000,
    earlyBird: false,
    freeCancellationDeadline: '2026-11-18T06:00:00.000Z',
  },
  PAYMENT_COMPLETED: { reservationNumber: 'AB12CD34EF', amount: 59_900, method: 'CARD_ON_FILE' },
  HOLD_EXPIRED: {
    roomTypeName: 'スタンダード キング',
    arrivalDate: '2026-11-20',
    departureDate: '2026-11-22',
    roomCount: 2,
  },
  RESERVATION_CHANGED: {
    reservationNumber: 'AB12CD34EF',
    roomTypeName: 'スタンダード キング',
    arrivalDate: '2026-11-20',
    departureDate: '2026-11-23',
    roomCount: 1,
    guests: { adults: 2, children: 0, infants: 0 },
    totalAmount: 73_300,
    chargedAmount: 11_400,
    refundAmount: 0,
    payAtHotelDelta: 0,
    cancellationFee: 0,
    nonRefundableLodgingTax: 0,
  },
  RESERVATION_CANCELLED: {
    reservationNumber: 'AB12CD34EF',
    arrivalDate: '2026-11-16',
    departureDate: '2026-11-19',
    cancellationFee: 28_000,
    nonRefundableStayAmount: 0,
    nonRefundableLodgingTax: 400,
    refundAmount: 56_800,
  },
  PRE_ARRIVAL: {
    reservationNumber: 'AB12CD34EF',
    roomTypeName: 'スタンダード キング',
    arrivalDate: '2026-11-11',
    departureDate: '2026-11-12',
    roomCount: 1,
    earlyCheckinHour: null,
  },
  FEE_CHARGED: {
    reservationNumber: 'AB12CD34EF',
    reason: 'NO_SHOW',
    amount: 24_600,
    chargedTo: 'PREPAYMENT',
    nonRefundableStayAmount: 49_200,
    nonRefundableLodgingTax: 1_200,
  },
  REFUND_COMPLETED: { reservationNumber: 'AB12CD34EF', amount: 56_800, method: 'CARD_ON_FILE' },
  PAYMENT_REQUEST: {
    reservationNumber: 'AB12CD34EF',
    amount: 28_000,
    bankAccount: {
      bankName: 'サンプル銀行',
      branchName: '金沢支店',
      accountType: '普通',
      accountNumber: '1234567',
      accountHolder: 'サンプルホテル カナザワ',
    },
  },
  MARKETING: {
    subject: '冬の特別なご案内',
    body: '本文の1行目\n本文の2行目',
    unsubscribeToken: 'u1.sample-token',
  },
};

/** 振込先の設定（hotel_settings。初期データと同じキー。tasks.md Implementation Notes 1.5） */
export const SAMPLE_BANK_SETTINGS: readonly { key: string; value: string }[] = [
  { key: 'bank_transfer.bank_name', value: 'サンプル銀行' },
  { key: 'bank_transfer.branch_name', value: '金沢支店' },
  { key: 'bank_transfer.account_type', value: '普通' },
  { key: 'bank_transfer.account_number', value: '1234567' },
  { key: 'bank_transfer.account_holder', value: 'サンプルホテル カナザワ' },
];

/** mail_outbox の行（作った順） */
export function listOutbox(prisma: PrismaService, where: Prisma.MailOutboxWhereInput = {}) {
  return prisma.mailOutbox.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

/** mail_outbox の行を、送るときと同じ設定（TEST_MAIL_SETTINGS）で件名・本文にする */
export function renderOutboxRow(row: {
  template: string;
  locale: string;
  payload: unknown;
}): RenderedMail {
  return renderMail(row, { guestWebBaseUrl: TEST_MAIL_SETTINGS.guestWebBaseUrl });
}

export interface PendingMailInput {
  memberId?: string | null;
  toAddress?: string;
  locale?: Locale;
  template?: MailTemplate;
  payload?: object;
  attempts?: number;
  createdAt?: Date;
}

/** 送信待ち（PENDING）の行を直接作る（outbox の処理の前提を作るため） */
export async function insertPendingMail(
  prisma: PrismaService,
  input: PendingMailInput = {},
): Promise<string> {
  const template = input.template ?? 'PAYMENT_COMPLETED';
  const row = await prisma.mailOutbox.create({
    data: {
      memberId: input.memberId ?? null,
      toAddress: input.toAddress ?? 'a@example.com',
      locale: input.locale ?? 'ja',
      template,
      payload: (input.payload ?? SAMPLE_MAIL_PAYLOADS[template]) as Prisma.InputJsonObject,
      status: 'PENDING',
      attempts: input.attempts ?? 0,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
    select: { id: true },
  });
  return row.id;
}

/** 定期配信の同意の履歴を、指定した順に追記する（marketing_consents は追記だけ。最新の行が現在の状態） */
export async function insertConsents(
  prisma: PrismaService,
  memberId: string,
  records: readonly { consented: boolean; recordedAt: string }[],
): Promise<void> {
  for (const record of records) {
    await prisma.marketingConsent.create({
      data: {
        memberId,
        consented: record.consented,
        method: record.consented ? 'PROFILE' : 'UNSUBSCRIBE_LINK',
        recordedAt: new Date(record.recordedAt),
      },
    });
  }
}
