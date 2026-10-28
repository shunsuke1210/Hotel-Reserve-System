// 定時処理の登録と起動（tasks.md 3.2、design.md「定時処理（日本時間）」、research.md ADR-03・ADR-09）。
//
// - 社内用の待ち受け口（StaffApp）だけに載せる（JobsModule は StaffAppModule だけが読み込む）。公開用の待ち受け口には、
//   定時処理がそもそも存在しない
// - 処理（ScheduledJob）ごとに、@nestjs/schedule の SchedulerRegistry に cron の起動を登録する。時刻は日本時間で解釈する
// - 定時の起動は start() で始める。API の起動（listeners.ts の startApis）が、待ち受けを始めた後に1回だけ呼ぶ。
//   起動の時点では処理を実行しない（最初の実行は次の時刻）。テスト用の待ち受け口では start() を呼ばないので、
//   時刻が来ても実行されない。結合テストは runNow(名前) で、時刻を待たずに実行する
// - 起動のたびに JobRunner.run を呼ぶ。同じ処理が重なった起動・ほかのプロセスとの多重起動は、JobRunner のロックが防ぐ
// - 待ち受け口を閉じるときは、定時の起動を止め、実行中の処理が終わるのを待つ（データベースの接続を閉じる前に）
import { Inject, Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { BUSINESS_TIME_ZONE } from '../../shared/clock/business-clock.js';
import { jobLockKey } from '../../shared/jobs/job-lock.js';
import { JobRunner } from '../../shared/jobs/job-runner.js';
import type { JobRunOutcome, ScheduledJob } from '../../shared/jobs/scheduled-job.js';
import { isValidSchedule } from './job-schedules.js';

/** 社内用の待ち受け口で定時に起動する処理の一覧（JobsModule が作る。テストでは差し替える） */
export const SCHEDULED_JOBS = Symbol('SCHEDULED_JOBS');

@Injectable()
export class JobScheduler implements BeforeApplicationShutdown {
  private readonly logger = new Logger('JobScheduler');
  private readonly jobs: ReadonlyMap<string, ScheduledJob>;
  /** 実行中の処理（定時の起動と runNow） */
  private readonly inFlight = new Set<Promise<JobRunOutcome>>();
  private running = false;

  constructor(
    @Inject(SCHEDULED_JOBS) jobs: readonly ScheduledJob[],
    private readonly runner: JobRunner,
    private readonly registry: SchedulerRegistry,
  ) {
    this.jobs = indexJobs(jobs);
  }

  /** 定時の起動が動いているか */
  get isRunning(): boolean {
    return this.running;
  }

  /** 定時の起動を始める（2回目以降は何もしない）。起動の時点では処理を実行しない */
  start(): void {
    if (this.running) return;
    const registered: { job: string; schedule: string; nextRunAt: string | null }[] = [];
    for (const job of this.jobs.values()) {
      const cronJob = CronJob.from({
        cronTime: job.schedule,
        timeZone: BUSINESS_TIME_ZONE,
        onTick: () => {
          void this.track(job);
        },
        start: false,
        name: job.name,
      });
      this.registry.addCronJob(job.name, cronJob);
      cronJob.start();
      registered.push({
        job: job.name,
        schedule: job.schedule,
        nextRunAt: cronJob.nextDate().toISO(),
      });
    }
    this.running = true;
    this.logger.log({ event: 'JOB_SCHEDULER_STARTED', timeZone: BUSINESS_TIME_ZONE, registered });
  }

  /**
   * 登録した処理を、時刻を待たずに今すぐ1回実行する（結合テスト・運用での手動の実行）。
   * 多重起動の防止と job_runs への記録は、定時の起動と同じ。
   */
  runNow(name: string): Promise<JobRunOutcome> {
    const job = this.jobs.get(name);
    if (job === undefined) {
      return Promise.reject(new Error(`定時処理 ${name} は登録されていません`));
    }
    return this.track(job);
  }

  /** 実行中の処理がすべて終わるのを待つ */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  /** 定時の起動を止め、実行中の処理が終わるのを待つ */
  async stop(): Promise<void> {
    for (const name of this.jobs.keys()) {
      if (this.registry.doesExist('cron', name)) this.registry.deleteCronJob(name);
    }
    this.running = false;
    await this.idle();
  }

  beforeApplicationShutdown(): Promise<void> {
    return this.stop();
  }

  private track(job: ScheduledJob): Promise<JobRunOutcome> {
    const run = this.runner.run(job);
    this.inFlight.add(run);
    const settle = (): void => {
      this.inFlight.delete(run);
    };
    run.then(settle, settle);
    return run;
  }
}

/** 名前で引けるようにし、名前の重複・誤った時刻・ロックの鍵の衝突を起動の前に見つける */
function indexJobs(jobs: readonly ScheduledJob[]): ReadonlyMap<string, ScheduledJob> {
  const byName = new Map<string, ScheduledJob>();
  const byLockKey = new Map<number, string>();
  for (const job of jobs) {
    if (job.name === '') throw new Error('定時処理の名前がありません');
    if (byName.has(job.name)) throw new Error(`定時処理の名前が重複しています: ${job.name}`);
    if (!isValidSchedule(job.schedule)) {
      throw new Error(
        `定時処理 ${job.name} の時刻（cron の式）が正しくありません: ${job.schedule}（分 時 日 月 曜日 の5つの欄で書く）`,
      );
    }
    // 鍵が同じだと、別の処理どうしが互いの実行を止めてしまう
    const key = jobLockKey(job.name);
    const sameKey = byLockKey.get(key);
    if (sameKey !== undefined) {
      throw new Error(
        `定時処理 ${sameKey} と ${job.name} のロックの鍵が同じです。名前を変えてください`,
      );
    }
    byName.set(job.name, job);
    byLockKey.set(key, job.name);
  }
  return byName;
}
