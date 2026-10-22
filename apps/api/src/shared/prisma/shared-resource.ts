/**
 * プロセスで1つだけ作って、複数の利用者（2つの待ち受け口の DI コンテナ）で共有する資源。
 * 最初の acquire で作り、acquire した数だけ release されたら片付ける（その後の acquire では作り直す）。
 */
export class SharedResource<T> {
  private current: { value: T; users: number } | undefined;

  constructor(
    private readonly create: () => T,
    private readonly dispose: (value: T) => Promise<void>,
  ) {}

  acquire(): T {
    this.current ??= { value: this.create(), users: 0 };
    this.current.users += 1;
    return this.current.value;
  }

  /** acquire で受け取った値を返す。いま共有している値でなければ（テストで差し替えた値など）何もしない */
  async release(value: T): Promise<void> {
    const current = this.current;
    if (current === undefined || current.value !== value) return;
    current.users -= 1;
    if (current.users > 0) return;
    this.current = undefined;
    await this.dispose(current.value);
  }
}
