// 他サイトからの要求の拒否（design.md Security Considerations、設計の補足 L-3）。
// 状態を変える要求（GET・HEAD・OPTIONS 以外）には、独自のヘッダー X-Requested-With: XMLHttpRequest を必須とし、
// なければ FORBIDDEN（403）で断る。独自のヘッダーは、他サイトのページからはブラウザの事前確認（CORS）なしに付けられない
// （どちらの待ち受け口も CORS を許可しない）。画面アプリの api/client.ts は、状態を変える要求に必ずこのヘッダーを付ける。
//
// 2つの待ち受け口の最初の確認（APP_GUARD）として登録する（shared/session/session.module.ts）。
// ログインの確認より先に行うので、他サイトからの要求でセッションを延ばしたり、処理を動かしたりしない。
// URL が見つからない要求には使われない（NOT_FOUND のまま）。
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { BusinessError } from '../errors/business-error.js';

export const CSRF_HEADER_NAME = 'X-Requested-With';
export const CSRF_HEADER_VALUE = 'XMLHttpRequest';

/** 状態を変えない要求の方法 */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfHeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
    if (req.get(CSRF_HEADER_NAME) === CSRF_HEADER_VALUE) return true;
    throw new BusinessError('FORBIDDEN');
  }
}
