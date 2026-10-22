import { Controller, Get } from '@nestjs/common';
import { BusinessClock } from '../../shared/clock/business-clock.js';

/** 稼働確認の応答 */
export interface HealthResponse {
  status: 'ok';
  /** 業務の時計の現在時刻（日本時間、時差つきの ISO 8601） */
  time: string;
}

/** 稼働確認（公開用は /api/guest/health、社内用は /api/staff/health） */
@Controller('health')
export class HealthController {
  constructor(private readonly clock: BusinessClock) {}

  @Get()
  check(): HealthResponse {
    return { status: 'ok', time: this.clock.nowInJapan().toISOString() };
  }
}
