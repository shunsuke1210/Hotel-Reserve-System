// 定時処理の登録（tasks.md 3.2）：社内用の待ち受け口だけに載り、日本時間の cron で起動し、起動の時点では実行しないこと。
// データベースは使わない（処理の実行は job-runner.integration.test.ts・jobs.integration.test.ts で確かめる）。
import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startApis } from '../../listeners.js';
import { BUSINESS_TIME_ZONE } from '../../shared/clock/business-clock.js';
import { JobLogSink } from '../../shared/jobs/job-log.js';
import { JobRunner } from '../../shared/jobs/job-runner.js';
import type { JobRunOutcome, ScheduledJob } from '../../shared/jobs/scheduled-job.js';
import { deferred, gatedJob, MemoryJobLogSink } from '../../test/jobs.js';
import { createTestListenerApp } from '../../test/listener-app.js';
import { JobScheduler } from './job-scheduler.js';

function job(name: string, schedule = '* * * * *'): ScheduledJob {
  return { name, schedule, execute: () => Promise.resolve() };
}

describe('JobScheduler（定時処理の登録）', () => {
  const apps: INestApplication[] = [];
  const originalTz = process.env.TZ;
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(apps.splice(0).map((app) => app.close()));
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  async function staffApp(jobs: ScheduledJob[]): Promise<INestApplication> {
    const app = await createTestListenerApp('staff', { jobs });
    apps.push(app);
    return app;
  }

  it('[3.2] 定時処理は社内用の待ち受け口だけに載り、公開用の待ち受け口にはない', async () => {
    const staff = await staffApp([]);
    const guest = await createTestListenerApp('guest');
    apps.push(guest);
    expect(staff.get(JobScheduler)).toBeInstanceOf(JobScheduler);
    expect(staff.get(SchedulerRegistry)).toBeInstanceOf(SchedulerRegistry);
    expect(() => guest.get(JobScheduler)).toThrow();
    expect(() => guest.get(SchedulerRegistry)).toThrow();
    expect(() => guest.get(JobRunner)).toThrow();
  });

  it('テストの待ち受け口では、定時処理のログはメモリに貯める（画面に出さない）', async () => {
    const staff = await staffApp([]);
    expect(staff.get(JobLogSink)).toBeInstanceOf(MemoryJobLogSink);
  });

  it('[3.2] start するまで定時の起動は登録せず、start で処理ごとに日本時間の cron を登録する。起動の時点では処理を実行しない', async () => {
    const holdExpiry = gatedJob('test-every-minute');
    const morning = gatedJob('test-morning', { schedule: '0 9 * * *' });
    const app = await staffApp([holdExpiry.job, morning.job]);
    const scheduler = app.get(JobScheduler);
    const registry = app.get(SchedulerRegistry);
    const run = vi.spyOn(app.get(JobRunner), 'run');

    expect(scheduler.isRunning).toBe(false);
    expect([...registry.getCronJobs().keys()]).toEqual([]);

    // サーバーの時間帯が日本でなくても（本番のコンテナは UTC のことが多い）、日本時間で登録することを確かめる。
    // cron は時間帯を指定しなければプロセスの時間帯を使うので、プロセスの時間帯を日本以外にしてから登録する
    process.env.TZ = 'America/Los_Angeles';
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Los_Angeles');
    scheduler.start();
    expect(scheduler.isRunning).toBe(true);
    expect([...registry.getCronJobs().keys()].sort()).toEqual([
      'test-every-minute',
      'test-morning',
    ]);
    const cron = registry.getCronJob('test-morning');
    expect(cron.isActive).toBe(true);
    expect(cron.cronTime.source).toBe('0 9 * * *');
    expect(cron.cronTime.timeZone).toBe(BUSINESS_TIME_ZONE);
    // 次の起動は日本時間の 9:00（UTC の 0:00）
    expect(cron.nextDate().setZone('UTC').toFormat('HH:mm:ss')).toBe('00:00:00');

    expect(run).not.toHaveBeenCalled();
    expect(holdExpiry.executions()).toBe(0);
    expect(morning.executions()).toBe(0);

    // 2回呼んでも二重には登録しない
    scheduler.start();
    expect(registry.getCronJobs().size).toBe(2);
  });

  it('[3.2] cron の時刻が来ると、その処理を JobRunner で実行する（多重起動の防止と記録は JobRunner が行う）', async () => {
    const test = job('test-tick');
    const app = await staffApp([test, job('test-other')]);
    const scheduler = app.get(JobScheduler);
    const run = vi
      .spyOn(app.get(JobRunner), 'run')
      .mockResolvedValue({ status: 'SKIPPED_LOCKED' } satisfies JobRunOutcome);
    scheduler.start();

    await app.get(SchedulerRegistry).getCronJob('test-tick').fireOnTick();
    await scheduler.idle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(test);
  });

  it('runNow は登録した処理を名前で今すぐ実行する（結合テスト・手動の実行）。登録していない名前は Error', async () => {
    const test = job('test-run-now');
    const app = await staffApp([test]);
    const outcome: JobRunOutcome = { status: 'SKIPPED_LOCKED' };
    const run = vi.spyOn(app.get(JobRunner), 'run').mockResolvedValue(outcome);

    await expect(app.get(JobScheduler).runNow('test-run-now')).resolves.toBe(outcome);
    expect(run).toHaveBeenCalledWith(test);
    await expect(app.get(JobScheduler).runNow('unknown')).rejects.toThrow(
      '定時処理 unknown は登録されていません',
    );
  });

  it('データベースに接続できずロックを取れなければ、処理を実行せずにログに出す（job_runs にも書けない）', async () => {
    const test = gatedJob('test-no-database');
    test.open();
    const app = await staffApp([test.job]);

    await expect(app.get(JobScheduler).runNow('test-no-database')).resolves.toEqual({
      status: 'NOT_STARTED',
    });
    expect(test.executions()).toBe(0);
    const logs = app.get(JobLogSink) as MemoryJobLogSink;
    expect(logs.entries).toEqual([
      {
        event: 'JOB_ERROR',
        job: 'test-no-database',
        stage: 'LOCK',
        error: { name: 'Error' },
      },
    ]);
  });

  it('待ち受け口を閉じると定時の起動を止め、実行中の処理が終わるのを待つ', async () => {
    const app = await staffApp([job('test-close')]);
    const scheduler = app.get(JobScheduler);
    const registry = app.get(SchedulerRegistry);
    const finish = deferred<JobRunOutcome>();
    vi.spyOn(app.get(JobRunner), 'run').mockReturnValue(finish.promise);
    scheduler.start();
    const cron = registry.getCronJob('test-close');
    void cron.fireOnTick();

    let closed = false;
    const closing = app.close().then(() => {
      closed = true;
    });
    apps.splice(apps.indexOf(app), 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closed).toBe(false);
    expect(cron.isActive).toBe(false);

    finish.resolve({ status: 'SKIPPED_LOCKED' });
    await closing;
    expect(closed).toBe(true);
    expect(scheduler.isRunning).toBe(false);
    expect(registry.getCronJobs().size).toBe(0);
  });

  it('処理の名前の重複・空の名前・誤った cron の式は、待ち受け口を作る時点で Error にする', () => {
    const runner = {} as JobRunner;
    const registry = new SchedulerRegistry();
    expect(() => new JobScheduler([job('dup'), job('dup')], runner, registry)).toThrow(
      '定時処理の名前が重複しています: dup',
    );
    expect(() => new JobScheduler([job('')], runner, registry)).toThrow(
      '定時処理の名前がありません',
    );
    expect(() => new JobScheduler([job('bad', '61 * * * *')], runner, registry)).toThrow(
      '定時処理 bad の時刻（cron の式）が正しくありません',
    );
  });
});

describe('API の起動と定時処理（startApis）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('[3.2] 起動すると、社内用の待ち受け口が待ち受けを始めた後に定時処理を1回だけ始める', async () => {
    const start = vi.spyOn(JobScheduler.prototype, 'start').mockImplementation(() => undefined);
    const apis = await startApis({ guest: 0, staff: 0 }, { logger: false });
    try {
      expect(start).toHaveBeenCalledTimes(1);
      expect(start.mock.contexts[0]).toBe(apis.staff.get(JobScheduler));
    } finally {
      await apis.close();
    }
  });

  it('scheduleJobs: false なら定時処理を始めない（定時の起動を伴わない確認用）', async () => {
    const start = vi.spyOn(JobScheduler.prototype, 'start');
    const apis = await startApis({ guest: 0, staff: 0 }, { logger: false, scheduleJobs: false });
    try {
      expect(start).not.toHaveBeenCalled();
      expect(apis.staff.get(JobScheduler).isRunning).toBe(false);
    } finally {
      await apis.close();
    }
  });
});
