// 定時処理の時刻の表（design.md「定時処理（日本時間）」）を、日本時間の時刻として確かめる。
import { afterEach, describe, expect, it } from 'vitest';
import { jobLockKey } from '../../shared/jobs/job-lock.js';
import { isValidSchedule, JOB_SCHEDULES, nextRunTimes, type JobName } from './job-schedules.js';

/** 日本時間の時刻 fromJst より後に、name の処理が起動する時刻（日本時間の ISO 8601）を count 個 */
function nextRuns(name: JobName, fromJst: string, count: number): string[] {
  return nextRunTimes(JOB_SCHEDULES[name], new Date(fromJst), count).map(japanIso);
}

/** 瞬間を日本時間（+09:00）の ISO 8601 で表す */
function japanIso(date: Date): string {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19)}+09:00`;
}

describe('定時処理の時刻（日本時間）', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('設計の表の8つの処理を、名前で登録する', () => {
    expect(Object.keys(JOB_SCHEDULES).sort()).toEqual(
      [
        'hold-expiry',
        'no-show',
        'morning-status',
        'pre-arrival',
        'retention',
        'outbox',
        'payment-reconcile',
        'pending-cleanup',
      ].sort(),
    );
  });

  it('どの時刻も5つの欄の正しい cron の式で、処理ごとの多重起動のロックの鍵は互いに違う', () => {
    for (const expression of Object.values(JOB_SCHEDULES)) {
      expect(isValidSchedule(expression)).toBe(true);
    }
    const keys = Object.keys(JOB_SCHEDULES).map((name) => jobLockKey(name));
    expect(new Set(keys).size).toBe(keys.length);
    // 秒の欄を含む式（6つの欄）・誤った式は使わない
    expect(isValidSchedule('*/10 * * * * *')).toBe(false);
    expect(isValidSchedule('61 * * * *')).toBe(false);
  });

  it('[4.17] hold-expiry は毎分起動する', () => {
    expect(nextRuns('hold-expiry', '2026-11-10T10:00:30+09:00', 3)).toEqual([
      '2026-11-10T10:01:00+09:00',
      '2026-11-10T10:02:00+09:00',
      '2026-11-10T10:03:00+09:00',
    ]);
  });

  it('outbox は毎分起動する', () => {
    expect(nextRuns('outbox', '2026-11-10T23:59:59+09:00', 2)).toEqual([
      '2026-11-11T00:00:00+09:00',
      '2026-11-11T00:01:00+09:00',
    ]);
  });

  it('[8.14] no-show は日本時間の 1:00 に起動し、その後も15分ごと（延長分・返金の再試行。DT-M18）に起動する', () => {
    // TC-IT-040：11/11 0:59 の次の回は 1:00（到着日 11/10 の25:00）。1:00 の回は1回だけ
    expect(nextRuns('no-show', '2026-11-11T00:59:00+09:00', 4)).toEqual([
      '2026-11-11T01:00:00+09:00',
      '2026-11-11T01:15:00+09:00',
      '2026-11-11T01:30:00+09:00',
      '2026-11-11T01:45:00+09:00',
    ]);
    // 延長の期限（最も遅くて翌日12:00）を過ぎた予約を判定するため、昼も15分ごとに起動する
    expect(nextRuns('no-show', '2026-11-11T11:50:00+09:00', 2)).toEqual([
      '2026-11-11T12:00:00+09:00',
      '2026-11-11T12:15:00+09:00',
    ]);
  });

  it('[12.5] morning-status は毎朝 9:00 に起動する（9:00 ちょうどの次は翌日の 9:00）', () => {
    expect(nextRuns('morning-status', '2026-11-11T08:59:59+09:00', 1)).toEqual([
      '2026-11-11T09:00:00+09:00',
    ]);
    expect(nextRuns('morning-status', '2026-11-11T09:00:00+09:00', 1)).toEqual([
      '2026-11-12T09:00:00+09:00',
    ]);
  });

  it('[15.2] pre-arrival は毎日 10:00 に起動する', () => {
    expect(nextRuns('pre-arrival', '2026-11-11T09:00:00+09:00', 2)).toEqual([
      '2026-11-11T10:00:00+09:00',
      '2026-11-12T10:00:00+09:00',
    ]);
  });

  it('[19.1] retention は毎日 3:00 に起動する', () => {
    expect(nextRuns('retention', '2026-11-11T01:00:00+09:00', 2)).toEqual([
      '2026-11-11T03:00:00+09:00',
      '2026-11-12T03:00:00+09:00',
    ]);
  });

  it('pending-cleanup は毎日 4:00 に起動する', () => {
    expect(nextRuns('pending-cleanup', '2026-11-11T03:00:00+09:00', 1)).toEqual([
      '2026-11-11T04:00:00+09:00',
    ]);
  });

  it('payment-reconcile は5分ごとに起動する（L-29）', () => {
    expect(nextRuns('payment-reconcile', '2026-11-10T10:00:01+09:00', 2)).toEqual([
      '2026-11-10T10:05:00+09:00',
      '2026-11-10T10:10:00+09:00',
    ]);
  });

  it('サーバーの時間帯の設定（TZ）に左右されず、日本時間で起動する', () => {
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = tz;
      // 日本時間の 9:00 ＝ UTC の 0:00
      expect(
        nextRunTimes(JOB_SCHEDULES['morning-status'], new Date('2026-11-10T12:00:00Z'), 1).map(
          (date) => date.toISOString(),
        ),
      ).toEqual(['2026-11-11T00:00:00.000Z']);
      // 日本時間の 3:00 ＝ UTC の前日 18:00
      expect(
        nextRunTimes(JOB_SCHEDULES.retention, new Date('2026-11-10T12:00:00Z'), 1).map((date) =>
          date.toISOString(),
        ),
      ).toEqual(['2026-11-10T18:00:00.000Z']);
    }
  });
});
