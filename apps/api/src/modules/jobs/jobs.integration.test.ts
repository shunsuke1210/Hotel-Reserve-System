// 社内用の待ち受け口に登録した定時処理が、cron の時刻（tick）で JobRunner を通して実行され、job_runs に記録されることを、
// テスト用のデータベースで確かめる（tasks.md 3.2）。2つの API のプロセスは、別々の接続プールを使う2つの待ち受け口で表す。
import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FixedBusinessClock } from '../../shared/clock/business-clock.js';
import { JobLogSink } from '../../shared/jobs/job-log.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../../test/database/test-database.js';
import { gatedJob, MemoryJobLogSink, within } from '../../test/jobs.js';
import { createTestListenerApp } from '../../test/listener-app.js';
import { JobScheduler } from './job-scheduler.js';

const NOW = '2026-11-11T01:00:00+09:00';

describe('社内用の待ち受け口の定時処理（JobsModule）', () => {
  let db: TestDatabase;
  let otherPrisma: PrismaService;
  const apps: INestApplication[] = [];
  const originalTz = process.env.TZ;

  beforeAll(async () => {
    db = await createTestDatabase();
    otherPrisma = new PrismaService(db.appUrl);
  });
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });
  afterAll(async () => {
    await otherPrisma?.$disconnect();
    await db?.drop();
  });

  it('[3.2] 登録した処理は、日本時間の cron の時刻が来ると JobRunner で実行され、job_runs に開始・終了・結果が残る', async () => {
    const test = gatedJob('test-wired', { schedule: '0 1 * * *' });
    test.open();
    const app = await createTestListenerApp('staff', {
      prisma: db.prisma,
      clock: new FixedBusinessClock(NOW),
      jobs: [test.job],
    });
    apps.push(app);
    const scheduler = app.get(JobScheduler);
    // サーバーの時間帯が日本でなくても日本時間で登録することを確かめるため、プロセスの時間帯を UTC にしてから登録する
    process.env.TZ = 'UTC';
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
    scheduler.start();
    expect(test.executions()).toBe(0);

    const cron = app.get(SchedulerRegistry).getCronJob('test-wired');
    expect(cron.cronTime.timeZone).toBe('Asia/Tokyo');
    // 次の起動は日本時間の 1:00（UTC の 16:00）
    expect(cron.nextDate().setZone('UTC').toFormat('HH:mm:ss')).toBe('16:00:00');
    await cron.fireOnTick();
    await scheduler.idle();

    expect(test.executions()).toBe(1);
    const rows = await db.prisma.jobRun.findMany({ where: { job: 'test-wired' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      result: 'SUCCEEDED',
      startedAt: new Date(NOW),
      finishedAt: new Date(NOW),
      detail: { summary: { processed: 1 } },
    });
    expect((app.get(JobLogSink) as MemoryJobLogSink).entries.map((entry) => entry.event)).toEqual([
      'JOB_STARTED',
      'JOB_FINISHED',
    ]);
  });

  it('[3.2 完了状態] 2つの API のプロセスで同じ処理を同時に起動しても1回だけ実行され、job_runs は1件（TC-IT-043・Q-IT-7）', async () => {
    const test = gatedJob('test-two-processes');
    const clock = new FixedBusinessClock(NOW);
    const first = await createTestListenerApp('staff', {
      prisma: db.prisma,
      clock,
      jobs: [test.job],
    });
    apps.push(first);
    const second = await createTestListenerApp('staff', {
      prisma: otherPrisma,
      clock,
      jobs: [test.job],
    });
    apps.push(second);
    try {
      const runs = [
        first.get(JobScheduler).runNow('test-two-processes'),
        second.get(JobScheduler).runNow('test-two-processes'),
      ];
      await expect(
        within(Promise.race(runs), 'どちらの起動も終わりません（両方が実行しています）'),
      ).resolves.toEqual({ status: 'SKIPPED_LOCKED' });
      test.open();
      const outcomes = await Promise.all(runs);
      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
        'FINISHED',
        'SKIPPED_LOCKED',
      ]);
      expect(test.executions()).toBe(1);
      expect(await db.prisma.jobRun.count({ where: { job: 'test-two-processes' } })).toBe(1);

      const skipped = [first, second].flatMap((app) =>
        (app.get(JobLogSink) as MemoryJobLogSink).ofEvent('JOB_SKIPPED'),
      );
      expect(skipped).toEqual([
        { event: 'JOB_SKIPPED', job: 'test-two-processes', reason: 'LOCKED' },
      ]);
    } finally {
      test.open();
    }
  });
});
