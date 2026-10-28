// 公開用 API（GuestApp）の会員の認証の確認（research.md ADR-04）。公開用の待ち受け口のすべての操作に通す（APP_GUARD）。
//
// - 会員のセッションの Cookie だけを読む（スタッフのセッションは受け付けない。ほかの種類のセッションの ID を
//   会員の Cookie の名前で送っても、sessions.realm が違うので受け付けない）
// - 有効な会員（status が ACTIVE）なら、要求に会員を結び付け、要求のログの利用者の種類を MEMBER に、
//   文言の言語を会員の preferred_locale にする（設計の補足 L-11）
// - @MemberOnly() の操作で会員が分からなければ UNAUTHENTICATED。それ以外の操作はログインしていなくても通す
import { LocaleSchema } from '@hotel/contracts';
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { BusinessError } from '../errors/business-error.js';
import { findRequestContext } from '../logging/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MEMBER_ONLY_KEY } from './auth.decorators.js';
import { attachMemberPrincipal, type MemberPrincipal } from './principals.js';
import { SessionService } from './session.service.js';

@Injectable()
export class MemberAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const member = await this.sessions.resolve(req, res, 'MEMBER', (id) => this.loadMember(id));
    if (member) {
      attachMemberPrincipal(req, member);
      const requestContext = findRequestContext(req);
      if (requestContext) {
        requestContext.userType = 'MEMBER';
        requestContext.preferredLocale = member.preferredLocale;
      }
      return true;
    }

    const memberOnly = this.reflector.getAllAndOverride<boolean | undefined>(MEMBER_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (memberOnly) throw new BusinessError('UNAUTHENTICATED');
    return true;
  }

  /** 有効な会員（退会・確認前でない）だけを返す */
  private async loadMember(memberId: string): Promise<MemberPrincipal | undefined> {
    const row = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: { id: true, status: true, preferredLocale: true },
    });
    const locale = LocaleSchema.safeParse(row?.preferredLocale);
    if (!row || row.status !== 'ACTIVE' || !locale.success) return undefined;
    return { memberId: row.id, preferredLocale: locale.data };
  }
}
