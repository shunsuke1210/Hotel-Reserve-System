// ログインと役割の要否を、コントローラー（クラスまたはメソッド）に付ける印。
//
// 公開用 API（GuestApp）：ログインしなくても使える。会員だけの操作に @MemberOnly() を付ける
//   （ログインしていれば、どの URL でも会員が分かり、文言は会員の言語になる）
// 社内用 API（StaffApp）：すべての操作にスタッフのログインが要る。ログイン・稼働確認などだけに @AllowAnonymous() を付ける。
//   役割が要る操作に @RequireRole('FRONT') などを付ける（その役割以上。付けなければ清掃員以上）
import type { StaffRole } from '@hotel/contracts';
import { SetMetadata } from '@nestjs/common';

export const MEMBER_ONLY_KEY = 'hotel:member-only';
export const ALLOW_ANONYMOUS_KEY = 'hotel:allow-anonymous';
export const REQUIRED_ROLE_KEY = 'hotel:required-role';

/** 公開用 API：会員のログインが要る操作（ログインしていなければ UNAUTHENTICATED） */
export const MemberOnly = (): ClassDecorator & MethodDecorator =>
  SetMetadata(MEMBER_ONLY_KEY, true);

/** 社内用 API：ログインせずに使える操作（スタッフのログイン・稼働確認） */
export const AllowAnonymous = (): ClassDecorator & MethodDecorator =>
  SetMetadata(ALLOW_ANONYMOUS_KEY, true);

/** 社内用 API：その役割以上のスタッフだけが使える操作（満たさなければ FORBIDDEN。要件 2.4） */
export const RequireRole = (role: StaffRole): ClassDecorator & MethodDecorator =>
  SetMetadata(REQUIRED_ROLE_KEY, role);
