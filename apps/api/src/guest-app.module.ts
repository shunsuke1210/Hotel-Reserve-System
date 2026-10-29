// 公開用 API（GuestApp、ポート3001、/api/guest）。宿泊客向けの機能だけを載せる（ADR-03）。
// スタッフ向けのモジュールはここに加えない（公開側のプロセスに、スタッフ向けの機能がそもそも存在しないようにする）。
// SessionModule.forGuest()：他サイトからの要求の拒否と会員の認証の確認（スタッフのセッションは受け付けない）。
// NotificationsModule：メールの作成（MailService。会員登録の確認・予約の確定などのメール。tasks.md 3.4）。
// 後のタスクで auth（会員）・members・search・reservations（会員）・roster（会員）・content を加える。
import { Module } from '@nestjs/common';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { ClockModule } from './shared/clock/clock.module.js';
import { LoggingModule } from './shared/logging/logging.module.js';
import { PrismaModule } from './shared/prisma/prisma.module.js';
import { SessionModule } from './shared/session/session.module.js';

@Module({
  imports: [
    ClockModule,
    LoggingModule,
    PrismaModule,
    IntegrationsModule,
    SessionModule.forGuest(),
    NotificationsModule,
    HealthModule,
  ],
})
export class GuestAppModule {}
