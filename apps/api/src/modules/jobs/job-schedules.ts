// 定時処理の時刻（design.md「定時処理（日本時間）」の表）。cron の5つの欄（分 時 日 月 曜日）の式で、
// サーバーの時間帯の設定にかかわらず日本時間（BUSINESS_TIME_ZONE）で解釈する。
// 時刻を変えるときは design.md の表も変える（Revalidation Triggers：定時処理の時刻は要件の基準値に直結する）。
//
// 業務の定時処理のクラス（後のタスク）は、自分の名前の値を ScheduledJob.schedule に使う：
//   readonly name: JobName = 'hold-expiry';
//   readonly schedule = JOB_SCHEDULES['hold-expiry'];
import { CronTime } from 'cron';
import { BUSINESS_TIME_ZONE } from '../../shared/clock/business-clock.js';

export const JOB_SCHEDULES = {
  /** 期限を過ぎた決済待ちの予約を Expired にし、確保を解除して時間切れのメールを作る（4.17）：毎分 */
  'hold-expiry': '* * * * *',
  /**
   * ノーショーの判定（8.14、8.16、8.26）：毎日 1:00、および15分ごと（延長した予約の期限・返金の再試行。DT-M18）。
   * 15分ごとの回（毎時 0分・15分・30分・45分）が 1:00 を含むので、1つの式にする（1:00 に2回起動しない）。
   * 判定は「到着日の25:00（延長した予約はその期限）を過ぎたか」を ctx.now で確かめるので、どの回でも同じ条件で選べる
   */
  'no-show': '*/15 * * * *',
  /** 部屋の状態の切り替え（12.5、12.6）：毎日 9:00 */
  'morning-status': '0 9 * * *',
  /** 到着前の案内（15.2、15.3）：毎日 10:00 */
  'pre-arrival': '0 10 * * *',
  /** アカウントの自動削除（19.1〜19.5）：毎日 3:00 */
  retention: '0 3 * * *',
  /** 作成したメールの送信（15 全体）：毎分 */
  outbox: '* * * * *',
  /** 決済の照合（L-29、L-35〜L-38）：5分ごと */
  'payment-reconcile': '*/5 * * * *',
  /** 確認しなかった登録の申込の削除（1.3、1.4）：毎日 4:00 */
  'pending-cleanup': '0 4 * * *',
} as const satisfies Record<string, string>;

/** 設計の表にある定時処理の名前 */
export type JobName = keyof typeof JOB_SCHEDULES;

/** cron の式として正しく、5つの欄（秒の欄なし）か */
export function isValidSchedule(expression: string): boolean {
  return (
    expression.trim().split(/\s+/).length === 5 && CronTime.validateCronExpression(expression).valid
  );
}

/** 式 expression で、時刻 from より後（from ちょうどは含まない）に起動する時刻を count 個（日本時間で解釈する） */
export function nextRunTimes(expression: string, from: Date, count: number): Date[] {
  const time = new CronTime(expression, BUSINESS_TIME_ZONE);
  const result: Date[] = [];
  let cursor = from;
  for (let index = 0; index < count; index += 1) {
    cursor = time.getNextDateFrom(cursor, BUSINESS_TIME_ZONE).toJSDate();
    result.push(cursor);
  }
  return result;
}
