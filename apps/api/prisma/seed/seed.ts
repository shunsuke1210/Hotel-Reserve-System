// 初期データの投入（design.md「初期データ（seed）」、tasks.md 1.5）。値は initial-data.ts と holidays.ts。
//
// 何度実行してもよい：ない行だけを追加し、既にある行は変えない（部屋の状態・振込先など運用で変わった値や、
// 確定済みの予約が参照する料金の版を書き換えないため。PR-09、21.7）。行の見分けは各テーブルの一意の項目
// （客室タイプの code、部屋の room_number、料金の版の effective_from、基本料金の版とタイプの組、祝日の date、
// 約款の version、設定の key、翻訳文の entity_type・entity_id・field・locale）で行う。
//
// 翻訳文以外は1つのトランザクションで行い、途中で失敗したら何も追加しない。翻訳文（客室タイプの名前・寝具・説明、
// 約款の本文、オプションの名称の4言語。要件 16.4）は、その後で、まだない行だけを Translator で翻訳して加える
// （外部サービスの翻訳をトランザクションの中で呼ばない。翻訳が失敗しても、もう一度実行すれば、ない行だけを作る）。
// 既にある翻訳文は、原文が変わっていても、スタッフが直していても（is_edited）書き換えない。
//
// スタッフのアカウントは、パスワードのハッシュ化ができた後のタスク（4.1）で加える。
import type { Translator } from '../../src/integrations/translation/translator.port.js';
import {
  bookingOptionSources,
  roomTypeSources,
  termsDocumentSource,
} from '../../src/modules/content/translatable-content.js';
import { TranslationService } from '../../src/modules/content/translation.service.js';
import type { PrismaClient } from '../../src/shared/prisma/generated/client.js';
import { loadHolidays } from './holidays.js';
import {
  buildRooms,
  HOTEL_SETTINGS,
  INITIAL_ROOM_STATUS,
  RATE_VERSION_1,
  ROOM_TYPES,
  TERMS_VERSION_1,
} from './initial-data.js';

export interface SeedOptions {
  /** 部屋の状態を設定した日時（rooms.status_changed_at）に使う現在の日時 */
  now: Date;
  /** 翻訳文を作る翻訳（pnpm db:seed は待ち受け口と同じ実装。integrations.module.ts の scriptTranslator） */
  translator: Translator;
}

/** テーブルごとの、この投入で追加した行の数 */
export interface SeedSummary {
  roomTypes: number;
  rooms: number;
  rateVersions: number;
  roomTypePrices: number;
  holidays: number;
  termsDocuments: number;
  hotelSettings: number;
  translations: number;
}

/** 初期データのうち、まだない行を追加する */
export async function seedInitialData(
  prisma: PrismaClient,
  options: SeedOptions,
): Promise<SeedSummary> {
  // ファイルの読み込みと検算は、トランザクションの前に済ませる
  const rooms = buildRooms();
  const holidays = loadHolidays();

  const summary = await prisma.$transaction(
    async (tx) => {
      const roomTypes = await tx.roomType.createMany({
        data: ROOM_TYPES.map((type, index) => ({
          code: type.code,
          nameJa: type.nameJa,
          areaSqm: type.areaSqm,
          bedDescriptionJa: type.bedDescriptionJa,
          capacityAdults: type.capacityAdults,
          standardOccupancy: type.standardOccupancy,
          displayOrder: index + 1,
          descriptionJa: type.descriptionJa,
        })),
        skipDuplicates: true,
      });
      const typeIdByCode = new Map(
        (
          await tx.roomType.findMany({
            where: { code: { in: ROOM_TYPES.map((type) => type.code) } },
            select: { id: true, code: true },
          })
        ).map((type) => [type.code, type.id]),
      );
      const typeId = (code: string): string => {
        const id = typeIdByCode.get(code);
        if (id === undefined) throw new Error(`客室タイプ ${code} が見つかりません`);
        return id;
      };

      const createdRooms = await tx.room.createMany({
        data: rooms.map((room) => ({
          roomNumber: room.roomNumber,
          floor: room.floor,
          roomTypeId: typeId(room.roomTypeCode),
          isAccessible: room.isAccessible,
          status: INITIAL_ROOM_STATUS,
          statusChangedAt: options.now,
        })),
        skipDuplicates: true,
      });

      const rateVersions = await tx.rateVersion.createMany({
        data: [RATE_VERSION_1],
        skipDuplicates: true,
      });
      const rateVersion = await tx.rateVersion.findUniqueOrThrow({
        where: { effectiveFrom: RATE_VERSION_1.effectiveFrom },
        select: { id: true },
      });
      const roomTypePrices = await tx.roomTypePrice.createMany({
        data: ROOM_TYPES.map((type) => ({
          rateVersionId: rateVersion.id,
          roomTypeId: typeId(type.code),
          basePriceExcl: type.basePriceExcl,
        })),
        skipDuplicates: true,
      });

      const createdHolidays = await tx.holiday.createMany({
        data: holidays.map((holiday) => ({
          date: new Date(`${holiday.date}T00:00:00Z`),
          name: holiday.name,
        })),
        skipDuplicates: true,
      });

      const termsDocuments = await tx.termsDocument.createMany({
        data: [TERMS_VERSION_1],
        skipDuplicates: true,
      });

      const hotelSettings = await tx.hotelSetting.createMany({
        data: [...HOTEL_SETTINGS],
        skipDuplicates: true,
      });

      return {
        roomTypes: roomTypes.count,
        rooms: createdRooms.count,
        rateVersions: rateVersions.count,
        roomTypePrices: roomTypePrices.count,
        holidays: createdHolidays.count,
        termsDocuments: termsDocuments.count,
        hotelSettings: hotelSettings.count,
      };
    },
    { isolationLevel: 'ReadCommitted', maxWait: 10_000, timeout: 60_000 },
  );

  const translations = await seedTranslations(prisma, options.translator);
  return { ...summary, translations };
}

/**
 * 初期データの客室タイプ・宿泊約款・オプションの名称の、まだない翻訳文（日本語以外の4言語）を加え、加えた行の数を返す。
 * 原文はデータベースの今の値（運用で変えた説明なども、その文を翻訳する）。
 */
async function seedTranslations(prisma: PrismaClient, translator: Translator): Promise<number> {
  const roomTypes = await prisma.roomType.findMany({
    where: { code: { in: ROOM_TYPES.map((type) => type.code) } },
    orderBy: { displayOrder: 'asc' },
    select: { id: true, nameJa: true, bedDescriptionJa: true, descriptionJa: true },
  });
  const terms = await prisma.termsDocument.findUniqueOrThrow({
    where: { version: TERMS_VERSION_1.version },
    select: { id: true, bodyJa: true },
  });
  const sources = [
    ...roomTypes.flatMap((type) => Object.values(roomTypeSources(type))),
    termsDocumentSource(terms),
    ...bookingOptionSources().map((option) => option.source),
  ];
  return new TranslationService(translator).createMissing(prisma, sources);
}
