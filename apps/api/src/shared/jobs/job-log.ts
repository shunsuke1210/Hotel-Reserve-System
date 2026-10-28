// 定時処理のログ（design.md「Monitoring」：定時処理の結果は job_runs と警告の一覧で確認する）。
// job_runs に記録しない出来事（多重起動の防止で実行しなかった回：Q-IT-7、データベースの障害で記録できなかった回）も、
// ここに出す。個人情報を出さないため、例外は種類とコードだけを項目にする（文言とスタックはサーバーのログにだけ出す）。
import { Injectable, Logger } from '@nestjs/common';
import type { ErrorSummary, JobRunDetail, JobRunResult } from './scheduled-job.js';

/** 失敗した段階 */
export type JobErrorStage =
  /** ロックの取得（データベースに接続できないなど）。実行しない */
  | 'LOCK'
  /** 開始の記録（job_runs への追加）。実行しない */
  | 'RECORD_START'
  /** 処理（execute）が例外を投げた。FAILED として記録する */
  | 'EXECUTE'
  /** 対象を選べなかった（processTargets の select）。FAILED として記録する */
  | 'SELECT'
  /** 終わりの記録（job_runs の更新）。行は RUNNING のまま残る */
  | 'RECORD_FINISH'
  /** ロックを放せなかった（最大の時間を過ぎて、先にロックが外れていたなど） */
  | 'LOCK_RELEASE';

export type JobLogEntry =
  | { event: 'JOB_SKIPPED'; job: string; reason: 'LOCKED' }
  | { event: 'JOB_STARTED'; job: string; runId: string }
  | {
      event: 'JOB_FINISHED';
      job: string;
      runId: string;
      result: JobRunResult;
      durationMs: number;
      detail: JobRunDetail;
    }
  | {
      event: 'JOB_TARGET_FAILED';
      job: string;
      runId: string;
      kind: string;
      targetId: string;
      error: ErrorSummary;
    }
  | {
      event: 'JOB_ERROR';
      job: string;
      runId?: string;
      stage: JobErrorStage;
      kind?: string;
      error: ErrorSummary;
    };

/** 定時処理のログの出力先。テストでは差し替えて、書かれた内容を確かめる */
export abstract class JobLogSink {
  /** @param cause 失敗の例外（サーバーのログに文言とスタックを出す。項目には入れない） */
  abstract write(entry: JobLogEntry, cause?: unknown): void;
}

/** 既定の出力先：アプリのロガー（本番では1行の JSON）に Job の文脈で書く */
@Injectable()
export class ConsoleJobLogSink extends JobLogSink {
  private readonly logger = new Logger('Job');

  override write(entry: JobLogEntry, cause?: unknown): void {
    if (entry.event === 'JOB_ERROR' || entry.event === 'JOB_TARGET_FAILED') {
      this.logger.error(entry, cause instanceof Error ? cause.stack : undefined);
    } else if (entry.event === 'JOB_FINISHED' && entry.result === 'FAILED') {
      this.logger.warn(entry);
    } else {
      this.logger.log(entry);
    }
  }
}

/** コードとして残す形（英大文字・数字・「_」の40文字まで。P2002、23505、PAYMENT_DECLINED など） */
const SAFE_CODE = /^[A-Z0-9_]{1,40}$/;

/** 例外を、ログと job_runs に書ける要約にする（文言は個人情報が入りうるので残さない） */
export function summarizeError(error: unknown): ErrorSummary {
  const name = error instanceof Error ? error.name : error === null ? 'null' : typeof error;
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && SAFE_CODE.test(code) ? { name, code } : { name };
}
