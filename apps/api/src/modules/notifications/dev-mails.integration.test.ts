// 開発用のメールの一覧（GET /api/staff/dev/mails）と、tasks.md 3.4 の完了状態を、テスト用のデータベースで確かめる。
// 完了状態：英語を選んだ会員への予約完了のメールが英語で作られ、同意を取り消した会員には定期配信のメールが作られず、
// 開発用の一覧にメールが表示される。
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedBusinessClock } from '../../shared/clock/business-clock.js';
import { runInTransaction } from '../../shared/prisma/transaction.js';
import { insertMember, insertStaff } from '../../test/auth/fixtures.js';
import { signIn } from '../../test/auth/sessions.js';
import { createTestDatabase, type TestDatabase } from '../../test/database/test-database.js';
import { createTestListenerApp } from '../../test/listener-app.js';
import {
  insertConsents,
  listOutbox,
  SAMPLE_MAIL_PAYLOADS,
  TEST_MAIL_SETTINGS,
} from '../../test/mail.js';
import { JobScheduler } from '../jobs/job-scheduler.js';
import { MailService } from './mail.service.js';

const NOW = '2026-11-10T10:00:00+09:00';
const BASE = TEST_MAIL_SETTINGS.guestWebBaseUrl;

describe('開発用のメールの一覧（GET /api/staff/dev/mails）', () => {
  let db: TestDatabase;
  let guest: INestApplication;
  let staff: INestApplication;
  let frontCookie: string;
  let cleanerCookie: string;
  let english: { id: string; email: string };
  let revoked: { id: string; email: string };
  let consenting: { id: string; email: string };
  const clock = new FixedBusinessClock(NOW);

  function list(query: Record<string, string> = {}, cookie = frontCookie) {
    return request(staff.getHttpServer())
      .get('/api/staff/dev/mails')
      .query(query)
      .set('Cookie', cookie);
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    guest = await createTestListenerApp('guest', { prisma: db.prisma, clock });
    staff = await createTestListenerApp('staff', { prisma: db.prisma, clock });
    frontCookie = await signIn(
      staff,
      'STAFF',
      await insertStaff(db.prisma, { staffNumber: 'S101', role: 'FRONT', passwordHash: 'x' }),
    );
    cleanerCookie = await signIn(
      staff,
      'STAFF',
      await insertStaff(db.prisma, { staffNumber: 'S201', role: 'CLEANER', passwordHash: 'x' }),
    );
    english = { id: '', email: 'english@example.com' };
    english.id = await insertMember(db.prisma, {
      email: english.email,
      phone: '09011110001',
      passwordHash: 'x',
      preferredLocale: 'en',
    });
    revoked = { id: '', email: 'revoked@example.com' };
    revoked.id = await insertMember(db.prisma, {
      email: revoked.email,
      phone: '09011110002',
      passwordHash: 'x',
    });
    await insertConsents(db.prisma, revoked.id, [
      { consented: true, recordedAt: '2026-11-01T10:00:00+09:00' },
      { consented: false, recordedAt: '2026-11-05T10:00:00+09:00' },
    ]);
    consenting = { id: '', email: 'consenting@example.com' };
    consenting.id = await insertMember(db.prisma, {
      email: consenting.email,
      phone: '09011110003',
      passwordHash: 'x',
      preferredLocale: 'ko',
    });
    await insertConsents(db.prisma, consenting.id, [
      { consented: true, recordedAt: '2026-11-01T10:00:00+09:00' },
    ]);
  });
  afterAll(async () => {
    await guest?.close();
    await staff?.close();
    await db?.drop();
  });

  it('[15.1][15.6][16.2 完了状態] 英語の会員の予約完了のメールは英語で作られ、同意を取り消した会員には定期配信が作られず、開発用の一覧にメールが表示される', async () => {
    // 公開用の待ち受け口の処理（確定など）が作るのと同じく、MailService で作る
    const mail = guest.get(MailService);
    await runInTransaction(db.prisma, async (tx) => {
      await mail.enqueue(
        tx,
        english.id,
        'RESERVATION_CONFIRMED',
        SAMPLE_MAIL_PAYLOADS.RESERVATION_CONFIRMED,
      );
      expect(
        await mail.enqueueMarketing(tx, revoked.id, { subject: 'News', body: 'Body' }),
      ).toBeNull();
      expect(
        await mail.enqueueMarketing(tx, consenting.id, { subject: 'News', body: 'Body' }),
      ).not.toBeNull();
    });
    expect(await listOutbox(db.prisma, { memberId: revoked.id })).toEqual([]);

    const res = await list();
    expect(res.status).toBe(200);
    const confirmed = res.body.mails.find(
      (item: { to: string; template: string }) =>
        item.to === english.email && item.template === 'RESERVATION_CONFIRMED',
    );
    expect(confirmed).toMatchObject({
      memberId: english.id,
      locale: 'en',
      status: 'PENDING',
      attempts: 0,
      createdAt: new Date(NOW).toISOString(),
      sentAt: null,
    });
    expect(confirmed.subject).toContain('Your reservation is confirmed');
    expect(confirmed.body).toContain('Thank you for your reservation');
    expect(confirmed.body).toContain('JPY 61,900');

    const marketing = res.body.mails.find(
      (item: { template: string }) => item.template === 'MARKETING',
    );
    expect(marketing).toMatchObject({ to: consenting.email, locale: 'ko', subject: 'News' });
    expect(
      marketing.links.some((link: string) => link.startsWith(`${BASE}/unsubscribe?token=`)),
    ).toBe(true);
    expect(res.body.mails.some((item: { to: string }) => item.to === revoked.email)).toBe(false);
  });

  it('[1.4] 画面のテストは、宛先とテンプレートで絞り込み、確認のリンクを取り出せる', async () => {
    await runInTransaction(db.prisma, (tx) =>
      guest.get(MailService).enqueue(tx, english.id, 'VERIFY_EMAIL', { token: 'link-token-1' }),
    );
    clock.advance(1_000);
    await runInTransaction(db.prisma, (tx) =>
      guest.get(MailService).enqueue(tx, english.id, 'VERIFY_EMAIL', { token: 'link-token-2' }),
    );
    const res = await list({ to: 'ENGLISH@example.com', template: 'VERIFY_EMAIL' });
    expect(res.status).toBe(200);
    expect(res.body.mails).toHaveLength(2);
    // 新しい順
    expect(res.body.mails[0].links).toContain(`${BASE}/verify-email?token=link-token-2`);
    expect(res.body.mails[1].links).toContain(`${BASE}/verify-email?token=link-token-1`);
    const limited = await list({ to: english.email, template: 'VERIFY_EMAIL', limit: '1' });
    expect(limited.body.mails).toHaveLength(1);
    expect(limited.body.mails[0].links).toContain(`${BASE}/verify-email?token=link-token-2`);
  });

  it('[15.1] 送った後のメール（SENT）も、送った日時とともに一覧に出る', async () => {
    await staff.get(JobScheduler).runNow('outbox');
    const res = await list({ to: english.email, template: 'RESERVATION_CONFIRMED' });
    expect(res.body.mails[0]).toMatchObject({
      status: 'SENT',
      sentAt: new Date(clock.now()).toISOString(),
    });
  });

  it('文面を作れない行も、内容の誤りとして一覧に出す（一覧全体は失敗させない）', async () => {
    await db.prisma.mailOutbox.create({
      data: {
        memberId: english.id,
        toAddress: english.email,
        locale: 'en',
        template: 'PAYMENT_COMPLETED',
        payload: {},
        status: 'PENDING',
        attempts: 0,
      },
    });
    const res = await list({ to: english.email, template: 'PAYMENT_COMPLETED' });
    expect(res.status).toBe(200);
    expect(res.body.mails[0]).toMatchObject({
      subject: null,
      body: null,
      links: [],
      renderError: 'MAIL_RENDER_FAILED',
    });
  });

  it('[2.4] メールには会員の個人情報が入るので、フロント以上だけが見られる（ログインなしは401、清掃員は403）', async () => {
    const anonymous = await request(staff.getHttpServer()).get('/api/staff/dev/mails');
    expect(anonymous.status).toBe(401);
    const cleaner = await list({}, cleanerCookie);
    expect(cleaner.status).toBe(403);
    expect(cleaner.body.code).toBe('FORBIDDEN');
  });

  it('絞り込みの値が誤っていれば VALIDATION_FAILED', async () => {
    const queries: Record<string, string>[] = [
      { limit: '0' },
      { limit: '201' },
      { limit: 'x' },
      { template: 'NOPE' },
    ];
    for (const query of queries) {
      const res = await list(query);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });
});
