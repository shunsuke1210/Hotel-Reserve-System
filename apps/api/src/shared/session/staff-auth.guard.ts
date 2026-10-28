// 社内用 API（StaffApp）のスタッフの認証の確認（research.md ADR-04）。社内用の待ち受け口のすべての操作に通す（APP_GUARD）。
//
// - @AllowAnonymous() の操作（ログイン・稼働確認）以外は、スタッフのログインが要る（なければ UNAUTHENTICATED。
//   役割が足りなくても、ログインしていなければ FORBIDDEN ではなく UNAUTHENTICATED：TC-MB-193）
// - スタッフのセッションの Cookie だけを読む（会員のセッションは受け付けない）
// - 停止中のスタッフ（is_active が false）のセッションは受け付けず、消す（L-9）
// - 役割は要求ごとにデータベースから読む（役割を変えれば次の要求から反映される）。役割の判定は RolesGuard が行う
import { StaffRoleSchema } from '@hotel/contracts';
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { BusinessError } from '../errors/business-error.js';
import { findRequestContext } from '../logging/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ALLOW_ANONYMOUS_KEY } from './auth.decorators.js';
import { attachStaffPrincipal, type StaffPrincipal } from './principals.js';
import { SessionService } from './session.service.js';

@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    if (isAnonymousAllowed(this.reflector, context)) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const staff = await this.sessions.resolve(req, http.getResponse<Response>(), 'STAFF', (id) =>
      this.loadStaff(id),
    );
    if (!staff) throw new BusinessError('UNAUTHENTICATED');

    attachStaffPrincipal(req, staff);
    const requestContext = findRequestContext(req);
    if (requestContext) requestContext.userType = 'STAFF';
    return true;
  }

  /** 停止していないスタッフだけを返す */
  private async loadStaff(staffId: string): Promise<StaffPrincipal | undefined> {
    const row = await this.prisma.staff.findUnique({
      where: { id: staffId },
      select: { id: true, staffNumber: true, role: true, isActive: true },
    });
    const role = StaffRoleSchema.safeParse(row?.role);
    if (!row?.isActive || !role.success) return undefined;
    return { staffId: row.id, staffNumber: row.staffNumber, role: role.data };
  }
}

/** ログインせずに使える操作か（@AllowAnonymous()） */
export function isAnonymousAllowed(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(ALLOW_ANONYMOUS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  );
}
