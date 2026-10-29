// 清掃・部屋の状態（design.md File Structure Plan の housekeeping/ の room-status.service）。
//
// HousekeepingModule：RoomStatusService（部屋の状態の変更。スタッフの手動の変更と、業務の操作の入口）を提供する。
//   URL はまだ持たない（社内用 API の GET /rooms/status-board・POST /rooms/{id}/status は 7.11 で、このモジュールに
//   コントローラーを加える）。社内用の待ち受け口だけが読み込む（清掃員・フロントの操作と定時処理。宿泊客の操作は
//   部屋の状態を変えない）。チェックイン・チェックアウト（front-desk）、故障中（maintenance）、9:00 の処理（jobs）は、
//   このモジュールを imports に加えて RoomStatusService を注入する（部屋の状態はこのサービスでだけ変える）。
// 手動の変更の操作履歴のため AuditModule を読み込む（社内用の待ち受け口では読み込み済みの同じもの）。
// PrismaService・BusinessClock は全体に提供されているもの（PrismaModule・ClockModule）を使う。
import { Module } from '@nestjs/common';
import { AuditModule } from '../../shared/audit/audit.module.js';
import { RoomStatusService } from './room-status.service.js';

@Module({
  imports: [AuditModule],
  providers: [RoomStatusService],
  exports: [RoomStatusService],
})
export class HousekeepingModule {}
