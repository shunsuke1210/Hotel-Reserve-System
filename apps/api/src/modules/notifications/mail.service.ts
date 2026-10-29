// メールの作成（design.md Components の MailService、P-15、Data Models mail_outbox。要件 15.1・15.6〜15.8・16.2）。
//
// 業務の処理（会員登録・確定・変更・キャンセル・入金の記録・定時処理など）は、自分のトランザクションの中で
// メールを送信待ち（mail_outbox の PENDING の行）に入れる。送るのは定時処理 outbox（outbox.processor.ts）：
//
//   await runInTransaction(this.prisma, async (tx) => {
//     … 予約を確定する …
//     await this.mail.enqueue(tx, memberId, 'RESERVATION_CONFIRMED', { reservationNumber, … });
//   });
//
// - 宛先は会員のメールアドレス、言語は作成した時点の会員の preferred_locale（15.1。TC-MB-231）。メールアドレスの
//   変更の確認（DT-M4）だけは、新しいアドレスを options.toAddress で渡す
// - 業務の処理と同じトランザクションで作るので、処理が取り消されればメールも残らない。トランザクションの外の接続を
//   渡すと断る
// - 行には宛先・言語・テンプレート・内容（文面を作るための値）を保存し、文面は送るときに作る（mail-renderer.ts）。
//   会員を削除するときは deleteForMember で、その会員の行（宛先・本文）を消す（19.4、DT-M34）
// - 定期配信（MARKETING）は enqueue では作れない。enqueueMarketing・enqueueMarketingToConsentedMembers が、
//   同意が最新で true の有効な会員だけに、署名つきの配信停止のリンクを入れて作る（15.6、15.7）。
//   作った後に同意を取り消した・退会した会員には、送る時点（outbox）でも確かめ直して送らない
// - 宛先・内容をログに出さない
import type { Locale } from '@hotel/contracts';
import { LocaleSchema } from '@hotel/contracts';
import { Injectable } from '@nestjs/common';
import { BusinessClock } from '../../shared/clock/business-clock.js';
import type { Prisma } from '../../shared/prisma/generated/client.js';
import type { PrismaService } from '../../shared/prisma/prisma.service.js';
import type { TransactionClient } from '../../shared/prisma/transaction.js';
import { canReceiveMarketing } from './marketing-consent.js';
import {
  describeIssuePaths,
  MAIL_PAYLOAD_SCHEMAS,
  MAIL_TEMPLATES,
  type MailPayload,
  type MailPayloadInput,
  type MailStatus,
  type MailTemplate,
  type MarketingContent,
  type TransactionalMailTemplate,
} from './mail-templates.js';
import { UnsubscribeTokens } from './unsubscribe-token.js';

/** 内容（会員の言語を受け取る関数でもよい。客室タイプの名称などを会員の言語で入れるため） */
export type MailPayloadSource<T extends TransactionalMailTemplate> =
  MailPayloadInput<T> | ((locale: Locale) => MailPayloadInput<T> | Promise<MailPayloadInput<T>>);

/** 定期配信の件名と本文（会員の言語を受け取る関数でもよい。翻訳した文面を渡すため） */
export type MarketingContentSource =
  MarketingContent | ((locale: Locale) => MarketingContent | Promise<MarketingContent>);

export interface EnqueueOptions {
  /** 宛先（省略時は会員のメールアドレス）。メールアドレスの変更の確認で、新しいアドレスに送るとき（DT-M4、L-55） */
  toAddress?: string;
}

/** 作成したメール（宛先は返さない） */
export interface EnqueuedMail {
  id: string;
  template: MailTemplate;
  locale: Locale;
}

/** 送れなかったメール（警告の一覧に出す。design.md「定時処理の失敗」） */
export interface FailedMail {
  id: string;
  memberId: string | null;
  toAddress: string;
  template: string;
  locale: string;
  attempts: number;
  createdAt: Date;
  /** 内容の予約番号（予約のメールでなければ null） */
  reservationNumber: string | null;
}

/** 振込先の設定のキー（hotel_settings。tasks.md Implementation Notes 1.5） */
const BANK_SETTING_KEYS = {
  bankName: 'bank_transfer.bank_name',
  branchName: 'bank_transfer.branch_name',
  accountType: 'bank_transfer.account_type',
  accountNumber: 'bank_transfer.account_number',
  accountHolder: 'bank_transfer.account_holder',
} as const;

const PENDING: MailStatus = 'PENDING';
const FAILED: MailStatus = 'FAILED';

@Injectable()
export class MailService {
  constructor(
    private readonly clock: BusinessClock,
    private readonly unsubscribeTokens: UnsubscribeTokens,
  ) {}

  /**
   * 会員宛ての取引のメール（定期配信以外）を、呼び出し元のトランザクションの中で送信待ちに入れる。
   * @throws Error トランザクションの外の接続を渡したとき・会員がいないとき・振込先の設定がないとき（PAYMENT_REQUEST）
   * @throws RangeError テンプレートが定期配信のとき・内容の形が誤っているとき
   */
  async enqueue<T extends TransactionalMailTemplate>(
    tx: TransactionClient,
    memberId: string,
    template: T,
    payload: MailPayloadSource<T>,
    options: EnqueueOptions = {},
  ): Promise<EnqueuedMail> {
    assertTransactionClient(tx);
    if (template === ('MARKETING' as MailTemplate) || !MAIL_TEMPLATES.includes(template)) {
      throw new RangeError(
        '定期配信（MARKETING）は enqueueMarketing で作ってください（同意の確認と配信停止のリンクを必ず入れるため）',
      );
    }
    const recipient = await this.recipientOf(tx, memberId);
    const input = typeof payload === 'function' ? await payload(recipient.locale) : payload;
    const stored =
      template === 'PAYMENT_REQUEST' ? { ...input, bankAccount: await readBankAccount(tx) } : input;
    return this.insert(tx, {
      memberId,
      toAddress: options.toAddress ?? recipient.email,
      locale: recipient.locale,
      template,
      payload: parsePayload(template, stored),
    });
  }

  /**
   * 定期配信のメールを1通作る。同意が最新で true の有効な（ACTIVE の）会員でなければ作らずに null を返す（15.6）。
   * 送信者の名称と、署名つきの配信停止のリンクは、テンプレートが必ず入れる（15.7）。
   */
  async enqueueMarketing(
    tx: TransactionClient,
    memberId: string,
    content: MarketingContentSource,
  ): Promise<EnqueuedMail | null> {
    assertTransactionClient(tx);
    if (!(await canReceiveMarketing(tx, memberId))) return null;
    const recipient = await this.recipientOf(tx, memberId);
    return this.insertMarketing(tx, {
      id: memberId,
      email: recipient.email,
      locale: recipient.locale,
      content,
    });
  }

  /**
   * 定期配信（管理者画面の配信。後のフェーズ）：同意が最新で true の有効な会員の全員に、会員の言語で作る。
   * @returns 作った通数
   */
  async enqueueMarketingToConsentedMembers(
    tx: TransactionClient,
    content: MarketingContentSource,
  ): Promise<number> {
    assertTransactionClient(tx);
    // 会員ごとの最新の同意の行（並べ方は marketing-consent.ts の LATEST_CONSENT_ORDER と同じ）
    const members = await tx.$queryRaw<{ id: string; email: string; preferred_locale: string }[]>`
      SELECT m.id, m.email, m.preferred_locale
      FROM members m
      JOIN LATERAL (
        SELECT c.consented
        FROM marketing_consents c
        WHERE c.member_id = m.id
        ORDER BY c.recorded_at DESC, c.created_at DESC, c.consented ASC
        LIMIT 1
      ) latest ON true
      WHERE m.status = 'ACTIVE' AND latest.consented
      ORDER BY m.id`;
    for (const member of members) {
      await this.insertMarketing(tx, {
        id: member.id,
        email: member.email,
        locale: LocaleSchema.parse(member.preferred_locale),
        content,
      });
    }
    return members.length;
  }

  /** 送れなかった（FAILED の）メール（古い順）。警告の一覧（WarningService）が使う */
  async listFailed(db: PrismaService | TransactionClient): Promise<FailedMail[]> {
    const rows = await db.mailOutbox.findMany({
      where: { status: FAILED },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        memberId: true,
        toAddress: true,
        template: true,
        locale: true,
        attempts: true,
        createdAt: true,
        payload: true,
      },
    });
    return rows.map(({ payload, ...row }) => ({
      ...row,
      reservationNumber: reservationNumberOf(payload),
    }));
  }

  /** 会員の削除（P-16）で、その会員のメールの行（宛先・本文）を消す（19.4、DT-M34）。消した行の数を返す */
  async deleteForMember(tx: TransactionClient, memberId: string): Promise<number> {
    assertTransactionClient(tx);
    const deleted = await tx.mailOutbox.deleteMany({ where: { memberId } });
    return deleted.count;
  }

  private async recipientOf(
    tx: TransactionClient,
    memberId: string,
  ): Promise<{ email: string; locale: Locale }> {
    const member = await tx.member.findUnique({
      where: { id: memberId },
      select: { email: true, preferredLocale: true },
    });
    if (member === null) throw new Error('メールの宛先の会員が見つかりません');
    return { email: member.email, locale: LocaleSchema.parse(member.preferredLocale) };
  }

  private async insertMarketing(
    tx: TransactionClient,
    member: { id: string; email: string; locale: Locale; content: MarketingContentSource },
  ): Promise<EnqueuedMail> {
    const content =
      typeof member.content === 'function' ? await member.content(member.locale) : member.content;
    return this.insert(tx, {
      memberId: member.id,
      toAddress: member.email,
      locale: member.locale,
      template: 'MARKETING',
      payload: parsePayload('MARKETING', {
        subject: content.subject,
        body: content.body,
        unsubscribeToken: this.unsubscribeTokens.issue(member.id, this.clock.now()),
      }),
    });
  }

  private async insert(
    tx: TransactionClient,
    row: {
      memberId: string;
      toAddress: string;
      locale: Locale;
      template: MailTemplate;
      payload: object;
    },
  ): Promise<EnqueuedMail> {
    if (row.toAddress.trim() === '') throw new RangeError('メールの宛先がありません');
    const created = await tx.mailOutbox.create({
      data: {
        memberId: row.memberId,
        toAddress: row.toAddress,
        locale: row.locale,
        template: row.template,
        payload: row.payload as Prisma.InputJsonObject,
        status: PENDING,
        attempts: 0,
        createdAt: this.clock.now(),
      },
      select: { id: true },
    });
    return { id: created.id, template: row.template, locale: row.locale };
  }
}

/** 内容をテンプレートの形で確かめ、テンプレートの項目だけにする。誤りは RangeError（値は文言に出さない） */
function parsePayload<T extends MailTemplate>(template: T, payload: unknown): MailPayload<T> {
  const result = MAIL_PAYLOAD_SCHEMAS[template].safeParse(payload);
  if (!result.success) {
    throw new RangeError(
      `メールの内容（${template}）の形が正しくありません: ${describeIssuePaths(result.error)}`,
    );
  }
  return result.data as MailPayload<T>;
}

/** 振込先（hotel_settings）。足りなければ Error（振込先のない支払いのお願いを作らない） */
async function readBankAccount(
  tx: TransactionClient,
): Promise<MailPayload<'PAYMENT_REQUEST'>['bankAccount']> {
  const rows = await tx.hotelSetting.findMany({
    where: { key: { in: Object.values(BANK_SETTING_KEYS) } },
    select: { key: true, value: true },
  });
  const values = new Map(rows.map((row) => [row.key, row.value.trim()]));
  const missing = Object.values(BANK_SETTING_KEYS).filter((key) => !values.get(key));
  if (missing.length > 0) {
    throw new Error(`hotel_settings に振込先の設定がありません: ${missing.join(', ')}`);
  }
  const value = (key: string) => values.get(key) ?? '';
  return {
    bankName: value(BANK_SETTING_KEYS.bankName),
    branchName: value(BANK_SETTING_KEYS.branchName),
    accountType: value(BANK_SETTING_KEYS.accountType),
    accountNumber: value(BANK_SETTING_KEYS.accountNumber),
    accountHolder: value(BANK_SETTING_KEYS.accountHolder),
  };
}

function reservationNumberOf(payload: Prisma.JsonValue): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>).reservationNumber;
  return typeof value === 'string' ? value : null;
}

/**
 * トランザクションのクライアントか。PrismaService（トランザクションの外の接続）には $connect があり、
 * 対話型のトランザクションのクライアントにはない（shared/audit の AuditLogService と同じ確かめ方）
 */
function assertTransactionClient(client: TransactionClient): void {
  if (typeof (client as { $connect?: unknown }).$connect === 'function') {
    throw new Error(
      'メールは、業務の処理と同じトランザクション（runInTransaction の tx）の中で作ってください。処理が取り消されたときにメールが残らないようにするためです',
    );
  }
}
