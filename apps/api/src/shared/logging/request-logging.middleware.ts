import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { errorCodeForHttpStatus } from '../errors/api-error-response.js';
import { attachRequestContext, type ListenerName, type RequestContext } from './request-context.js';
import type { RequestLogSink } from './request-log.js';

/** 要求 ID を受け渡すヘッダー。応答にも付けて、画面の問い合わせとログを突き合わせられるようにする */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** 前段（リバースプロキシ）が付けた要求 ID として受け入れる形（英数字・「.」「_」「-」の128文字まで） */
const ACCEPTABLE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export interface RequestLoggingOptions {
  listener: ListenerName;
  sink: RequestLogSink;
}

/**
 * 要求ごとに要求 ID を決めて文脈を作り、応答の完了後に1行のログを書く。
 * URL が見つからない要求も記録するため、ルーティングより前に通る Express のミドルウェアとして登録する。
 */
export function createRequestLoggingMiddleware(options: RequestLoggingOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = performance.now();
    const context: RequestContext = {
      requestId: resolveRequestId(req.headers['x-request-id']),
      listener: options.listener,
      userType: 'ANONYMOUS',
    };
    attachRequestContext(req, context);
    res.setHeader(REQUEST_ID_HEADER, context.requestId);

    res.once('finish', () => {
      const status = res.statusCode;
      options.sink.write({
        requestId: context.requestId,
        listener: context.listener,
        userType: context.userType,
        method: req.method,
        path: pathWithoutQuery(req.originalUrl),
        status,
        result: status < 400 ? 'OK' : (context.errorCode ?? errorCodeForHttpStatus(status)),
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
    next();
  };
}

function resolveRequestId(incoming: string | string[] | undefined): string {
  return typeof incoming === 'string' && ACCEPTABLE_REQUEST_ID.test(incoming)
    ? incoming
    : randomUUID();
}

/** クエリ文字列には個人情報（会員の検索の氏名・電話番号など）が入りうるため、ログに出さない */
function pathWithoutQuery(url: string): string {
  const end = url.indexOf('?');
  return end === -1 ? url : url.slice(0, end);
}
