// 社内用 API（StaffApp、ポート3002、/api/staff）。スタッフ向けの機能と定時処理を載せる（ADR-03）。
// SessionModule.forStaff()：他サイトからの要求の拒否・スタッフの認証の確認・役割の判定（ログインせずに使える操作は @AllowAnonymous()）。
// 後のタスクで auth（スタッフ）・front-desk・housekeeping・maintenance・notices・surcharges・jobs を加える。
import { Module } from '@nestjs/common';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { HealthModule } from './modules/health/health.module.js';
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
    SessionModule.forStaff(),
    HealthModule,
  ],
})
export class StaffAppModule {}
