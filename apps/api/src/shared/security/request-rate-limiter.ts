// 要求の回数制限（設計の補足 L-27・L-40・L-47）。確認メールの再送・再設定の申込（同じ IP から1分5回。4.3）、
// 公開用の空室検索（IP ごとに1分60回。design.md Performance & Scalability）などに使う。
//
// - 直近の期間（60秒）に受け付けた要求の数で判定し、上限に達していれば RATE_LIMITED で断る（L-40）
// - 断った要求は数えない（L-47）
//
//   private readonly resendLimiter = new RequestRateLimiter(this.clock, { limit: 5, windowMs: 60_000 });
//   this.resendLimiter.consume(clientIp(req));   // 上限なら BusinessError（RATE_LIMITED）
//
// 記録はプロセスのメモリにだけ置く（再起動で消える）。
import type { BusinessClock } from '../clock/business-clock.js';
import { BusinessError } from '../errors/business-error.js';
import { SlidingWindowLog } from './sliding-window-log.js';

export interface RequestRateLimit {
  /** 期間の中で受け付ける要求の数 */
  limit: number;
  /** 期間（ミリ秒） */
  windowMs: number;
}

export class RequestRateLimiter {
  private readonly accepted: SlidingWindowLog;
  private readonly limit: number;

  constructor(
    private readonly clock: BusinessClock,
    options: RequestRateLimit,
  ) {
    if (!Number.isInteger(options.limit) || options.limit <= 0) {
      throw new RangeError(`上限は正の整数にしてください: ${options.limit}`);
    }
    this.limit = options.limit;
    this.accepted = new SlidingWindowLog(options.windowMs);
  }

  /** 上限に達していなければ要求を1つ数え、達していれば数えずに RATE_LIMITED を投げる */
  consume(key: string): void {
    const now = this.clock.now().getTime();
    if (this.accepted.count(key, now) >= this.limit) {
      throw new BusinessError('RATE_LIMITED');
    }
    this.accepted.add(key, now);
  }

  /** 記録を持っているキーの数（古い記録を消していることの確認用） */
  get trackedKeyCount(): number {
    return this.accepted.keyCount;
  }
}
