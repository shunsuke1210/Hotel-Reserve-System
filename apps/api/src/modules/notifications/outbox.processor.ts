// 定時処理 outbox：送信待ちのメールを毎分 MailSender で送る（design.md 定時処理の表・「定時処理の失敗」、tasks.md 3.4）。
//
// - 対象は mail_outbox の PENDING の行（古い順に OUTBOX_BATCH_SIZE 通まで）。1通ずつ自分のトランザクションの中で、
//   行のロック（FOR UPDATE SKIP LOCKED）を取ってから状態を確かめ直し、ロックを持ったまま送る。
//   最大の時間（maxDurationMs）を過ぎて次の回と重なっても、送っている途中の行はほかの回が飛ばし、送り終えた行は
//   確かめ直しで SENT と分かるので、同じメールを二重に送らない（tasks.md Implementation Notes 3.2）
// - 送信には時間切れ（OUTBOX_SEND_TIMEOUT_MS）を設ける（行のロックとトランザクションを長く持たないように）。
//   時間切れの後に外部のサービスが送り終えることはありうる（次の回に再送されれば二重に届く。少なくとも1回は届ける側に倒す）
// - 送れたら SENT・sent_at＝その回の基準の時刻。失敗（送信の失敗・時間切れ・文面を作れない）したら attempts を1増やし、
//   試行が MAX_SEND_ATTEMPTS（5回）に達したら FAILED にする（警告の一覧に出す。MailService.listFailed）。
//   失敗は対象の失敗として job_runs とログに残す（例外の種類とコードだけ。宛先などを含む元の文言は残さない）
// - 定期配信（MARKETING）は、行のロックを取った後に、会員がいて有効（ACTIVE）で同意が最新で true かを確かめ直す
//   （15.6、brief.md NT-03a：取り消した後は送らない）。作った後に同意を取り消した・退会した・削除された会員の行は、
//   送らずに消す（送れなかったメールではないので FAILED にせず、警告の一覧にも出さない。件数は job_runs の
//   summary.consentWithdrawn に残す）
// - 送ったことは mail_outbox の状態・attempts・sent_at と job_runs に残る。スタッフの操作ではなく業務のデータも変えない
//   ので、操作履歴（audit_logs）には記録しない（要件 18.1 はスタッフの登録・変更・削除の記録）
import { Inject, Injectable } from '@nestjs/common';
import { MailSender } from '../../integrations/mail/mail-sender.port.js';
import type { JobContext, JobSummary, ScheduledJob } from '../../shared/jobs/scheduled-job.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { runInTransaction } from '../../shared/prisma/transaction.js';
import { JOB_SCHEDULES, type JobName } from '../jobs/job-schedules.js';
import { MailRenderer, type RenderedMail } from './mail-renderer.js';
import { canReceiveMarketing } from './marketing-consent.js';
import { MAX_SEND_ATTEMPTS, type MailStatus, type MailTemplate } from './mail-templates.js';

/** 1回の実行で送る最大の通数（残りは次の回） */
export const OUTBOX_BATCH_SIZE = 100;

/** 1通の送信の時間切れ（ミリ秒）の DI のトークン（テストで短くする） */
export const OUTBOX_SEND_TIMEOUT_MS = Symbol('OUTBOX_SEND_TIMEOUT_MS');

/** 1通の送信の時間切れの既定値（ミリ秒） */
export const DEFAULT_OUTBOX_SEND_TIMEOUT_MS = 10_000;

/** 送信の時間切れに足す、1通のトランザクションの余裕（ミリ秒） */
const TRANSACTION_MARGIN_MS = 5_000;

/** 失敗の種類（job_runs とログのコード） */
export type MailDeliveryErrorCode = 'MAIL_SEND_FAILED' | 'MAIL_SEND_TIMEOUT' | 'MAIL_RENDER_FAILED';

/**
 * 1通を送れなかった（attempts を増やした後に投げる。processTargets が対象の失敗として数える）。
 * 文言には元の例外の種類だけを書き、元の文言（宛先などを含みうる）は書かない。
 */
export class MailDeliveryError extends Error {
  override readonly name = 'MailDeliveryError';

  constructor(
    readonly code: MailDeliveryErrorCode,
    /** 失敗した試行の回数（この回を含む） */
    readonly attempts: number,
    /** 試行が上限に達して FAILED にしたか */
    readonly exhausted: boolean,
    causeName: string,
  ) {
    super(
      `メールを送れませんでした（${code}、${attempts}回目${exhausted ? '、送信を打ち切りました' : ''}、原因の種類：${causeName}）`,
    );
  }
}

/**
 * 1通の処理の結果。SKIPPED：ほかの回が送っている途中・もう送信待ちでない。CONSENT_WITHDRAWN：定期配信の宛先の会員が
 * もう受け取らない（同意の取り消し・退会・削除）ので、送らずに行を消した
 */
export type DeliveryOutcome = 'SENT' | 'SKIPPED' | 'CONSENT_WITHDRAWN';

type Attempt = { ok: true } | { ok: false; code: MailDeliveryErrorCode; causeName: string };

const SENT: MailStatus = 'SENT';
const PENDING: MailStatus = 'PENDING';
const FAILED: MailStatus = 'FAILED';
const MARKETING: MailTemplate = 'MARKETING';

@Injectable()
export class OutboxProcessor implements ScheduledJob {
  readonly name: JobName = 'outbox';
  readonly schedule = JOB_SCHEDULES.outbox;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: MailSender,
    private readonly renderer: MailRenderer,
    @Inject(OUTBOX_SEND_TIMEOUT_MS) private readonly sendTimeoutMs: number,
  ) {}

  async execute(ctx: JobContext): Promise<JobSummary> {
    const summary = { sent: 0, retryScheduled: 0, failed: 0, consentWithdrawn: 0 };
    await ctx.processTargets({
      kind: 'mail',
      select: () =>
        this.prisma.mailOutbox.findMany({
          where: { status: PENDING },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: OUTBOX_BATCH_SIZE,
          select: { id: true },
        }),
      idOf: (row) => row.id,
      process: async (row) => {
        try {
          const outcome = await this.deliver(row.id, ctx.now);
          if (outcome === 'SENT') summary.sent += 1;
          if (outcome === 'CONSENT_WITHDRAWN') summary.consentWithdrawn += 1;
          return outcome === 'SENT' ? 'DONE' : 'SKIPPED';
        } catch (error) {
          if (error instanceof MailDeliveryError) {
            if (error.exhausted) summary.failed += 1;
            else summary.retryScheduled += 1;
          }
          throw error;
        }
      },
    });
    return summary;
  }

  /**
   * 1通を送る。ほかの回が送っている途中（行のロック中）・もう送信待ちでない行は 'SKIPPED'。
   * 定期配信で、宛先の会員がもう受け取らない行は、送らずに消して 'CONSENT_WITHDRAWN'。
   * 送れなければ attempts を増やして（上限なら FAILED にして）確定してから MailDeliveryError を投げる。
   * @param now その回の基準の時刻（sent_at に入れる）
   */
  async deliver(id: string, now: Date): Promise<DeliveryOutcome> {
    const failure = await runInTransaction(
      this.prisma,
      async (tx): Promise<DeliveryOutcome | MailDeliveryError> => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM mail_outbox WHERE id = ${id}::uuid FOR UPDATE SKIP LOCKED`;
        if (locked.length === 0) return 'SKIPPED';
        const row = await tx.mailOutbox.findUnique({ where: { id } });
        if (row === null || row.status !== PENDING) return 'SKIPPED';
        if (row.template === MARKETING && !(await canReceiveMarketing(tx, row.memberId))) {
          await tx.mailOutbox.delete({ where: { id } });
          return 'CONSENT_WITHDRAWN';
        }
        if (row.attempts >= MAX_SEND_ATTEMPTS) {
          // 上限に達したのに送信待ちのまま残っていた行（通常は起きない）は、送らずに FAILED にする
          await tx.mailOutbox.update({ where: { id }, data: { status: FAILED } });
          return new MailDeliveryError('MAIL_SEND_FAILED', row.attempts, true, 'AttemptsExhausted');
        }

        const attempt = await this.attempt(row);
        if (attempt.ok) {
          await tx.mailOutbox.update({ where: { id }, data: { status: SENT, sentAt: now } });
          return 'SENT';
        }
        const attempts = row.attempts + 1;
        const exhausted = attempts >= MAX_SEND_ATTEMPTS;
        await tx.mailOutbox.update({
          where: { id },
          data: { attempts, status: exhausted ? FAILED : PENDING },
        });
        return new MailDeliveryError(attempt.code, attempts, exhausted, attempt.causeName);
      },
      { timeoutMs: this.sendTimeoutMs + TRANSACTION_MARGIN_MS },
    );
    if (failure instanceof MailDeliveryError) throw failure;
    return failure;
  }

  /** 文面を作って送る（例外は投げずに結果で返す） */
  private async attempt(row: {
    toAddress: string;
    template: string;
    locale: string;
    payload: unknown;
  }): Promise<Attempt> {
    let mail: RenderedMail;
    try {
      mail = this.renderer.render(row);
    } catch (error) {
      return { ok: false, code: 'MAIL_RENDER_FAILED', causeName: errorName(error) };
    }
    try {
      await withTimeout(
        this.sender.send({ to: row.toAddress, subject: mail.subject, body: mail.body }),
        this.sendTimeoutMs,
      );
      return { ok: true };
    } catch (error) {
      return error instanceof SendTimeout
        ? { ok: false, code: 'MAIL_SEND_TIMEOUT', causeName: 'SendTimeout' }
        : { ok: false, code: 'MAIL_SEND_FAILED', causeName: errorName(error) };
    }
  }
}

/** 送信の時間切れ */
class SendTimeout extends Error {
  override readonly name = 'SendTimeout';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new SendTimeout('メールの送信が時間内に終わりませんでした')),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
