// メールの作成（MailService）を、テスト用のデータベースで確かめる（tasks.md 3.4、design.md P-15・mail_outbox、要件 15.1・15.6〜15.8・16.2）。
// メールは呼び出し元（会員登録・確定・変更など）のトランザクションの中で mail_outbox に送信待ち（PENDING）として作る。
import { LOCALES, type Locale } from '@hotel/contracts';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedBusinessClock } from '../../shared/clock/business-clock.js';
import { runInTransaction } from '../../shared/prisma/transaction.js';
import { insertMember } from '../../test/auth/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../../test/database/test-database.js';
import { createTestListenerApp } from '../../test/listener-app.js';
import {
  insertConsents,
  listOutbox,
  renderOutboxRow,
  SAMPLE_BANK_SETTINGS,
  SAMPLE_MAIL_PAYLOADS,
  TEST_MAIL_SETTINGS,
} from '../../test/mail.js';
import { extractLinks } from './mail-renderer.js';
import { MailService } from './mail.service.js';
import { verifyUnsubscribeToken } from './unsubscribe-token.js';

const NOW = '2026-11-10T10:00:00+09:00';

describe('MailService（メールの作成）', () => {
  let db: TestDatabase;
  let guest: INestApplication;
  let staff: INestApplication;
  let mail: MailService;
  const clock = new FixedBusinessClock(NOW);
  let sequence = 0;

  /** 会員を作る（メールアドレス・電話番号は呼ぶたびに別の値） */
  async function member(
    options: { locale?: Locale; status?: 'PENDING' | 'ACTIVE' | 'WITHDRAWN' } = {},
  ): Promise<{ id: string; email: string }> {
    sequence += 1;
    const email = `m${sequence}@example.com`;
    const id = await insertMember(db.prisma, {
      email,
      phone: `0901000${String(sequence).padStart(4, '0')}`,
      passwordHash: options.status === 'WITHDRAWN' ? null : 'hash',
      ...(options.status ? { status: options.status } : {}),
      ...(options.locale ? { preferredLocale: options.locale } : {}),
    });
    return { id, email };
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    guest = await createTestListenerApp('guest', { prisma: db.prisma, clock });
    staff = await createTestListenerApp('staff', { prisma: db.prisma, clock });
    mail = guest.get(MailService);
  });
  beforeEach(() => {
    clock.set(NOW);
  });
  afterAll(async () => {
    await guest?.close();
    await staff?.close();
    await db?.drop();
  });

  describe('取引のメール（会員の言語で作る）', () => {
    it.each(LOCALES)(
      '[15.1][16.2] preferred_locale=%s の会員の RESERVATION_CONFIRMED は、その言語で送信待ちに入る（TC-MB-225〜229）',
      async (locale) => {
        const m = await member({ locale });
        const created = await runInTransaction(db.prisma, (tx) =>
          mail.enqueue(
            tx,
            m.id,
            'RESERVATION_CONFIRMED',
            SAMPLE_MAIL_PAYLOADS.RESERVATION_CONFIRMED,
          ),
        );
        const rows = await listOutbox(db.prisma, { memberId: m.id });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          id: created.id,
          memberId: m.id,
          toAddress: m.email,
          locale,
          template: 'RESERVATION_CONFIRMED',
          status: 'PENDING',
          attempts: 0,
          sentAt: null,
          createdAt: new Date(NOW),
        });
        expect(created).toEqual({ id: rows[0]?.id, template: 'RESERVATION_CONFIRMED', locale });
        // 送るときの文面（定型文はその言語）
        const rendered = renderOutboxRow(rows[0]!);
        expect(rendered.subject).toContain('AB12CD34EF');
        if (locale === 'en') expect(rendered.subject).toContain('Your reservation is confirmed');
        if (locale === 'ko') expect(rendered.subject).toContain('예약이 확정되었습니다');
      },
    );

    it('[1.4][15.1] VERIFY_EMAIL は会員の言語・アドレスで作り、確認のリンクにトークンを入れる（TC-MB-069）', async () => {
      const m = await member({ locale: 'ko', status: 'PENDING' });
      await runInTransaction(db.prisma, (tx) =>
        mail.enqueue(tx, m.id, 'VERIFY_EMAIL', { token: 'raw-token-1' }),
      );
      const rows = await listOutbox(db.prisma, { memberId: m.id });
      expect(rows).toMatchObject([
        { template: 'VERIFY_EMAIL', toAddress: m.email, locale: 'ko', status: 'PENDING' },
      ]);
      expect(extractLinks(renderOutboxRow(rows[0]!).body)).toContain(
        `${TEST_MAIL_SETTINGS.guestWebBaseUrl}/verify-email?token=raw-token-1`,
      );
    });

    it('[1.12] メールアドレスの変更の確認メールは、指定した新しいアドレスに、会員の言語で送る（DT-M4、TC-MB-106）', async () => {
      const m = await member({ locale: 'ja' });
      await runInTransaction(db.prisma, (tx) =>
        mail.enqueue(
          tx,
          m.id,
          'VERIFY_EMAIL',
          { token: 't' },
          { toAddress: 'new-address@example.com' },
        ),
      );
      expect(await listOutbox(db.prisma, { memberId: m.id })).toMatchObject([
        { template: 'VERIFY_EMAIL', toAddress: 'new-address@example.com', locale: 'ja' },
      ]);
    });

    it('[15.1] 言語は作成した時点の会員の言語（後で言語を変えても、作ったメールの言語は変わらない。TC-MB-231）', async () => {
      const m = await member({ locale: 'ja' });
      await runInTransaction(db.prisma, (tx) =>
        mail.enqueue(tx, m.id, 'PAYMENT_COMPLETED', SAMPLE_MAIL_PAYLOADS.PAYMENT_COMPLETED),
      );
      await db.prisma.member.update({ where: { id: m.id }, data: { preferredLocale: 'ko' } });
      clock.advance(60_000);
      await runInTransaction(db.prisma, (tx) =>
        mail.enqueue(tx, m.id, 'RESERVATION_CANCELLED', SAMPLE_MAIL_PAYLOADS.RESERVATION_CANCELLED),
      );
      const rows = await listOutbox(db.prisma, { memberId: m.id });
      expect(rows.map((row) => [row.template, row.locale])).toEqual([
        ['PAYMENT_COMPLETED', 'ja'],
        ['RESERVATION_CANCELLED', 'ko'],
      ]);
    });

    it('[15.1] 内容は会員の言語を受け取る関数でも渡せる（客室タイプの名称などを会員の言語で入れるため）', async () => {
      const m = await member({ locale: 'en' });
      await runInTransaction(db.prisma, (tx) =>
        mail.enqueue(tx, m.id, 'HOLD_EXPIRED', async (locale) => ({
          ...SAMPLE_MAIL_PAYLOADS.HOLD_EXPIRED,
          roomTypeName: locale === 'en' ? 'Standard King' : 'スタンダード キング',
        })),
      );
      const rows = await listOutbox(db.prisma, { memberId: m.id });
      expect(rows[0]?.payload).toMatchObject({ roomTypeName: 'Standard King' });
      expect(renderOutboxRow(rows[0]!).body).toContain('Standard King');
    });

    it('呼び出し元のトランザクションが取り消されれば、メールも残らない（業務の処理と同じトランザクションで作る）', async () => {
      const m = await member();
      await expect(
        runInTransaction(db.prisma, async (tx) => {
          await mail.enqueue(tx, m.id, 'PAYMENT_COMPLETED', SAMPLE_MAIL_PAYLOADS.PAYMENT_COMPLETED);
          throw new Error('業務の処理の失敗');
        }),
      ).rejects.toThrow('業務の処理の失敗');
      expect(await listOutbox(db.prisma, { memberId: m.id })).toEqual([]);
    });

    it('トランザクションの外の接続・形の誤った内容・存在しない会員は断る（行を作らない）', async () => {
      const m = await member();
      await expect(
        mail.enqueue(
          db.prisma as never,
          m.id,
          'PAYMENT_COMPLETED',
          SAMPLE_MAIL_PAYLOADS.PAYMENT_COMPLETED,
        ),
      ).rejects.toThrow('トランザクション');
      await expect(
        runInTransaction(db.prisma, (tx) =>
          mail.enqueue(tx, m.id, 'PAYMENT_COMPLETED', {
            ...SAMPLE_MAIL_PAYLOADS.PAYMENT_COMPLETED,
            amount: -1,
          }),
        ),
      ).rejects.toThrow(RangeError);
      await expect(
        runInTransaction(db.prisma, (tx) =>
          mail.enqueue(
            tx,
            '00000000-0000-4000-8000-000000000000',
            'PAYMENT_COMPLETED',
            SAMPLE_MAIL_PAYLOADS.PAYMENT_COMPLETED,
          ),
        ),
      ).rejects.toThrow();
      expect(await listOutbox(db.prisma, { memberId: m.id })).toEqual([]);
    });

    it('内容に余計な項目（氏名など）を渡しても、テンプレートの項目だけを保存する', async () => {
      const m = await member();
      await runInTransaction(db.prisma, (tx) =>
        mail.enqueue(tx, m.id, 'PAYMENT_COMPLETED', {
          ...SAMPLE_MAIL_PAYLOADS.PAYMENT_COMPLETED,
          familyName: '山田',
        } as typeof SAMPLE_MAIL_PAYLOADS.PAYMENT_COMPLETED),
      );
      const [row] = await listOutbox(db.prisma, { memberId: m.id });
      expect(row?.payload).toEqual(SAMPLE_MAIL_PAYLOADS.PAYMENT_COMPLETED);
    });
  });

  describe('支払いのお願い（PAYMENT_REQUEST）', () => {
    it('[15.8] 振込先は hotel_settings から読んで内容に入れ、未回収の額とともに会員の言語で作る（TC-MB-330、TC-CH-180）', async () => {
      await db.prisma.hotelSetting.createMany({ data: [...SAMPLE_BANK_SETTINGS] });
      try {
        const m = await member({ locale: 'en' });
        await runInTransaction(db.prisma, (tx) =>
          mail.enqueue(tx, m.id, 'PAYMENT_REQUEST', {
            reservationNumber: 'AB12CD34EF',
            amount: 28_000,
          }),
        );
        const rows = await listOutbox(db.prisma, { memberId: m.id });
        expect(rows).toMatchObject([
          { template: 'PAYMENT_REQUEST', locale: 'en', toAddress: m.email },
        ]);
        expect(rows[0]?.payload).toEqual(SAMPLE_MAIL_PAYLOADS.PAYMENT_REQUEST);
        const rendered = renderOutboxRow(rows[0]!);
        expect(rendered.subject).toContain('Request for payment');
        for (const text of [
          'JPY 28,000',
          'サンプル銀行',
          '金沢支店',
          '1234567',
          'サンプルホテル カナザワ',
        ]) {
          expect(rendered.body).toContain(text);
        }
      } finally {
        await db.prisma.hotelSetting.deleteMany({});
      }
    });

    it('振込先の設定が足りなければ断る（振込先のない支払いのお願いを作らない）', async () => {
      const m = await member();
      await expect(
        runInTransaction(db.prisma, (tx) =>
          mail.enqueue(tx, m.id, 'PAYMENT_REQUEST', {
            reservationNumber: 'AB12CD34EF',
            amount: 28_000,
          }),
        ),
      ).rejects.toThrow('bank_transfer');
      expect(await listOutbox(db.prisma, { memberId: m.id })).toEqual([]);
    });
  });

  describe('定期配信（MARKETING）', () => {
    const content = { subject: 'テストの配信', body: 'テストの本文' };
    let c: { id: string; email: string };
    let d: { id: string; email: string };
    let e: { id: string; email: string };
    let f: { id: string; email: string };
    let w2: { id: string; email: string };

    beforeAll(async () => {
      c = await member({ locale: 'en' });
      await insertConsents(db.prisma, c.id, [
        { consented: true, recordedAt: '2026-11-01T10:00:00+09:00' },
      ]);
      d = await member();
      e = await member();
      await insertConsents(db.prisma, e.id, [
        { consented: true, recordedAt: '2026-11-01T10:00:00+09:00' },
        { consented: false, recordedAt: '2026-11-02T10:00:00+09:00' },
      ]);
      f = await member();
      await insertConsents(db.prisma, f.id, [
        { consented: true, recordedAt: '2026-11-01T10:00:00+09:00' },
        { consented: false, recordedAt: '2026-11-02T10:00:00+09:00' },
        { consented: true, recordedAt: '2026-11-03T10:00:00+09:00' },
      ]);
      w2 = await member({ status: 'WITHDRAWN' });
      await insertConsents(db.prisma, w2.id, [
        { consented: true, recordedAt: '2026-11-01T10:00:00+09:00' },
      ]);
    });

    it('[15.6][15.7] 同意が最新で true の会員には、送信者の名称と署名つきの配信停止のリンクを入れて作る（TC-MB-261・266・267）', async () => {
      const created = await runInTransaction(db.prisma, (tx) =>
        mail.enqueueMarketing(tx, c.id, content),
      );
      expect(created).not.toBeNull();
      const rows = await listOutbox(db.prisma, { memberId: c.id, template: 'MARKETING' });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ toAddress: c.email, locale: 'en', status: 'PENDING' });
      const rendered = renderOutboxRow(rows[0]!);
      expect(rendered.subject).toBe('テストの配信');
      expect(rendered.body).toContain('テストの本文');
      expect(rendered.body).toContain('Sender: Sample Hotel Kanazawa');
      const link = extractLinks(rendered.body).find((url) => url.includes('/unsubscribe?token='));
      expect(link).toBeDefined();
      const token = new URL(String(link)).searchParams.get('token');
      expect(verifyUnsubscribeToken(TEST_MAIL_SETTINGS.unsubscribeTokenSecret, token)).toEqual({
        memberId: c.id,
        issuedAt: new Date(NOW),
      });
    });

    it.each([
      ['一度も同意していない会員D（TC-MB-262）', () => d],
      ['同意を取り消した会員E（TC-MB-263）', () => e],
      ['同意した後に退会した会員W2（TC-MB-265）', () => w2],
    ])('[15.6] %s には作らない', async (_label, target) => {
      const created = await runInTransaction(db.prisma, (tx) =>
        mail.enqueueMarketing(tx, target().id, content),
      );
      expect(created).toBeNull();
      expect(await listOutbox(db.prisma, { memberId: target().id })).toEqual([]);
    });

    it('[15.6] 取り消した後に再び同意した会員F には作る（最新の行が現在の状態。TC-MB-264）', async () => {
      const created = await runInTransaction(db.prisma, (tx) =>
        mail.enqueueMarketing(tx, f.id, content),
      );
      expect(created).not.toBeNull();
      expect(await listOutbox(db.prisma, { memberId: f.id, template: 'MARKETING' })).toHaveLength(
        1,
      );
    });

    it('[15.6] 配信の仕組み（全員への配信）は、同意が最新で true の有効な会員だけに、会員の言語で作る', async () => {
      await db.prisma.mailOutbox.deleteMany({ where: { template: 'MARKETING' } });
      const count = await runInTransaction(db.prisma, (tx) =>
        mail.enqueueMarketingToConsentedMembers(tx, (locale) => ({
          subject: `配信（${locale}）`,
          body: '本文',
        })),
      );
      expect(count).toBe(2);
      const rows = await listOutbox(db.prisma, { template: 'MARKETING' });
      expect(rows.map((row) => row.memberId).sort()).toEqual([c.id, f.id].sort());
      expect(rows.find((row) => row.memberId === c.id)).toMatchObject({ locale: 'en' });
      expect(renderOutboxRow(rows.find((row) => row.memberId === c.id)!).subject).toBe(
        '配信（en）',
      );
    });

    it('定期配信は取引のメールの関数（enqueue）では作れない（同意と配信停止のリンクを必ず通すため）', async () => {
      await expect(
        runInTransaction(db.prisma, (tx) =>
          mail.enqueue(tx, c.id, 'MARKETING' as never, SAMPLE_MAIL_PAYLOADS.MARKETING as never),
        ),
      ).rejects.toThrow(RangeError);
    });
  });

  describe('送れなかったメールと会員の削除', () => {
    it('[15.1] 送れなかった（FAILED）メールを、警告の一覧のために古い順に返す（宛先の会員・テンプレート・予約番号）', async () => {
      const m = await member();
      const first = await runInTransaction(db.prisma, (tx) =>
        mail.enqueue(tx, m.id, 'PAYMENT_COMPLETED', SAMPLE_MAIL_PAYLOADS.PAYMENT_COMPLETED),
      );
      clock.advance(60_000);
      const second = await runInTransaction(db.prisma, (tx) =>
        mail.enqueue(tx, m.id, 'VERIFY_EMAIL', { token: 't' }),
      );
      const ids = [first.id, second.id];
      await db.prisma.mailOutbox.updateMany({
        where: { id: { in: ids } },
        data: { status: 'FAILED', attempts: 5 },
      });
      const failed = (await mail.listFailed(db.prisma)).filter((row) => row.memberId === m.id);
      expect(failed).toEqual([
        {
          id: ids[0],
          memberId: m.id,
          toAddress: m.email,
          template: 'PAYMENT_COMPLETED',
          locale: 'ja',
          attempts: 5,
          createdAt: new Date(NOW),
          reservationNumber: 'AB12CD34EF',
        },
        {
          id: ids[1],
          memberId: m.id,
          toAddress: m.email,
          template: 'VERIFY_EMAIL',
          locale: 'ja',
          attempts: 5,
          createdAt: new Date(new Date(NOW).getTime() + 60_000),
          reservationNumber: null,
        },
      ]);
    });

    it('[19.4] 会員を削除するときに、その会員のメールの行（宛先・本文）だけを削除できる（DT-M34）', async () => {
      const target = await member();
      const other = await member();
      await runInTransaction(db.prisma, async (tx) => {
        await mail.enqueue(
          tx,
          target.id,
          'PAYMENT_COMPLETED',
          SAMPLE_MAIL_PAYLOADS.PAYMENT_COMPLETED,
        );
        await mail.enqueue(tx, target.id, 'PRE_ARRIVAL', SAMPLE_MAIL_PAYLOADS.PRE_ARRIVAL);
        await mail.enqueue(
          tx,
          other.id,
          'PAYMENT_COMPLETED',
          SAMPLE_MAIL_PAYLOADS.PAYMENT_COMPLETED,
        );
      });
      const deleted = await runInTransaction(db.prisma, (tx) =>
        mail.deleteForMember(tx, target.id),
      );
      expect(deleted).toBe(2);
      expect(await listOutbox(db.prisma, { memberId: target.id })).toEqual([]);
      expect(await listOutbox(db.prisma, { memberId: other.id })).toHaveLength(1);
    });

    it('社内用の待ち受け口でも同じ MailService を使える（フロントの登録・定時処理から作るため）', () => {
      expect(staff.get(MailService)).toBeInstanceOf(MailService);
    });
  });
});
