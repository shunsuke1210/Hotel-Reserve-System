// 公開用 API の客室タイプ・約款の内容（design.md「公開用 API」の GET /room-types・GET /terms/current。要件 4.14・16.4）。
// ログインしなくても使える（G02 の検索結果は未ログインでも表示する）。状態を変えない要求なので、独自のヘッダーは要らない。
//
// 文の言語：
//   - lang（ja・en・ko・zh-Hans・zh-Hant）を指定すれば、その言語（画面で選んだ言語）
//   - lang がなければ要求の言語（ログイン中は会員の preferred_locale、ログインしていなければ Accept-Language。L-11）
//   - 対応しない値・2つ以上の指定は VALIDATION_FAILED
import {
  LocaleSchema,
  type Locale,
  type RoomTypeListResponse,
  type TermsDocumentResponse,
} from '@hotel/contracts';
import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { BusinessError } from '../../shared/errors/business-error.js';
import { requestLocale } from '../../shared/i18n/request-locale.js';
import { ContentService } from './content.service.js';

const ContentQuerySchema = z.object({ lang: LocaleSchema.optional() });

@Controller()
export class ContentController {
  constructor(private readonly content: ContentService) {}

  /** 客室タイプ（表示の順）とオプションの名称 */
  @Get('room-types')
  listRoomTypes(@Query() query: unknown, @Req() req: Request): Promise<RoomTypeListResponse> {
    return this.content.listRoomTypes(contentLocale(query, req));
  }

  /** 今の版の宿泊約款 */
  @Get('terms/current')
  currentTerms(@Query() query: unknown, @Req() req: Request): Promise<TermsDocumentResponse> {
    return this.content.currentTerms(contentLocale(query, req));
  }
}

function contentLocale(rawQuery: unknown, req: Request): Locale {
  const query = ContentQuerySchema.safeParse(rawQuery);
  if (!query.success) throw new BusinessError('VALIDATION_FAILED');
  return query.data.lang ?? requestLocale(req);
}
