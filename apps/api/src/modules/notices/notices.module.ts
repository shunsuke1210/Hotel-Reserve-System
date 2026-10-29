// お知らせ（design.md File Structure Plan の notices/ の notice.service）。
//
// NoticesModule：NoticeService（お知らせの記録・重複のまとめ・解決、未解決の件数と一覧、清掃時間の判定）を提供する。
//   URL は持たない（社内用 API の GET /notices・POST /notices/{id}/resolve は 7.6 で加える）。
//   社内用の待ち受け口が読み込む（フロントの登録・変更・移動・入れ替え・時間外の追加がお知らせを作る）。
//   公開用の待ち受け口の処理（Web の確定 5.7・会員の変更 6.2・空室検索 5.2）も、このモジュールを imports に加えて使う
//   （宿泊客向けの URL は増えない）。
// 解決の操作履歴のため AuditModule を読み込む（社内用の待ち受け口では読み込み済みの同じもの。公開用の待ち受け口でも
// AuditLogService が使えるようになるが、状態を持たないので問題はない：shared/audit/audit.module.ts）。
// PrismaService・BusinessClock は全体に提供されているもの（PrismaModule・ClockModule）を使う。
import { Module } from '@nestjs/common';
import { AuditModule } from '../../shared/audit/audit.module.js';
import { NoticeService } from './notice.service.js';

@Module({
  imports: [AuditModule],
  providers: [NoticeService],
  exports: [NoticeService],
})
export class NoticesModule {}
