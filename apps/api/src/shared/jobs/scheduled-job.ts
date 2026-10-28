// 定時処理の共通の形（tasks.md 3.2、research.md ADR-09、design.md「定時処理（日本時間）」「定時処理の失敗」）。
//
// どの定時処理も、何度実行しても結果が同じ（冪等）になるように、次の約束で作る：
//   1. 対象は、データベースの今の状態と ctx.now（その回の基準の時刻）だけで選ぶ。前回の実行の記録（job_runs）には頼らない
//   2. 処理を終えた対象は、選ぶ条件に当たらなくなるようにする（状態を変える・記録を残す）。
//      そうすれば、失敗した対象や、止まった回で処理できなかった対象だけが、次の回で再び選ばれる
//   3. 1件の処理は、自分のトランザクションの中で条件を確かめ直す（選んだ後に画面の操作で変わることがある）。
//      もう処理が要らなければ何もせずに 'SKIPPED' を返す
//   4. 対象は ctx.processTargets で1件ずつ処理する。1件の失敗はほかの対象の処理を止めない
//
//   @Injectable()
//   export class HoldExpiryJob implements ScheduledJob {
//     readonly name = 'hold-expiry';
//     readonly schedule = JOB_SCHEDULES['hold-expiry'];
//     constructor(private readonly reservations: ReservationService) {}
//     async execute(ctx: JobContext): Promise<void> {
//       await ctx.processTargets({
//         kind: 'reservation',
//         select: () => this.reservations.findExpiredHolds(ctx.now),
//         idOf: (reservation) => reservation.id,
//         process: (reservation) => this.reservations.expireHold(reservation.id, ctx.now),
//       });
//     }
//   }
//
// 多重起動の防止（アドバイザリーロック）と job_runs への記録は JobRunner が行うので、処理の側では行わない。

/** job_runs.result の値。RUNNING は実行中（または、終わりを記録できずにプロセスが止まった回） */
export const JOB_RUN_RESULTS = ['RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type JobRunResult = (typeof JOB_RUN_RESULTS)[number];

/** 1件の対象の処理の結果。SKIPPED は、確かめ直したらもう処理が要らなかった（ほかの操作で変わった・処理済み） */
export type TargetOutcome = 'DONE' | 'SKIPPED';

/** 処理がその回の内容として返す件数など（job_runs.detail.summary。数だけにして、個人情報を入れない） */
export type JobSummary = Readonly<Record<string, number>>;

/** 例外の要約（ログと job_runs に書く）。文言には個人情報が入りうるので、種類とコードだけにする */
export interface ErrorSummary {
  /** 例外のクラスの名前（Error でなければ値の型の名前） */
  name: string;
  /** Prisma のエラーコード・PostgreSQL の SQLSTATE・業務エラーのコードなど（あれば） */
  code?: string;
}

/** 1つの種類の対象の処理の件数（job_runs.detail.targets の値） */
export interface TargetSummary {
  /** 選んだ件数 */
  selected: number;
  done: number;
  skipped: number;
  failed: number;
  /** 失敗した対象の ID（先頭の MAX_FAILED_TARGET_IDS 件まで。失敗がなければ省く） */
  failedTargetIds?: string[];
  /** 対象を選べなかったときの例外の要約（選べなければ、その種類の対象は処理しない） */
  selectError?: ErrorSummary;
}

/** job_runs.detail の形 */
export interface JobRunDetail {
  /** 処理が返した件数など */
  summary?: JobSummary;
  /** processTargets の種類ごとの件数 */
  targets?: Record<string, TargetSummary>;
  /** 処理が例外を投げて途中で止まったときの例外の要約 */
  error?: ErrorSummary;
}

/** 1つの種類の対象の選び方と処理 */
export interface TargetBatch<T> {
  /** 対象の種類（job_runs.detail.targets の見出し。例：'reservation'、'payment'） */
  kind: string;
  /** 対象を選ぶ。データベースの今の状態と ctx.now だけで決める（前回の実行の記録には頼らない） */
  select(): Promise<readonly T[]>;
  /** 対象の ID（ログと job_runs に書く）。個人情報を含めない（通常は行の UUID） */
  idOf(target: T): string;
  /**
   * 1件の処理。自分のトランザクションの中で条件を確かめ直し、もう処理が要らなければ 'SKIPPED' を返す。
   * 例外は、その対象の失敗として記録し、ほかの対象の処理を続ける（失敗した対象は次の回で再び選ばれる）。
   */
  process(target: T): Promise<TargetOutcome>;
}

/** 1回の実行の文脈 */
export interface JobContext {
  /** 処理の名前 */
  readonly job: string;
  /** この回の job_runs の ID */
  readonly runId: string;
  /**
   * この回の基準の時刻（開始のときに業務の時計から1回だけ読む）。対象の選び方と判定は、この時刻で行う
   * （処理の途中で時刻が進んでも、同じ回の中で判定がぶれないように）
   */
  readonly now: Date;
  /** 対象を選んで1件ずつ処理し、件数を job_runs に記録する。同じ種類で2回呼ぶと件数を足す */
  processTargets<T>(batch: TargetBatch<T>): Promise<TargetSummary>;
}

/** 定時処理 */
export interface ScheduledJob {
  /** 処理の名前（job_runs.job・ログ・ロックの鍵に使う。例：'hold-expiry'） */
  readonly name: string;
  /**
   * 起動する時刻（cron の5つの欄の式。日本時間で解釈する）。複数の時刻は式の中で並べる（例：'0 1,13 * * *'）。
   * 業務の処理は modules/jobs/job-schedules.ts の JOB_SCHEDULES の値を使う
   */
  readonly schedule: string;
  /** 1回の実行の最大の時間（ミリ秒。省略時は30分）。過ぎるとロックが外れ、次の起動が実行できるようになる */
  readonly maxDurationMs?: number;
  /** 1回分の処理。例外を投げると、その回は FAILED として記録する */
  execute(ctx: JobContext): Promise<JobSummary | void>;
}

/** JobRunner.run の結果 */
export type JobRunOutcome =
  /** ほかの実行がロックを持っていたので、実行しなかった（job_runs に記録せず、ログにだけ出す。Q-IT-7） */
  | { status: 'SKIPPED_LOCKED' }
  /** ロックの取得または開始の記録に失敗したので、実行しなかった（データベースの障害など。ログに出す） */
  | { status: 'NOT_STARTED' }
  /** 実行した（result は job_runs に記録した結果） */
  | {
      status: 'FINISHED';
      runId: string;
      result: Exclude<JobRunResult, 'RUNNING'>;
      detail: JobRunDetail;
    };
