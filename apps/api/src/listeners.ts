// 公開用（GuestApp）と社内用（StaffApp）の2つの待ち受け口を、1つのプロセスで立てる（ADR-03）。
// 2つのアプリは別々のモジュール群を持ち、共通の仕組み（URL の接頭辞・要求のログ・エラーの変換）は
// configureListener でそろえる。テストも同じ関数で設定する。
import {
  ConsoleLogger,
  type INestApplication,
  type LoggerService,
  type LogLevel,
  type Type,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { GuestAppModule } from './guest-app.module.js';
import { ApiExceptionFilter } from './shared/errors/api-exception.filter.js';
import type { ListenerName } from './shared/logging/request-context.js';
import { RequestLogSink } from './shared/logging/request-log.js';
import { createRequestLoggingMiddleware } from './shared/logging/request-logging.middleware.js';
import { StaffAppModule } from './staff-app.module.js';

export interface ListenerDefinition {
  /** URL の接頭辞（公開用 API はすべて /api/guest、社内用 API はすべて /api/staff で始まる） */
  prefix: string;
  /** 既定のポート */
  port: number;
  module: Type;
}

export const LISTENERS = {
  guest: { prefix: 'api/guest', port: 3001, module: GuestAppModule },
  staff: { prefix: 'api/staff', port: 3002, module: StaffAppModule },
} as const satisfies Record<ListenerName, ListenerDefinition>;

/** 待ち受け口に共通の仕組みを入れる（app.init() または listen() の前に呼ぶ） */
export function configureListener(app: NestExpressApplication, listener: ListenerName): void {
  app.disable('x-powered-by');
  app.setGlobalPrefix(LISTENERS[listener].prefix);
  app.use(createRequestLoggingMiddleware({ listener, sink: app.get(RequestLogSink) }));
  app.useGlobalFilters(new ApiExceptionFilter());
}

export interface CreateListenerOptions {
  /** NestJS のロガー（省略時は1行の JSON で標準出力に書く。false で出さない） */
  logger?: LoggerService | LogLevel[] | false;
}

export async function createListenerApp(
  listener: ListenerName,
  options: CreateListenerOptions = {},
): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(LISTENERS[listener].module, {
    logger: options.logger ?? new ConsoleLogger({ json: true }),
    abortOnError: false,
  });
  configureListener(app, listener);
  return app;
}

export interface RunningApis {
  guest: INestApplication;
  staff: INestApplication;
  /** 2つの待ち受け口を閉じる */
  close(): Promise<void>;
}

/**
 * 公開用と社内用の2つの待ち受け口を起動する。
 * @param ports 待ち受けるポート（省略時は公開用 3001・社内用 3002。0 なら空いているポート）
 */
export async function startApis(
  ports: Partial<Record<ListenerName, number>> = {},
  options: CreateListenerOptions = {},
): Promise<RunningApis> {
  const guest = await createListenerApp('guest', options);
  const staff = await createListenerApp('staff', options);
  const close = async (): Promise<void> => {
    await Promise.all([guest.close(), staff.close()]);
  };
  try {
    await guest.listen(ports.guest ?? LISTENERS.guest.port);
    await staff.listen(ports.staff ?? LISTENERS.staff.port);
  } catch (error) {
    await close();
    throw error;
  }
  return { guest, staff, close };
}
