import { Global, Module } from '@nestjs/common';
import { BusinessClock, SystemBusinessClock } from './business-clock.js';

/** 業務の時計を全モジュールに提供する。テストでは BusinessClock を上書きして時刻を固定する */
@Global()
@Module({
  providers: [{ provide: BusinessClock, useClass: SystemBusinessClock }],
  exports: [BusinessClock],
})
export class ClockModule {}
