import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { findRequestContext } from '../logging/request-context.js';
import { toApiErrorResponse } from './api-error-response.js';

/**
 * すべての例外を受け、契約のエラーの形（ApiError）で応答する。
 * 業務エラー（BusinessError）、フレームワークの例外（URL が見つからない、JSON の形式の誤り、権限の確認での拒否など）、
 * 想定外の例外のすべてが対象。想定外の例外の内容は応答に含めず、要求 ID とともにサーバーのログに残す。
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const { status, body } = toApiErrorResponse(exception);
    const context = findRequestContext(req);
    if (context) {
      context.errorCode = body.code;
    }
    if (status >= 500) {
      this.logger.error(
        `要求 ${context?.requestId ?? '(不明)'} の処理中に想定外のエラーが発生しました`,
        describeException(exception),
      );
    }

    if (res.headersSent) {
      // 応答の途中で失敗した場合は、エラーの形を送れないので接続を終える
      res.end();
      return;
    }
    res.status(status).json(body);
  }
}

function describeException(exception: unknown): string {
  if (exception instanceof Error) {
    return exception.stack ?? `${exception.name}: ${exception.message}`;
  }
  return `Error 以外の値が投げられました（${typeof exception}）`;
}
