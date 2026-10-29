// 客室タイプ・オプション・宿泊約款の内容の取得（design.md Components の ContentService。要件 4.14・16.4）。
// 公開用 API の GET /room-types・GET /terms/current（content.controller.ts）が使う。文の言語の決め方は
// translation.service.ts（日本語は原文、ほかの言語は保存した翻訳文。なければ翻訳して保存する）。
//
// 予約の確定などのメールに客室タイプの名称を会員の言語で入れるときは、トランザクションの中から roomTypeName を使う
// （翻訳サービスを呼ばない。MailService.enqueue の内容に、会員の言語を受け取る関数で渡す。tasks.md 3.4）：
//   await this.mail.enqueue(tx, memberId, 'RESERVATION_CONFIRMED', async (locale) => ({
//     roomTypeName: await this.content.roomTypeName(tx, roomTypeId, locale), … }));
import type {
  Locale,
  RoomTypeContent,
  RoomTypeListResponse,
  TermsDocumentResponse,
} from '@hotel/contracts';
import { Injectable } from '@nestjs/common';
import { BusinessClock } from '../../shared/clock/business-clock.js';
import { BusinessError } from '../../shared/errors/business-error.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import {
  bookingOptionSources,
  roomTypeSources,
  termsDocumentSource,
} from './translatable-content.js';
import { TranslationService, type ContentDb } from './translation.service.js';

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: BusinessClock,
    private readonly translations: TranslationService,
  ) {}

  /** 客室タイプ（表示の順）とオプションの名称を、指定した言語で返す（G02・G09） */
  async listRoomTypes(locale: Locale): Promise<RoomTypeListResponse> {
    const types = await this.prisma.roomType.findMany({
      orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        nameJa: true,
        areaSqm: true,
        bedDescriptionJa: true,
        capacityAdults: true,
        descriptionJa: true,
      },
    });
    const typeSources = types.map((type) => roomTypeSources(type));
    const options = bookingOptionSources();
    const texts = await this.translations.localize(
      this.prisma,
      [
        ...typeSources.flatMap((sources) => [
          sources.name,
          sources.bedDescription,
          sources.description,
        ]),
        ...options.map((option) => option.source),
      ],
      locale,
    );
    const textAt = (index: number): string => {
      const text = texts[index];
      if (text === undefined) throw new Error('翻訳した文の数が、翻訳する文章の数と合いません');
      return text;
    };

    const roomTypes = types.map((type, index): RoomTypeContent => ({
      id: type.id,
      code: type.code,
      name: textAt(index * 3),
      areaSqm: type.areaSqm,
      bedDescription: textAt(index * 3 + 1),
      capacityAdults: type.capacityAdults,
      description: textAt(index * 3 + 2),
    }));
    return {
      locale,
      roomTypes,
      options: options.map((option, index) => ({
        code: option.code,
        name: textAt(types.length * 3 + index),
      })),
    };
  }

  /**
   * 今の版の宿泊約款（公開の日時が今以前の版のうち、最も新しい版）を、指定した言語で返す（G10。要件 4.14）。
   * @throws BusinessError NOT_FOUND 公開した版がないとき
   */
  async currentTerms(locale: Locale): Promise<TermsDocumentResponse> {
    const document = await this.prisma.termsDocument.findFirst({
      where: { publishedAt: { lte: this.clock.now() } },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, bodyJa: true, publishedAt: true },
    });
    if (!document) throw new BusinessError('NOT_FOUND');
    const [body = document.bodyJa] = await this.translations.localize(
      this.prisma,
      [termsDocumentSource(document)],
      locale,
    );
    return {
      locale,
      version: document.version,
      publishedAt: document.publishedAt.toISOString(),
      body,
    };
  }

  /**
   * 客室タイプの名称を、指定した言語で返す（メールなど。トランザクションの中で使える）。
   * 翻訳サービスは呼ばず、使える翻訳文がなければ日本語の原文を返す。
   * @throws Error 客室タイプがないとき
   */
  async roomTypeName(db: ContentDb, roomTypeId: string, locale: Locale): Promise<string> {
    const type = await db.roomType.findUniqueOrThrow({
      where: { id: roomTypeId },
      select: { id: true, nameJa: true, bedDescriptionJa: true, descriptionJa: true },
    });
    const [name = type.nameJa] = await this.translations.localize(
      db,
      [roomTypeSources(type).name],
      locale,
      { translate: false },
    );
    return name;
  }
}
