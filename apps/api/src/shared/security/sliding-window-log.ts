// 回数制限の記録：キーごとに、直近の一定時間に起きた出来事の時刻を持つ（設計の補足 L-7・L-40）。
// 期間ちょうど前の出来事は数えない（「60秒たてば古い要求は数えない」）。
// 記録はプロセスのメモリにだけ置く（再起動で消える）。古い記録は、期間ごとにまとめて消す。

export class SlidingWindowLog {
  private readonly events = new Map<string, number[]>();
  private lastSweepMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly windowMs: number) {
    if (!Number.isInteger(windowMs) || windowMs <= 0) {
      throw new RangeError(`期間は正の整数（ミリ秒）にしてください: ${windowMs}`);
    }
  }

  /** nowMs の時点で、キーの直近の期間に起きた出来事の数 */
  count(key: string, nowMs: number): number {
    this.sweepIfDue(nowMs);
    return this.recent(key, nowMs).length;
  }

  /** キーに出来事を1つ記録する */
  add(key: string, atMs: number): void {
    this.sweepIfDue(atMs);
    const recent = this.recent(key, atMs);
    recent.push(atMs);
    this.events.set(key, recent);
  }

  /** キーに記録した出来事のうち、時刻が atMs のものを1つ取り消す（記録した出来事が、数える対象でないと分かったとき） */
  remove(key: string, atMs: number): void {
    const list = this.events.get(key);
    const index = list?.lastIndexOf(atMs) ?? -1;
    if (list && index !== -1) {
      list.splice(index, 1);
      if (list.length === 0) this.events.delete(key);
    }
  }

  /** 記録を持っているキーの数（古い記録を消していることの確認用） */
  get keyCount(): number {
    return this.events.size;
  }

  /** キーの直近の期間の出来事（古いものは消す） */
  private recent(key: string, nowMs: number): number[] {
    const list = this.events.get(key);
    if (!list) return [];
    const threshold = nowMs - this.windowMs;
    const recent = list.filter((at) => at > threshold);
    if (recent.length === 0) {
      this.events.delete(key);
    } else if (recent.length !== list.length) {
      this.events.set(key, recent);
    }
    return recent;
  }

  /** 期間が過ぎるたびに、すべてのキーの古い記録を消す（二度と使われないキーを持ち続けないように） */
  private sweepIfDue(nowMs: number): void {
    if (nowMs - this.lastSweepMs < this.windowMs) return;
    this.lastSweepMs = nowMs;
    for (const key of [...this.events.keys()]) {
      this.recent(key, nowMs);
    }
  }
}
