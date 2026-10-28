// セッションと認証・権限の共通部品を、待ち受け口ごとに登録する（research.md ADR-03・ADR-04）。
//
//   公開用（GuestApp）：SessionModule.forGuest() … 他サイトからの要求の拒否 → 会員の認証の確認
//   社内用（StaffApp）：SessionModule.forStaff() … 他サイトからの要求の拒否 → スタッフの認証の確認 → 役割の判定
//
// 確認（APP_GUARD）は、ここに書いた順に、すべての操作に通す。公開用の待ち受け口には、スタッフの認証の確認と
// 役割の判定を登録しない（スタッフのセッションを受け付けない）。
// SessionService・PasswordHasher・LoginAttemptLimiter は、ログインなどの機能（modules/auth）から注入して使う。
import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CsrfHeaderGuard } from '../security/csrf-header.guard.js';
import { LoginAttemptLimiter } from '../security/login-attempt-limiter.js';
import { PasswordHasher } from '../security/password-hasher.js';
import { MemberAuthGuard } from './member-auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import { SessionService } from './session.service.js';
import { StaffAuthGuard } from './staff-auth.guard.js';

const SHARED_PROVIDERS: Provider[] = [SessionService, PasswordHasher, LoginAttemptLimiter];
const SHARED_EXPORTS = [SessionService, PasswordHasher, LoginAttemptLimiter];

@Module({})
export class SessionModule {
  /** 公開用の待ち受け口 */
  static forGuest(): DynamicModule {
    return {
      module: SessionModule,
      global: true,
      providers: [
        ...SHARED_PROVIDERS,
        { provide: APP_GUARD, useClass: CsrfHeaderGuard },
        { provide: APP_GUARD, useClass: MemberAuthGuard },
      ],
      exports: SHARED_EXPORTS,
    };
  }

  /** 社内用の待ち受け口 */
  static forStaff(): DynamicModule {
    return {
      module: SessionModule,
      global: true,
      providers: [
        ...SHARED_PROVIDERS,
        { provide: APP_GUARD, useClass: CsrfHeaderGuard },
        { provide: APP_GUARD, useClass: StaffAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
      exports: SHARED_EXPORTS,
    };
  }
}
