// 定時処理の土台（tasks.md 3.2）：多重起動の防止（PostgreSQL のアドバイザリーロック。research.md ADR-09）と、
// job_runs への開始・終了・結果の記録（design.md「定時処理の失敗」）を、テスト用のデータベースで確かめる。
// 2つの実行（2つの API のプロセス）は、同じデータベースへの別々の接続プール（PrismaService）で表す。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  connectPg,
  createTestDatabase,
  type TestDatabase,
} from '../../test/database/test-database.js';
import { gatedJob, MemoryJobLogSink, within } from '../../test/jobs.js';
import { FixedBusinessClock } from '../clock/business-clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JOB_LOCK_NAMESPACE, jobLockKey } from './job-lock.js';
import { JobRunner } from './job-runner.js';
import type { JobRunOutcome, ScheduledJob } from './scheduled-job.js';

const NOW = '2026-11-11T09:00:00+09:00';

describe('JobRunner（多重起動の防止と job_runs への記録）', () => {
  let db: TestDatabase;
  /** もう1つの実行（別のプロセスの API）を表す、同じデータベースへの別の接続プール */
  let otherPrisma: PrismaService;
  let clock: FixedBusinessClock;
  let logs: MemoryJobLogSink;
  let runner: JobRunner;

  beforeAll(async () => {
    db = await createTestDatabase();
    otherPrisma = new PrismaService(db.appUrl);
  });
  afterAll(async () => {
    await otherPrisma?.$disconnect();
    await db?.drop();
  });
  beforeEach(() => {
    clock = new FixedBusinessClock(NOW);
    logs = new MemoryJobLogSink();
    runner = new JobRunner(db.prisma, clock, logs);
  });

  /** job の job_runs の行（記録した順） */
  function jobRuns(job: string) {
    return db.prisma.jobRun.findMany({ where: { job }, orderBy: { createdAt: 'asc' } });
  }

  function finished(outcome: JobRunOutcome) {
    if (outcome.status !== 'FINISHED') {
      throw new Error(`実行が終わっていません（${outcome.status}）`);
    }
    return outcome;
  }

  it('[3.2 完了状態] テスト用の処理を2つの実行で同時に起動しても1回だけ実行され、job_runs に1件だけ残る（TC-IT-043・Q-IT-7）', async () => {
    const otherLogs = new MemoryJobLogSink();
    const otherRunner = new JobRunner(otherPrisma, clock, otherLogs);
    const test = gatedJob('test-concurrent');
    try {
      const runs = [runner.run(test.job), otherRunner.run(test.job)];
      // 実行した側は open() まで終わらないので、先に終わるのはロックを取れなかった側
      const first = await within(
        Promise.race(runs),
        'どちらの起動も終わりません（両方が実行しています）',
      );
      expect(first).toEqual({ status: 'SKIPPED_LOCKED' });
      test.open();
      const outcomes = await Promise.all(runs);

      expect(test.executions()).toBe(1);
      expect(outcomes.filter((outcome) => outcome.status === 'SKIPPED_LOCKED')).toHaveLength(1);
      const done = finished(outcomes.find((outcome) => outcome.status === 'FINISHED')!);
      expect(done.result).toBe('SUCCEEDED');

      // 実行した1回分だけを記録する（アプリ用の利用者 hotel_api で job_runs に書ける）
      const rows = await jobRuns('test-concurrent');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: done.runId,
        result: 'SUCCEEDED',
        startedAt: new Date(NOW),
        finishedAt: new Date(NOW),
        detail: { summary: { processed: 1 } },
      });

      // 実行しなかった起動は job_runs に記録せず、ログにだけ出す（Q-IT-7）
      const skipped = [...logs.ofEvent('JOB_SKIPPED'), ...otherLogs.ofEvent('JOB_SKIPPED')];
      expect(skipped).toEqual([{ event: 'JOB_SKIPPED', job: 'test-concurrent', reason: 'LOCKED' }]);
    } finally {
      test.open();
    }
  });

  it('同じ実行の中で同時に2回起動しても（同じ接続プールの別々の接続）、1回だけ実行される', async () => {
    const test = gatedJob('test-same-pool');
    try {
      const runs = [runner.run(test.job), runner.run(test.job)];
      await expect(
        within(Promise.race(runs), 'どちらの起動も終わりません（両方が実行しています）'),
      ).resolves.toEqual({ status: 'SKIPPED_LOCKED' });
      test.open();
      await Promise.all(runs);
      expect(test.executions()).toBe(1);
      expect(await jobRuns('test-same-pool')).toHaveLength(1);
    } finally {
      test.open();
    }
  });

  it('ほかのプロセスがロックを持っている間は実行せず記録もしない。ロックが外れれば次の起動で実行する', async () => {
    const test = gatedJob('test-held');
    test.open();
    // 別のプロセスと同じ名前空間・鍵で、セッション単位のアドバイザリーロックを取る
    const holder = await connectPg(db.appUrl);
    try {
      await holder.query('SELECT pg_advisory_lock($1::int4, $2::int4)', [
        JOB_LOCK_NAMESPACE,
        jobLockKey('test-held'),
      ]);
      expect(await runner.run(test.job)).toEqual({ status: 'SKIPPED_LOCKED' });
      expect(test.executions()).toBe(0);
      expect(await jobRuns('test-held')).toHaveLength(0);

      await holder.query('SELECT pg_advisory_unlock($1::int4, $2::int4)', [
        JOB_LOCK_NAMESPACE,
        jobLockKey('test-held'),
      ]);
      expect(await runner.run(test.job)).toMatchObject({ status: 'FINISHED', result: 'SUCCEEDED' });
      expect(test.executions()).toBe(1);
      expect(await jobRuns('test-held')).toHaveLength(1);
    } finally {
      await holder.end();
    }
  });

  it('終わった後はロックを放すので、次の起動も実行され、回ごとに1件ずつ記録する', async () => {
    const test = gatedJob('test-sequential');
    test.open();
    await runner.run(test.job);
    clock.set('2026-11-11T09:01:00+09:00');
    await runner.run(test.job);
    expect(test.executions()).toBe(2);
    const rows = await jobRuns('test-sequential');
    expect(rows.map((row) => [row.result, row.startedAt.toISOString()])).toEqual([
      ['SUCCEEDED', '2026-11-11T00:00:00.000Z'],
      ['SUCCEEDED', '2026-11-11T00:01:00.000Z'],
    ]);
  });

  it('開始の時点で RUNNING（終了時刻なし）を記録し、終わったら終了時刻・結果・内容を記録する。処理には開始の時刻を基準の時刻として渡す', async () => {
    const test = gatedJob('test-record');
    try {
      const run = runner.run(test.job);
      await within(test.entered, '処理が始まりません');

      const [running] = await jobRuns('test-record');
      expect(running).toMatchObject({
        job: 'test-record',
        result: 'RUNNING',
        startedAt: new Date(NOW),
        finishedAt: null,
        detail: {},
      });
      expect(test.contexts[0]).toMatchObject({
        job: 'test-record',
        runId: running!.id,
        now: new Date(NOW),
      });

      clock.set('2026-11-11T09:00:05+09:00');
      test.open();
      const outcome = finished(await run);
      expect(outcome).toMatchObject({ runId: running!.id, result: 'SUCCEEDED' });

      const rows = await jobRuns('test-record');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: running!.id,
        result: 'SUCCEEDED',
        startedAt: new Date(NOW),
        finishedAt: new Date('2026-11-11T09:00:05+09:00'),
        detail: { summary: { processed: 1 } },
      });
      expect(logs.entries.map((entry) => entry.event)).toEqual(['JOB_STARTED', 'JOB_FINISHED']);
      expect(logs.ofEvent('JOB_FINISHED')[0]).toMatchObject({
        job: 'test-record',
        runId: running!.id,
        result: 'SUCCEEDED',
      });
    } finally {
      test.open();
    }
  });

  it('処理が例外を投げたら FAILED と例外の種類を記録し（文言は記録しない）、ロックを放すので次の回は実行できる', async () => {
    let attempts = 0;
    const job: ScheduledJob = {
      name: 'test-failing',
      schedule: '* * * * *',
      async execute() {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error('山田 太郎 taro@example.com'), { code: 'P2034' });
        }
        return { processed: 0 };
      },
    };

    const first = finished(await runner.run(job));
    expect(first.result).toBe('FAILED');
    expect(first.detail).toEqual({ error: { name: 'Error', code: 'P2034' } });
    expect(logs.ofEvent('JOB_ERROR')).toEqual([
      {
        event: 'JOB_ERROR',
        job: 'test-failing',
        runId: first.runId,
        stage: 'EXECUTE',
        error: { name: 'Error', code: 'P2034' },
      },
    ]);

    const second = finished(await runner.run(job));
    expect(second.result).toBe('SUCCEEDED');
    const rows = await jobRuns('test-failing');
    expect(rows.map((row) => row.result)).toEqual(['FAILED', 'SUCCEEDED']);
    expect(rows[0]!.finishedAt).toEqual(new Date(NOW));
    expect(JSON.stringify(rows[0]!.detail)).not.toContain('taro');
  });

  it('対象を1件ずつ処理し、1件の失敗はほかの対象を止めない。失敗した対象だけが次の回で再び選ばれる（冪等）', async () => {
    const prefix = 'test-target-';
    await db.prisma.hotelSetting.createMany({
      data: ['a', 'b', 'c'].map((suffix) => ({ key: `${prefix}${suffix}`, value: 'PENDING' })),
    });
    let failOn: string | undefined = `${prefix}b`;
    const processed: string[] = [];
    const job: ScheduledJob = {
      name: 'test-targets',
      schedule: '* * * * *',
      async execute(ctx) {
        await ctx.processTargets({
          kind: 'setting',
          // 対象は今の状態だけで選ぶ（処理を終えた行は条件に当たらなくなる）
          select: () =>
            db.prisma.hotelSetting.findMany({
              where: { key: { startsWith: prefix }, value: 'PENDING' },
              orderBy: { key: 'asc' },
            }),
          idOf: (row) => row.key,
          process: async (row) => {
            processed.push(row.key);
            if (row.key === failOn) {
              throw Object.assign(new Error('山田 太郎'), { code: 'P2034' });
            }
            await db.prisma.hotelSetting.update({
              where: { key: row.key },
              data: { value: 'DONE' },
            });
            return 'DONE';
          },
        });
      },
    };

    const first = finished(await runner.run(job));
    expect(processed).toEqual([`${prefix}a`, `${prefix}b`, `${prefix}c`]);
    expect(first.result).toBe('FAILED');
    expect(first.detail).toEqual({
      targets: {
        setting: { selected: 3, done: 2, skipped: 0, failed: 1, failedTargetIds: [`${prefix}b`] },
      },
    });
    expect(logs.ofEvent('JOB_TARGET_FAILED')).toEqual([
      {
        event: 'JOB_TARGET_FAILED',
        job: 'test-targets',
        runId: first.runId,
        kind: 'setting',
        targetId: `${prefix}b`,
        error: { name: 'Error', code: 'P2034' },
      },
    ]);

    // 次の回は、失敗した対象だけが選ばれて処理される
    failOn = undefined;
    processed.length = 0;
    const second = finished(await runner.run(job));
    expect(processed).toEqual([`${prefix}b`]);
    expect(second).toMatchObject({
      result: 'SUCCEEDED',
      detail: { targets: { setting: { selected: 1, done: 1, skipped: 0, failed: 0 } } },
    });

    // 何度実行しても結果は同じ（対象がなくなれば何もしない）
    processed.length = 0;
    const third = finished(await runner.run(job));
    expect(processed).toEqual([]);
    expect(third.detail).toEqual({
      targets: { setting: { selected: 0, done: 0, skipped: 0, failed: 0 } },
    });
    expect(
      await db.prisma.hotelSetting.count({ where: { key: { startsWith: prefix }, value: 'DONE' } }),
    ).toBe(3);
    expect((await jobRuns('test-targets')).map((row) => row.result)).toEqual([
      'FAILED',
      'SUCCEEDED',
      'SUCCEEDED',
    ]);
  });

  it('確かめ直して処理が要らなかった対象は SKIPPED として数える。対象を選べなかった種類は FAILED にして、ほかの種類は処理する', async () => {
    const job: ScheduledJob = {
      name: 'test-kinds',
      schedule: '* * * * *',
      async execute(ctx) {
        await ctx.processTargets({
          kind: 'broken',
          select: () => Promise.reject(Object.assign(new Error('選べない'), { code: 'P1001' })),
          idOf: (id: string) => id,
          process: () => Promise.resolve('DONE' as const),
        });
        await ctx.processTargets({
          kind: 'room',
          select: () => Promise.resolve(['r1', 'r2']),
          idOf: (id) => id,
          process: (id) => Promise.resolve(id === 'r1' ? ('SKIPPED' as const) : ('DONE' as const)),
        });
        return { notified: 2 };
      },
    };

    const outcome = finished(await runner.run(job));
    expect(outcome.result).toBe('FAILED');
    expect(outcome.detail).toEqual({
      summary: { notified: 2 },
      targets: {
        broken: {
          selected: 0,
          done: 0,
          skipped: 0,
          failed: 0,
          selectError: { name: 'Error', code: 'P1001' },
        },
        room: { selected: 2, done: 1, skipped: 1, failed: 0 },
      },
    });
    expect(logs.ofEvent('JOB_ERROR')).toEqual([
      {
        event: 'JOB_ERROR',
        job: 'test-kinds',
        runId: outcome.runId,
        stage: 'SELECT',
        kind: 'broken',
        error: { name: 'Error', code: 'P1001' },
      },
    ]);
  });

  it('失敗した対象の ID は、job_runs には先頭の20件までを記録する（件数はすべて数える）', async () => {
    const ids = Array.from({ length: 25 }, (_, index) => `t${String(index).padStart(2, '0')}`);
    const job: ScheduledJob = {
      name: 'test-many-failures',
      schedule: '* * * * *',
      async execute(ctx) {
        await ctx.processTargets({
          kind: 'item',
          select: () => Promise.resolve(ids),
          idOf: (id) => id,
          process: () => Promise.reject(new Error('失敗')),
        });
      },
    };
    const outcome = finished(await runner.run(job));
    expect(outcome.detail).toEqual({
      targets: {
        item: { selected: 25, done: 0, skipped: 0, failed: 25, failedTargetIds: ids.slice(0, 20) },
      },
    });
    expect(logs.ofEvent('JOB_TARGET_FAILED')).toHaveLength(25);
  });

  it('1回の実行の最大の時間（maxDurationMs）を過ぎるとロックが外れ、次の起動が実行できる。長引いた回の結果も記録する', async () => {
    const slow = gatedJob('test-expiry', { maxDurationMs: 300 });
    const next = gatedJob('test-expiry');
    next.open();
    try {
      const slowRun = runner.run(slow.job);
      await within(slow.entered, '処理が始まりません');
      await new Promise((resolve) => setTimeout(resolve, 900));

      const otherRunner = new JobRunner(otherPrisma, clock, new MemoryJobLogSink());
      expect(await otherRunner.run(next.job)).toMatchObject({
        status: 'FINISHED',
        result: 'SUCCEEDED',
      });

      slow.open();
      expect(await slowRun).toMatchObject({ status: 'FINISHED', result: 'SUCCEEDED' });
      expect((await jobRuns('test-expiry')).map((row) => row.result)).toEqual([
        'SUCCEEDED',
        'SUCCEEDED',
      ]);
      expect(logs.ofEvent('JOB_ERROR')).toMatchObject([
        { event: 'JOB_ERROR', job: 'test-expiry', stage: 'LOCK_RELEASE' },
      ]);
    } finally {
      slow.open();
    }
  });
});
