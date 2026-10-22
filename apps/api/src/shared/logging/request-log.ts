import type { ErrorCode } from '@hotel/contracts';
import { Injectable, Logger } from '@nestjs/common';
import type { ListenerName, UserType } from './request-context.js';

/**
 * 1つの要求のログ（design.md「Error Handling > Monitoring」）。
 * 個人情報を出さないため、要求の本文・クエリ文字列・Cookie などのヘッダー・IP アドレスは含めない。
 */
export interface RequestLogEntry {
  requestId: string;
  listener: ListenerName;
  userType: UserType;
  method: string;
  /** クエリ文字列を除いた URL のパス */
  path: string;
  status: number;
  /** 成功なら OK、エラーなら ApiError のコード */
  result: 'OK' | ErrorCode;
  durationMs: number;
}

/** 要求のログの出力先。テストでは差し替えて、書かれた内容を確かめる */
export abstract class RequestLogSink {
  abstract write(entry: RequestLogEntry): void;
}

/** 既定の出力先：アプリのロガー（本番では1行の JSON）に Request の文脈で書く */
@Injectable()
export class ConsoleRequestLogSink extends RequestLogSink {
  private readonly logger = new Logger('Request');

  override write(entry: RequestLogEntry): void {
    this.logger.log(entry);
  }
}
