import { Global, Module } from '@nestjs/common';
import { ConsoleRequestLogSink, RequestLogSink } from './request-log.js';

/** 要求のログの出力先を提供する。テストでは RequestLogSink を上書きする */
@Global()
@Module({
  providers: [{ provide: RequestLogSink, useClass: ConsoleRequestLogSink }],
  exports: [RequestLogSink],
})
export class LoggingModule {}
