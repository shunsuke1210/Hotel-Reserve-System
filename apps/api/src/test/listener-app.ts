// テスト用に、本番と同じモジュールと共通の設定で待ち受け口のアプリを作る（ポートでは待ち受けない）。
// 時計・要求のログと定時処理のログの出力先・データベース（PrismaService）・定時処理の一覧は、テストから差し替えられる。
// データベースは、指定しなければ使えない（単体テストはデータベースなしで動く。pnpm check）。
// 社内用の待ち受け口でも定時の起動は始めない（JobScheduler.start() を呼ばない）。定時処理は runNow で実行する。
import type { INestApplication, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { configureListener, LISTENERS } from '../listeners.js';
import { SCHEDULED_JOBS } from '../modules/jobs/job-scheduler.js';
import { BusinessClock } from '../shared/clock/business-clock.js';
import { JobLogSink } from '../shared/jobs/job-log.js';
import type { ScheduledJob } from '../shared/jobs/scheduled-job.js';
import { PrismaService } from '../shared/prisma/prisma.service.js';
import type { ListenerName } from '../shared/logging/request-context.js';
import { RequestLogSink, type RequestLogEntry } from '../shared/logging/request-log.js';
import { MemoryJobLogSink } from './jobs.js';

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
  /**
   * データベース。
   * - 省略時：使えない（使おうとすると理由を示して失敗する。単体テスト用）
   * - PrismaService：そのデータベースを使う（結合テストの createTestDatabase().prisma など）
   * - 'process'：本番と同じく、設定ファイルの接続先でプロセスに1つの PrismaService を使う（PrismaModule の確認用）
   */
  prisma?: PrismaService | 'process';
  /** 定時処理のログの出力先（省略時はメモリに貯めるだけで、画面には出さない。社内用の待ち受け口だけ） */
  jobLogSink?: JobLogSink;
  /** 社内用の待ち受け口に登録する定時処理（省略時は本番と同じ。テスト用の処理だけにするときに指定する） */
  jobs?: ScheduledJob[];
}

/** PrismaService を調べるだけの操作（NestJS のライフサイクルの確認など）では、失敗させずに undefined を返す */
const INSPECTED_PROPERTIES = new Set([
  'then',
  'constructor',
  'toJSON',
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
]);

/** データベースを使わないテストの PrismaService の代わり。使おうとすると、理由を示して失敗する */
export function createNoDatabasePrisma(): PrismaService {
  return new Proxy(Object.create(null) as object, {
    get(_target, property) {
      if (typeof property === 'symbol' || INSPECTED_PROPERTIES.has(property)) return undefined;
      throw new Error(
        `このテストはデータベースを使いません（PrismaService.${property}）。結合テスト（*.integration.test.ts）で createTestListenerApp の prisma を指定してください`,
      );
    },
  }) as PrismaService;
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
  if (listener === 'staff') {
    builder.overrideProvider(JobLogSink).useValue(options.jobLogSink ?? new MemoryJobLogSink());
    if (options.jobs) builder.overrideProvider(SCHEDULED_JOBS).useValue(options.jobs);
  }
  if (options.prisma !== 'process') {
    builder.overrideProvider(PrismaService).useValue(options.prisma ?? createNoDatabasePrisma());
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureListener(app, listener);
  await app.init();
  return app;
}
