// 客室タイプ・約款・翻訳文の取得（design.md File Structure Plan の content/）。
//
// ContentModule：ContentService・TranslationService を提供する（URL は持たない）。ほかのモジュール（予約の確定の
//   メールに客室タイプの名称を入れるサービスなど）は、このモジュールを imports に加えて使う。社内用の待ち受け口の
//   モジュールが読み込んでも、宿泊客向けの URL は増えない
// ContentApiModule：公開用 API の GET /room-types・GET /terms/current。公開用の待ち受け口だけが読み込む
//   （スタッフ向けの画面は日本語だけなので、翻訳文の URL は要らない。要件 16.6）
// Translator・PrismaService・BusinessClock は、全体に提供されているもの（IntegrationsModule など）を使う。
import { Module } from '@nestjs/common';
import { ContentController } from './content.controller.js';
import { ContentService } from './content.service.js';
import { TranslationService } from './translation.service.js';

@Module({
  providers: [TranslationService, ContentService],
  exports: [TranslationService, ContentService],
})
export class ContentModule {}

@Module({
  imports: [ContentModule],
  controllers: [ContentController],
})
export class ContentApiModule {}
