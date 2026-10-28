// 定時処理のテストの補助（tasks.md 3.2）。
//
// 業務の定時処理の結合テストでは、時刻を待たずに処理を実行する：
//   const app = await createTestListenerApp('staff', { prisma: db.prisma, clock });
//   const outcome = await app.get(JobScheduler).runNow('hold-expiry');
// 多重起動の防止と job_runs への記録は、定時の起動と同じ JobRunner を通る。
import { JobLogSink, type JobLogEntry } from '../shared/jobs/job-log.js';
import type { JobContext, JobSummary, ScheduledJob } from '../shared/jobs/scheduled-job.js';

/** 定時処理のログをメモリに貯める出力先（テスト用） */
export class MemoryJobLogSink extends JobLogSink {
  readonly entries: JobLogEntry[] = [];

  override write(entry: JobLogEntry): void {
    this.entries.push(entry);
  }

  /** 指定した種類のログだけ */
  ofEvent<E extends JobLogEntry['event']>(event: E): Extract<JobLogEntry, { event: E }>[] {
    return this.entries.filter(
      (entry): entry is Extract<JobLogEntry, { event: E }> => entry.event === event,
    );
  }
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

/** 外から完了させられる Promise */
export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** promise が ms ミリ秒以内に終わらなければ、message の Error で失敗させる */
export async function within<T>(promise: Promise<T>, message: string, ms = 10_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface GatedJob {
  readonly job: ScheduledJob;
  /** execute が呼ばれた回数 */
  executions(): number;
  /** execute に渡された文脈（呼ばれた順） */
  readonly contexts: JobContext[];
  /** 最初の execute が始まったら完了する */
  readonly entered: Promise<void>;
  /** これを呼ぶまで execute は終わらない */
  open(): void;
}

/**
 * テスト用の処理。execute が呼ばれた回数を数え、open() を呼ぶまで終わらない（実行中に別の起動を重ねるため）。
 * 終わると { processed: 1 } を返す。
 */
export function gatedJob(
  name: string,
  options: { schedule?: string; maxDurationMs?: number } = {},
): GatedJob {
  const entered = deferred();
  const gate = deferred();
  const contexts: JobContext[] = [];
  const job: ScheduledJob = {
    name,
    schedule: options.schedule ?? '* * * * *',
    ...(options.maxDurationMs === undefined ? {} : { maxDurationMs: options.maxDurationMs }),
    async execute(ctx: JobContext): Promise<JobSummary> {
      contexts.push(ctx);
      entered.resolve();
      await gate.promise;
      return { processed: 1 };
    },
  };
  return {
    job,
    executions: () => contexts.length,
    contexts,
    entered: entered.promise,
    open: () => gate.resolve(),
  };
}
