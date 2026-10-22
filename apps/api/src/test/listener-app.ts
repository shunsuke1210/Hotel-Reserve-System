// テスト用に、本番と同じモジュールと共通の設定で待ち受け口のアプリを作る（ポートでは待ち受けない）。
// 時計と要求のログの出力先は、テストから差し替えられる。
import type { INestApplication, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { configureListener, LISTENERS } from '../listeners.js';
import { BusinessClock } from '../shared/clock/business-clock.js';
import type { ListenerName } from '../shared/logging/request-context.js';
import { RequestLogSink, type RequestLogEntry } from '../shared/logging/request-log.js';

/** 要求のログをメモリに貯める出力先（テスト用） */
export class MemoryRequestLogSink extends RequestLogSink {
  readonly entries: RequestLogEntry[] = [];

  override write(entry: RequestLogEntry): void {
    this.entries.push(entry);
  }
}

export interface TestListenerOptions {
  /** 差し替える時計（省略時は実際の時計） */
  clock?: BusinessClock;
  /** 要求のログの出力先（省略時はメモリに貯めるだけで、画面には出さない） */
  logSink?: RequestLogSink;
  /** テストのためだけに加えるコントローラー */
  controllers?: Type[];
}

export async function createTestListenerApp(
  listener: ListenerName,
  options: TestListenerOptions = {},
): Promise<INestApplication> {
  const builder = Test.createTestingModule({
    imports: [LISTENERS[listener].module],
    controllers: options.controllers ?? [],
  });
  if (options.clock) {
    builder.overrideProvider(BusinessClock).useValue(options.clock);
  }
  builder.overrideProvider(RequestLogSink).useValue(options.logSink ?? new MemoryRequestLogSink());

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureListener(app, listener);
  await app.init();
  return app;
}
