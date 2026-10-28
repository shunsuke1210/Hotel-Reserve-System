// ログインしている利用者（認証の確認が要求に結び付け、コントローラーが受け取る）。
//
//   @MemberOnly()
//   @Get('me')
//   me(@CurrentMember() member: MemberPrincipal) { … }   // 会員の API は必ず member.memberId で絞り込む（要件 1.10）
//
//   @RequireRole('FRONT')
//   @Post('…')
//   op(@CurrentStaff() staff: StaffPrincipal) { … }       // 操作履歴（3.3）には staff.staffNumber を記録する
import type { Locale, StaffRole } from '@hotel/contracts';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { BusinessError } from '../errors/business-error.js';

/** ログインしている会員（公開用 API） */
export interface MemberPrincipal {
  readonly memberId: string;
  /** 会員が選んだ言語（公開用 API の文言の言語。設計の補足 L-11） */
  readonly preferredLocale: Locale;
}

/** ログインしているスタッフ（社内用 API） */
export interface StaffPrincipal {
  readonly staffId: string;
  readonly staffNumber: string;
  readonly role: StaffRole;
}

const members = new WeakMap<object, MemberPrincipal>();
const staffMembers = new WeakMap<object, StaffPrincipal>();

export function attachMemberPrincipal(req: object, principal: MemberPrincipal): void {
  members.set(req, principal);
}

export function attachStaffPrincipal(req: object, principal: StaffPrincipal): void {
  staffMembers.set(req, principal);
}

/** 要求の会員（ログインしていなければ undefined） */
export function findMemberPrincipal(req: object): MemberPrincipal | undefined {
  return members.get(req);
}

/** 要求のスタッフ（ログインしていなければ undefined） */
export function findStaffPrincipal(req: object): StaffPrincipal | undefined {
  return staffMembers.get(req);
}

/** ログインしている会員を受け取る。ログインしていなければ UNAUTHENTICATED */
export const CurrentMember = createParamDecorator(
  (_data: unknown, context: ExecutionContext): MemberPrincipal => {
    const member = findMemberPrincipal(context.switchToHttp().getRequest<Request>());
    if (!member) throw new BusinessError('UNAUTHENTICATED');
    return member;
  },
);

/** ログインしているスタッフを受け取る。ログインしていなければ UNAUTHENTICATED */
export const CurrentStaff = createParamDecorator(
  (_data: unknown, context: ExecutionContext): StaffPrincipal => {
    const staff = findStaffPrincipal(context.switchToHttp().getRequest<Request>());
    if (!staff) throw new BusinessError('UNAUTHENTICATED');
    return staff;
  },
);
