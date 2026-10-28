// 社内用 API の役割の判定（design.md 社内用 API の表、要件 2.2・2.4・2.5）。StaffAuthGuard の後に通す（APP_GUARD）。
// @RequireRole で指定した役割以上でなければ FORBIDDEN（「権限がありません」。L-33）。指定がなければ清掃員以上（ログインしていればよい）。
// 要求の内容の検証（ValidationPipe など）より先に行うので、要求の内容に関係なく FORBIDDEN になる（TC-MB-357〜372）。
import type { StaffRole } from '@hotel/contracts';
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { BusinessError } from '../errors/business-error.js';
import { REQUIRED_ROLE_KEY } from './auth.decorators.js';
import { findStaffPrincipal } from './principals.js';
import { hasRoleAtLeast } from './roles.js';
import { isAnonymousAllowed } from './staff-auth.guard.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    if (isAnonymousAllowed(this.reflector, context)) return true;

    const staff = findStaffPrincipal(context.switchToHttp().getRequest<Request>());
    if (!staff) throw new BusinessError('UNAUTHENTICATED');
    const required =
      this.reflector.getAllAndOverride<StaffRole | undefined>(REQUIRED_ROLE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'CLEANER';
    if (!hasRoleAtLeast(staff.role, required)) throw new BusinessError('FORBIDDEN');
    return true;
  }
}
