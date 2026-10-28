// ログインの回数制限（design.md Security Considerations「同じ IP と ID につき1分5回まで」、設計の補足 L-7・L-47・L-48）。
//
// - 数えるのは、同じ IP・同じ ID（会員はメールアドレス、スタッフはスタッフ番号）の、認証に失敗したログインだけ
//   （成功は数えない。形式の誤り（VALIDATION_FAILED）は、呼び出す前に断るので数えない：L-48）
// - 直近60秒の失敗が5回に達したら制限し、最後の失敗から60秒で解除する（L-7）。
//   制限の間の要求は確認せずに RATE_LIMITED で断り、数えない（L-47）ので、解除の時刻は延びない
// - 同時に送られた試行も数える（確認の途中の試行を先に記録しておき、成功したら取り消す）
//
// ログインの API（4.1・4.3）は、入力の形式を確かめた後で verify を呼ぶ：
//   const staff = await limiter.verify(loginAttemptKey(req, 'STAFF', staffNumber), async () => {
//     const row = …;                                   // ID で探す（停止中・退会は見つからない扱い）
//     return (await hasher.verify(row?.passwordHash, password)) ? row : undefined;
//   });
//   await sessions.start(req, res, 'STAFF', staff.id);
//
// 記録はプロセスのメモリにだけ置く（待ち受け口ごと。会員のログインは公開用、スタッフのログインは社内用だけにある）。
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { BusinessClock } from '../clock/business-clock.js';
import { BusinessError } from '../errors/business-error.js';
import type { SessionRealm } from '../session/session-policy.js';
import { clientIp } from './client-ip.js';
import { SlidingWindowLog } from './sliding-window-log.js';

/** 失敗を数える期間（L-7） */
export const LOGIN_FAILURE_WINDOW_MS = 60_000;
/** 期間の中で認める失敗の回数（L-7） */
export const MAX_LOGIN_FAILURES = 5;

/** スタッフのログインの失敗の文言（社内用 API は日本語だけ。会員はエラーコードの既定の文言を要求の言語で返す） */
export const STAFF_INVALID_CREDENTIALS_MESSAGE = 'スタッフ番号またはパスワードが違います';

export interface LoginAttemptKey {
  realm: SessionRealm;
  /** 要求の送り元の IP アドレス */
  clientIp: string;
  /** ログインの ID（会員はメールアドレス、スタッフはスタッフ番号）。大文字と小文字は区別しない */
  loginId: string;
}

/** 要求とログインの ID から、回数制限のキーを作る */
export function loginAttemptKey(
  req: Request,
  realm: SessionRealm,
  loginId: string,
): LoginAttemptKey {
  return { realm, clientIp: clientIp(req), loginId };
}

@Injectable()
export class LoginAttemptLimiter {
  /** 失敗（と確認の途中の試行）の時刻 */
  private readonly failures = new SlidingWindowLog(LOGIN_FAILURE_WINDOW_MS);
  /** 制限を解除する時刻（キーごと） */
  private readonly lockedUntil = new Map<string, number>();

  constructor(private readonly clock: BusinessClock) {}

  /**
   * 制限の中でなければ check で認証を確かめ、成功ならその結果を返す。
   * - 制限の中：check を呼ばずに RATE_LIMITED
   * - check が null・undefined を返した（ID がない、パスワードが違うなど）：失敗に数えて INVALID_CREDENTIALS
   *   （どちらが誤りかは示さない。スタッフは「スタッフ番号またはパスワードが違います」）
   * - check が例外を投げた（データベースの障害など）：失敗に数えず、その例外をそのまま投げる
   */
  async verify<T>(key: LoginAttemptKey, check: () => Promise<T | null | undefined>): Promise<T> {
    const id = keyOf(key);
    const startedAt = this.clock.now().getTime();
    if (this.isLocked(id, startedAt)) {
      throw new BusinessError('RATE_LIMITED');
    }

    // 確認の途中の試行も、同時に送られたほかの試行から見えるように、先に失敗として記録しておく
    this.failures.add(id, startedAt);
    let result: T | null | undefined;
    try {
      result = await check();
    } catch (error) {
      this.failures.remove(id, startedAt);
      throw error;
    }

    if (result === null || result === undefined) {
      if (this.failures.count(id, startedAt) >= MAX_LOGIN_FAILURES) {
        this.lockedUntil.set(id, startedAt + LOGIN_FAILURE_WINDOW_MS);
      }
      throw new BusinessError('INVALID_CREDENTIALS', {
        message: key.realm === 'STAFF' ? STAFF_INVALID_CREDENTIALS_MESSAGE : undefined,
      });
    }
    this.failures.remove(id, startedAt);
    return result;
  }

  private isLocked(id: string, nowMs: number): boolean {
    this.releaseExpiredLocks(nowMs);
    const until = this.lockedUntil.get(id);
    return (
      (until !== undefined && nowMs < until) || this.failures.count(id, nowMs) >= MAX_LOGIN_FAILURES
    );
  }

  /** 解除の時刻を過ぎた制限を消す（二度と使われないキーを持ち続けないように） */
  private releaseExpiredLocks(nowMs: number): void {
    for (const [id, until] of this.lockedUntil) {
      if (nowMs >= until) this.lockedUntil.delete(id);
    }
  }
}

function keyOf(key: LoginAttemptKey): string {
  return [key.realm, key.clientIp, key.loginId.trim().toLowerCase()].join('\u0000');
}
