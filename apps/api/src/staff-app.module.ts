// 社内用 API（StaffApp、ポート3002、/api/staff）。スタッフ向けの機能と定時処理を載せる（ADR-03）。
// 後のタスクで auth（スタッフ）・front-desk・housekeeping・maintenance・notices・surcharges・jobs を加える。
import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';
import { ClockModule } from './shared/clock/clock.module.js';
import { LoggingModule } from './shared/logging/logging.module.js';

@Module({
  imports: [ClockModule, LoggingModule, HealthModule],
})
export class StaffAppModule {}
