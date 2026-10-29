// 翻訳する文章（ホテル側が日本語で入力した文章。要件 16.4）と、translations の行の見分け方
// （entity_type・entity_id・field）。ContentService と初期データの投入（prisma/seed/seed.ts）が使う。
//
//   客室タイプ    ROOM_TYPE       room_types.id      name・bed_description・description（name_ja などの原文）
//   宿泊約款      TERMS_DOCUMENT  terms_documents.id body（body_ja。版ごとに別の行）
//   オプション    BOOKING_OPTION  オプションのコード  name（BOOKING_OPTION_NAMES_JA）
//
// 宿泊客の入力（氏名・住所など）は翻訳しない（要件 16.5）。
import { BOOKING_OPTIONS, type BookingOption } from '@hotel/contracts';
import type { TranslationSource } from './translation.service.js';

/**
 * オプションの名称（日本語の原文）。オプションの表はないので、ここで決める（design.md「初期データ」の「朝食などの名称」）。
 * 名称を変えたら、保存した機械翻訳の文は次の表示のときに翻訳し直される（スタッフが直した文は変えない）。
 */
export const BOOKING_OPTION_NAMES_JA: Readonly<Record<BookingOption, string>> = {
  BREAKFAST: '朝食',
  EARLY_CHECKIN: 'アーリーチェックイン',
  LATE_CHECKOUT: 'レイトチェックアウト',
};

/** 客室タイプの、翻訳する項目 */
export interface RoomTypeSources {
  name: TranslationSource;
  bedDescription: TranslationSource;
  description: TranslationSource;
}

/** 客室タイプの名前・寝具・説明 */
export function roomTypeSources(type: {
  id: string;
  nameJa: string;
  bedDescriptionJa: string;
  descriptionJa: string;
}): RoomTypeSources {
  const source = (field: string, textJa: string): TranslationSource => ({
    entityType: 'ROOM_TYPE',
    entityId: type.id,
    field,
    textJa,
  });
  return {
    name: source('name', type.nameJa),
    bedDescription: source('bed_description', type.bedDescriptionJa),
    description: source('description', type.descriptionJa),
  };
}

/** 宿泊約款の本文（版の行ごと） */
export function termsDocumentSource(document: { id: string; bodyJa: string }): TranslationSource {
  return {
    entityType: 'TERMS_DOCUMENT',
    entityId: document.id,
    field: 'body',
    textJa: document.bodyJa,
  };
}

/** オプションの名称（BOOKING_OPTIONS の順） */
export function bookingOptionSources(): { code: BookingOption; source: TranslationSource }[] {
  return BOOKING_OPTIONS.map((code) => ({
    code,
    source: {
      entityType: 'BOOKING_OPTION',
      entityId: code,
      field: 'name',
      textJa: BOOKING_OPTION_NAMES_JA[code],
    },
  }));
}
