// 操作履歴の記録（AuditLogService）を、読み込んだ待ち受け口の全モジュールに提供する。
// 社内用の待ち受け口（StaffAppModule）だけが読み込む：記録するのはスタッフの操作と定時処理の操作で、
// 定時処理も社内用の待ち受け口で動く。公開用の待ち受け口のモジュールからも使う処理（例：両方の待ち受け口が読み込む
// サービスがスタッフの操作のときだけ記録する）ができたら、GuestAppModule にもこのモジュールを加える
// （AuditLogService は状態を持たないので、待ち受け口ごとに作ってよい）。
import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service.js';

@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
