// 社内用 API（StaffApp、ポート3002、/api/staff）。スタッフ向けの機能と定時処理を載せる（ADR-03）。
// SessionModule.forStaff()：他サイトからの要求の拒否・スタッフの認証の確認・役割の判定（ログインせずに使える操作は @AllowAnonymous()）。
// JobsModule：定時処理（社内用の待ち受け口だけに載せる。定時の起動は startApis が始める）。
// AuditModule：操作履歴の記録（スタッフの操作と定時処理の操作。tasks.md 3.3）。
// 後のタスクで auth（スタッフ）・front-desk・housekeeping・maintenance・notices・surcharges を加える。
import { Module } from '@nestjs/common';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { AuditModule } from './shared/audit/audit.module.js';
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
    AuditModule,
    SessionModule.forStaff(),
    HealthModule,
    JobsModule,
  ],
})
export class StaffAppModule {}
