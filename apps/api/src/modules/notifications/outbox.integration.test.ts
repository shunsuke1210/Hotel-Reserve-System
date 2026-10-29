// 定時処理 outbox（送信待ちのメールを毎分送る）を、テスト用のデータベースで確かめる
// （tasks.md 3.4、design.md 定時処理 outbox・「定時処理の失敗」、TC-MB-268〜273）。
// 「最大5回」は送信の試行の合計が5回：4回目の失敗の後は PENDING（attempts=4）、5回目の失敗で FAILED（TC-MB-270・271）。
import type { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MailSender, type OutgoingMail } from '../../integrations/mail/mail-sender.port.js';
import { TestMailSender } from '../../integrations/testing/test-mail-sender.js';
import { JobScheduler } from '../jobs/job-scheduler.js';
import { JOB_SCHEDULES } from '../jobs/job-schedules.js';
import { FixedBusinessClock } from '../../shared/clock/business-clock.js';
import { JobLogSink } from '../../shared/jobs/job-log.js';
import type { JobRunOutcome } from '../../shared/jobs/scheduled-job.js';
import { runInTransaction } from '../../shared/prisma/transaction.js';
import { insertMember } from '../../test/auth/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../../test/database/test-database.js';
import { deferred, MemoryJobLogSink } from '../../test/jobs.js';
import { createTestListenerApp } from '../../test/listener-app.js';
import {
  insertConsents,
  insertPendingMail,
  listOutbox,
  renderOutboxRow,
  SAMPLE_MAIL_PAYLOADS,
} from '../../test/mail.js';
import { MailService } from './mail.service.js';
import { OUTBOX_SEND_TIMEOUT_MS, OutboxProcessor } from './outbox.processor.js';

const NOW = '2026-11-10T10:00:00+09:00';
const ADDRESS = 'outbox-member@example.com';

/** 呼ばれた送信を数える MailSender（失敗させる・止めることもできる） */
class RecordingMailSender extends TestMailSender {
  readonly calls: OutgoingMail[] = [];
  private hold: Promise<void> | undefined;

  /** 以後の送信を、release を呼ぶまで終わらせない（時間切れを確かめるため） */
  holdUntil(release: Promise<void>): void {
    this.hold = release;
  }

  override async send(mail: OutgoingMail): Promise<void> {
    this.calls.push(mail);
    if (this.hold) await this.hold;
    await super.send(mail);
  }
}

describe('定時処理 outbox（送信待ちのメールの送信）', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let sender: RecordingMailSender;
  const clock = new FixedBusinessClock(NOW);

  async function runOutbox(): Promise<JobRunOutcome> {
    return app.get(JobScheduler).runNow('outbox');
  }

  async function rowOf(id: string) {
    return db.prisma.mailOutbox.findUniqueOrThrow({ where: { id } });
  }

  beforeAll(async () => {
    db = await createTestDatabase();
  });
  beforeEach(async () => {
    clock.set(NOW);
    sender = new RecordingMailSender();
    app = await createTestListenerApp('staff', {
      prisma: db.prisma,
      clock,
      jobLogSink: new MemoryJobLogSink(),
      overrides: [
        { provide: MailSender, useValue: sender },
        { provide: OUTBOX_SEND_TIMEOUT_MS, useValue: 200 },
      ],
    });
  });
  afterEach(async () => {
    await app?.close();
    await db.prisma.mailOutbox.deleteMany({});
  });
  afterAll(async () => {
    await db?.drop();
  });

  it('[15 全体] outbox は社内用の待ち受け口に、毎分の処理として登録されている', () => {
    const job = app.get(OutboxProcessor);
    expect(job.name).toBe('outbox');
    expect(job.schedule).toBe(JOB_SCHEDULES.outbox);
    expect(JOB_SCHEDULES.outbox).toBe('* * * * *');
  });

  it('[15.1] 送信待ちの行を MailSender で送り、SENT にして sent_at に実行の日時を入れる（TC-MB-268）', async () => {
    const id = await insertPendingMail(db.prisma, {
      toAddress: ADDRESS,
      locale: 'en',
      template: 'RESERVATION_CONFIRMED',
    });
    const outcome = await runOutbox();
    expect(outcome).toMatchObject({ status: 'FINISHED', result: 'SUCCEEDED' });
    const row = await rowOf(id);
    expect(row).toMatchObject({ status: 'SENT', attempts: 0, sentAt: new Date(NOW) });
    // 送った内容は、行のテンプレート・言語・内容から組み立てた文面
    expect(sender.calls).toEqual([{ to: ADDRESS, ...renderOutboxRow(row) }]);
    expect(sender.calls[0]?.subject).toContain('Your reservation is confirmed');
    expect(sender.sentMails()).toHaveLength(1);
    if (outcome.status === 'FINISHED') {
      expect(outcome.detail.summary).toEqual({
        sent: 1,
        retryScheduled: 0,
        failed: 0,
        consentWithdrawn: 0,
      });
      expect(outcome.detail.targets?.mail).toMatchObject({ selected: 1, done: 1, failed: 0 });
    }

    // 送った行は次の回で送らない
    await runOutbox();
    expect(sender.calls).toHaveLength(1);
  });

  it('[15.1] 失敗したら attempts を増やして PENDING のまま次の回に再送し、5回目の失敗で FAILED にする。FAILED の後は送らない（TC-MB-269〜271・273）', async () => {
    const id = await insertPendingMail(db.prisma, { toAddress: ADDRESS });
    sender.failWith(new Error(`SMTP 550 mailbox unavailable: ${ADDRESS}`));

    const first = await runOutbox();
    expect(await rowOf(id)).toMatchObject({ status: 'PENDING', attempts: 1, sentAt: null });
    expect(first).toMatchObject({ status: 'FINISHED', result: 'FAILED' });
    if (first.status === 'FINISHED') {
      expect(first.detail.targets?.mail).toMatchObject({ failed: 1, failedTargetIds: [id] });
      expect(first.detail.summary).toEqual({
        sent: 0,
        retryScheduled: 1,
        failed: 0,
        consentWithdrawn: 0,
      });
    }

    for (let attempt = 2; attempt <= 4; attempt += 1) {
      clock.advance(60_000);
      await runOutbox();
      expect(await rowOf(id)).toMatchObject({ status: 'PENDING', attempts: attempt });
    }

    clock.advance(60_000);
    const fifth = await runOutbox();
    expect(await rowOf(id)).toMatchObject({ status: 'FAILED', attempts: 5, sentAt: null });
    if (fifth.status === 'FINISHED') {
      expect(fifth.detail.summary).toEqual({
        sent: 0,
        retryScheduled: 0,
        failed: 1,
        consentWithdrawn: 0,
      });
    }
    expect(sender.calls).toHaveLength(5);

    sender.failWith(null);
    clock.advance(60_000);
    const after = await runOutbox();
    expect(after).toMatchObject({ status: 'FINISHED', result: 'SUCCEEDED' });
    expect(sender.calls).toHaveLength(5);
    expect(await rowOf(id)).toMatchObject({ status: 'FAILED', attempts: 5 });

    // 送れなかった理由（宛先を含む文言）は、job_runs とログに書かない
    const runs = await db.prisma.jobRun.findMany({ where: { job: 'outbox' } });
    expect(JSON.stringify(runs)).not.toContain(ADDRESS);
    const logs = (app.get(JobLogSink) as MemoryJobLogSink).ofEvent('JOB_TARGET_FAILED');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]).toMatchObject({
      kind: 'mail',
      targetId: id,
      error: { name: 'MailDeliveryError', code: 'MAIL_SEND_FAILED' },
    });
    expect(JSON.stringify(logs)).not.toContain(ADDRESS);
  });

  it('[15.1] 失敗の後に送れれば SENT になり、それまでの失敗の回数は残る', async () => {
    const id = await insertPendingMail(db.prisma);
    sender.failWith(new Error('一時的な障害'));
    await runOutbox();
    await runOutbox();
    sender.failWith(null);
    clock.advance(60_000);
    await runOutbox();
    expect(await rowOf(id)).toMatchObject({
      status: 'SENT',
      attempts: 2,
      sentAt: new Date(clock.now()),
    });
  });

  it('[15.1] 送信が時間内に終わらなければ失敗として数え、次の回に再送する', async () => {
    const id = await insertPendingMail(db.prisma);
    const release = deferred();
    sender.holdUntil(release.promise);
    try {
      const outcome = await runOutbox();
      expect(outcome).toMatchObject({ status: 'FINISHED', result: 'FAILED' });
      expect(await rowOf(id)).toMatchObject({ status: 'PENDING', attempts: 1 });
      const logs = (app.get(JobLogSink) as MemoryJobLogSink).ofEvent('JOB_TARGET_FAILED');
      expect(logs[0]?.error).toEqual({ name: 'MailDeliveryError', code: 'MAIL_SEND_TIMEOUT' });
    } finally {
      release.resolve();
    }
  });

  it('[15.1] 内容の形が誤っていて文面を作れない行は、送らずに失敗として数える', async () => {
    const id = await insertPendingMail(db.prisma, {
      template: 'PAYMENT_COMPLETED',
      payload: { reservationNumber: 'AB12CD34EF' },
    });
    await runOutbox();
    expect(sender.calls).toEqual([]);
    expect(await rowOf(id)).toMatchObject({ status: 'PENDING', attempts: 1 });
    const logs = (app.get(JobLogSink) as MemoryJobLogSink).ofEvent('JOB_TARGET_FAILED');
    expect(logs[0]?.error).toEqual({ name: 'MailDeliveryError', code: 'MAIL_RENDER_FAILED' });
  });

  it('[15.1] 1通の失敗は、ほかのメールの送信を止めない（古い順に送る）', async () => {
    const broken = await insertPendingMail(db.prisma, {
      payload: {},
      createdAt: new Date('2026-11-10T09:00:00+09:00'),
    });
    const ok = await insertPendingMail(db.prisma, {
      template: 'VERIFY_EMAIL',
      payload: SAMPLE_MAIL_PAYLOADS.VERIFY_EMAIL,
      createdAt: new Date('2026-11-10T09:30:00+09:00'),
    });
    await runOutbox();
    expect(await rowOf(broken)).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(await rowOf(ok)).toMatchObject({ status: 'SENT' });
  });

  it('[15.1] ほかの実行が送っている途中の行（行のロック中）は飛ばし、二重に送らない（重なった実行。tasks.md 3.2 の注意）', async () => {
    const id = await insertPendingMail(db.prisma);
    const locked = deferred();
    const release = deferred();
    // 別のトランザクションが行のロックを持っている間に outbox を実行する
    const holder = db.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM mail_outbox WHERE id = ${id}::uuid FOR UPDATE`;
        locked.resolve();
        await release.promise;
      },
      { timeout: 20_000 },
    );
    await locked.promise;
    try {
      const outcome = await runOutbox();
      expect(outcome).toMatchObject({ status: 'FINISHED', result: 'SUCCEEDED' });
      if (outcome.status === 'FINISHED') {
        expect(outcome.detail.targets?.mail).toMatchObject({ selected: 1, skipped: 1, done: 0 });
      }
      expect(sender.calls).toEqual([]);
      expect(await rowOf(id)).toMatchObject({ status: 'PENDING', attempts: 0 });
    } finally {
      release.resolve();
      await holder;
    }
    await runOutbox();
    expect(sender.calls).toHaveLength(1);
    expect(await rowOf(id)).toMatchObject({ status: 'SENT' });
  });

  it('[15.1] 選んだ後にほかの実行が送り終えた行（SENT）は、確かめ直して送らない', async () => {
    const id = await insertPendingMail(db.prisma);
    const processor = app.get(OutboxProcessor);
    await db.prisma.mailOutbox.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date(NOW) },
    });
    await expect(processor.deliver(id, new Date(NOW))).resolves.toBe('SKIPPED');
    expect(sender.calls).toEqual([]);
  });

  describe('定期配信は、送る時点でも同意を確かめ直す（15.6、brief.md NT-03a：取り消した後は送らない）', () => {
    let sequence = 0;
    const CONTENT = { subject: '冬のご案内', body: '本文' };

    /** 同意している会員と、その会員宛ての送信待ちの定期配信を作る */
    async function consentingMemberWithMarketing(): Promise<{ memberId: string; mailId: string }> {
      sequence += 1;
      const memberId = await insertMember(db.prisma, {
        email: `marketing${sequence}@example.com`,
        phone: `0902000${String(sequence).padStart(4, '0')}`,
        passwordHash: 'hash',
      });
      await insertConsents(db.prisma, memberId, [
        { consented: true, recordedAt: '2026-11-01T10:00:00+09:00' },
      ]);
      const created = await runInTransaction(db.prisma, (tx) =>
        app.get(MailService).enqueueMarketing(tx, memberId, CONTENT),
      );
      if (created === null) throw new Error('前提の定期配信を作れませんでした');
      return { memberId, mailId: created.id };
    }

    it('[15.6] 作った後に同意を取り消した会員には送らず、行を消す（送れなかったメールにはしない）', async () => {
      const { memberId } = await consentingMemberWithMarketing();
      await insertConsents(db.prisma, memberId, [
        { consented: false, recordedAt: '2026-11-10T10:00:30+09:00' },
      ]);
      const outcome = await runOutbox();
      expect(sender.calls).toEqual([]);
      expect(await listOutbox(db.prisma, { memberId })).toEqual([]);
      expect(outcome).toMatchObject({ status: 'FINISHED', result: 'SUCCEEDED' });
      if (outcome.status === 'FINISHED') {
        expect(outcome.detail.summary).toEqual({
          sent: 0,
          retryScheduled: 0,
          failed: 0,
          consentWithdrawn: 1,
        });
        expect(outcome.detail.targets?.mail).toMatchObject({ selected: 1, skipped: 1, failed: 0 });
      }
      expect(await app.get(MailService).listFailed(db.prisma)).toEqual([]);
    });

    it('[15.6][1.11] 作った後に退会した会員（同意を削除・WITHDRAWN）には送らず、行を消す', async () => {
      const { memberId } = await consentingMemberWithMarketing();
      await db.prisma.marketingConsent.deleteMany({ where: { memberId } });
      await db.prisma.member.update({ where: { id: memberId }, data: { status: 'WITHDRAWN' } });
      await runOutbox();
      expect(sender.calls).toEqual([]);
      expect(await listOutbox(db.prisma, { memberId })).toEqual([]);
    });

    it('[15.6][19.4] 宛先の会員がもういない（削除された）定期配信は送らず、行を消す', async () => {
      const { memberId, mailId } = await consentingMemberWithMarketing();
      await db.prisma.marketingConsent.deleteMany({ where: { memberId } });
      await db.prisma.member.delete({ where: { id: memberId } });
      await runOutbox();
      expect(sender.calls).toEqual([]);
      expect(await db.prisma.mailOutbox.findUnique({ where: { id: mailId } })).toBeNull();
    });

    it('[15.6] 同意が最新で有効でも、退会していれば送らない', async () => {
      const { memberId } = await consentingMemberWithMarketing();
      await db.prisma.member.update({ where: { id: memberId }, data: { status: 'WITHDRAWN' } });
      await runOutbox();
      expect(sender.calls).toEqual([]);
      expect(await listOutbox(db.prisma, { memberId })).toEqual([]);
    });

    it('[15.6] 取り消した後、実行の前に再び同意した会員には送る（最新の行が現在の状態）', async () => {
      const { memberId, mailId } = await consentingMemberWithMarketing();
      await insertConsents(db.prisma, memberId, [
        { consented: false, recordedAt: '2026-11-10T10:00:30+09:00' },
        { consented: true, recordedAt: '2026-11-10T10:00:40+09:00' },
      ]);
      await runOutbox();
      expect(sender.calls).toHaveLength(1);
      expect(sender.calls[0]?.to).toBe(`marketing${sequence}@example.com`);
      expect(await rowOf(mailId)).toMatchObject({ status: 'SENT', sentAt: new Date(NOW) });
    });

    it('取引のメール（定期配信以外）は、同意に関係なく送る', async () => {
      const { memberId } = await consentingMemberWithMarketing();
      await insertConsents(db.prisma, memberId, [
        { consented: false, recordedAt: '2026-11-10T10:00:30+09:00' },
      ]);
      const id = await insertPendingMail(db.prisma, { memberId });
      await runOutbox();
      expect(sender.calls).toHaveLength(1);
      expect(await rowOf(id)).toMatchObject({ status: 'SENT' });
    });
  });
});
