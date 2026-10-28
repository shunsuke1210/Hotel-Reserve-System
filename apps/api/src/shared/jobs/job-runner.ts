// 定時処理を1回実行する（tasks.md 3.2、research.md ADR-09、design.md「定時処理の失敗」・Q-IT-7）。
//
//   1. 多重起動の防止：処理の名前のアドバイザリーロックを取る（job-lock.ts）。取れなければ実行せず、
//      job_runs には記録しないでログにだけ出す（Q-IT-7）
//   2. 開始の記録：job_runs に RUNNING（終了時刻なし）の行を追加する。記録できなければ実行しない
//   3. 処理：ScheduledJob.execute に文脈（基準の時刻・対象の処理の仕組み）を渡す
//   4. 終わりの記録：job_runs に終了時刻・結果（SUCCEEDED・FAILED）・内容（件数・失敗した対象の ID・例外の種類）を書く
//
// 処理の例外・対象ごとの失敗は、記録とログに変えて、呼び出し元（定時の起動）には投げない。失敗した対象は、
// 次の回で同じ条件で再び選ばれて処理される（冪等。scheduled-job.ts の約束）。
// 時刻は業務の時計（BusinessClock）から読む。job_runs とログには個人情報（例外の文言など）を書かない。
import { performance } from 'node:perf_hooks';
import { Injectable } from '@nestjs/common';
import { BusinessClock } from '../clock/business-clock.js';
import type { Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { withJobLock, type JobLockResult } from './job-lock.js';
import { JobLogSink, summarizeError } from './job-log.js';
import type {
  ErrorSummary,
  JobContext,
  JobRunDetail,
  JobRunOutcome,
  JobRunResult,
  JobSummary,
  ScheduledJob,
  TargetBatch,
  TargetSummary,
} from './scheduled-job.js';

/** 1回の実行の最大の時間の既定値（ミリ秒）。過ぎるとロックが外れる */
export const DEFAULT_JOB_MAX_DURATION_MS = 30 * 60 * 1000;

/** job_runs に記録する、失敗した対象の ID の最大の件数（種類ごと。件数はすべて数える） */
export const MAX_FAILED_TARGET_IDS = 20;

@Injectable()
export class JobRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: BusinessClock,
    private readonly log: JobLogSink,
  ) {}

  /** 処理を1回実行する。例外は投げない（結果は戻り値・job_runs・ログで示す） */
  async run(job: ScheduledJob): Promise<JobRunOutcome> {
    let locked: JobLockResult<JobRunOutcome>;
    try {
      locked = await withJobLock(
        this.prisma,
        job.name,
        job.maxDurationMs ?? DEFAULT_JOB_MAX_DURATION_MS,
        () => this.runLocked(job),
      );
    } catch (error) {
      this.log.write(
        { event: 'JOB_ERROR', job: job.name, stage: 'LOCK', error: summarizeError(error) },
        error,
      );
      return { status: 'NOT_STARTED' };
    }

    if (!locked.acquired) {
      this.log.write({ event: 'JOB_SKIPPED', job: job.name, reason: 'LOCKED' });
      return { status: 'SKIPPED_LOCKED' };
    }
    if (locked.releaseError !== undefined) {
      const outcome = locked.value;
      this.log.write(
        {
          event: 'JOB_ERROR',
          job: job.name,
          ...(outcome.status === 'FINISHED' ? { runId: outcome.runId } : {}),
          stage: 'LOCK_RELEASE',
          error: summarizeError(locked.releaseError),
        },
        locked.releaseError,
      );
    }
    return locked.value;
  }

  /** ロックを持っている間の処理。例外は投げない */
  private async runLocked(job: ScheduledJob): Promise<JobRunOutcome> {
    const now = this.clock.now();
    const startedAt = performance.now();

    let runId: string;
    try {
      const row = await this.prisma.jobRun.create({
        data: {
          job: job.name,
          startedAt: now,
          result: 'RUNNING' satisfies JobRunResult,
          detail: {},
        },
        select: { id: true },
      });
      runId = row.id;
    } catch (error) {
      this.log.write(
        { event: 'JOB_ERROR', job: job.name, stage: 'RECORD_START', error: summarizeError(error) },
        error,
      );
      return { status: 'NOT_STARTED' };
    }
    this.log.write({ event: 'JOB_STARTED', job: job.name, runId });

    const context = new RunContext(job.name, runId, now, this.log);
    let summary: JobSummary | undefined;
    let executeError: ErrorSummary | undefined;
    try {
      summary = (await job.execute(context)) ?? undefined;
    } catch (error) {
      executeError = summarizeError(error);
      this.log.write(
        { event: 'JOB_ERROR', job: job.name, runId, stage: 'EXECUTE', error: executeError },
        error,
      );
    }
    const detail: JobRunDetail = {
      ...(summary === undefined ? {} : { summary }),
      ...(context.hasTargets ? { targets: context.targets } : {}),
      ...(executeError === undefined ? {} : { error: executeError }),
    };
    const result = executeError !== undefined || context.hasFailures ? 'FAILED' : 'SUCCEEDED';

    try {
      await this.prisma.jobRun.update({
        where: { id: runId },
        // detail は数・文字列・真偽値だけの、undefined を含まないオブジェクト
        data: { finishedAt: this.clock.now(), result, detail: detail as Prisma.InputJsonObject },
      });
    } catch (error) {
      this.log.write(
        {
          event: 'JOB_ERROR',
          job: job.name,
          runId,
          stage: 'RECORD_FINISH',
          error: summarizeError(error),
        },
        error,
      );
    }
    this.log.write({
      event: 'JOB_FINISHED',
      job: job.name,
      runId,
      result,
      durationMs: Math.round(performance.now() - startedAt),
      detail,
    });
    return { status: 'FINISHED', runId, result, detail };
  }
}

/** 1回の実行の文脈。processTargets の件数を種類ごとに貯める */
class RunContext implements JobContext {
  readonly targets: Record<string, TargetSummary> = {};

  constructor(
    readonly job: string,
    readonly runId: string,
    readonly now: Date,
    private readonly log: JobLogSink,
  ) {}

  get hasTargets(): boolean {
    return Object.keys(this.targets).length > 0;
  }

  /** 失敗した対象、または選べなかった種類があるか */
  get hasFailures(): boolean {
    return Object.values(this.targets).some(
      (summary) => summary.failed > 0 || summary.selectError !== undefined,
    );
  }

  async processTargets<T>(batch: TargetBatch<T>): Promise<TargetSummary> {
    if (batch.kind === '') throw new RangeError('対象の種類（kind）がありません');
    const summary: TargetSummary = { selected: 0, done: 0, skipped: 0, failed: 0 };

    let targets: readonly T[];
    try {
      targets = await batch.select();
    } catch (error) {
      summary.selectError = summarizeError(error);
      this.log.write(
        {
          event: 'JOB_ERROR',
          job: this.job,
          runId: this.runId,
          stage: 'SELECT',
          kind: batch.kind,
          error: summary.selectError,
        },
        error,
      );
      this.merge(batch.kind, summary);
      return summary;
    }

    summary.selected = targets.length;
    for (const target of targets) {
      try {
        const outcome = await batch.process(target);
        if (outcome === 'SKIPPED') summary.skipped += 1;
        else summary.done += 1;
      } catch (error) {
        summary.failed += 1;
        const targetId = targetIdOf(batch, target);
        summary.failedTargetIds ??= [];
        if (summary.failedTargetIds.length < MAX_FAILED_TARGET_IDS) {
          summary.failedTargetIds.push(targetId);
        }
        this.log.write(
          {
            event: 'JOB_TARGET_FAILED',
            job: this.job,
            runId: this.runId,
            kind: batch.kind,
            targetId,
            error: summarizeError(error),
          },
          error,
        );
      }
    }
    this.merge(batch.kind, summary);
    return summary;
  }

  /** 同じ種類で2回以上呼ばれたら、件数を足す */
  private merge(kind: string, summary: TargetSummary): void {
    const previous = this.targets[kind];
    if (previous === undefined) {
      this.targets[kind] = {
        ...summary,
        ...(summary.failedTargetIds ? { failedTargetIds: [...summary.failedTargetIds] } : {}),
      };
      return;
    }
    previous.selected += summary.selected;
    previous.done += summary.done;
    previous.skipped += summary.skipped;
    previous.failed += summary.failed;
    if (summary.failedTargetIds) {
      previous.failedTargetIds = [
        ...(previous.failedTargetIds ?? []),
        ...summary.failedTargetIds,
      ].slice(0, MAX_FAILED_TARGET_IDS);
    }
    if (previous.selectError === undefined && summary.selectError !== undefined) {
      previous.selectError = summary.selectError;
    }
  }
}

/** 対象の ID。idOf が例外を投げたら、その例外の種類で表す（ID が分からなくても失敗は数える） */
function targetIdOf<T>(batch: TargetBatch<T>, target: T): string {
  try {
    return batch.idOf(target);
  } catch (error) {
    return `(ID を得られません: ${summarizeError(error).name})`;
  }
}
