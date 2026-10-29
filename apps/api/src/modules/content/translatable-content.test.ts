import { BOOKING_OPTIONS } from '@hotel/contracts';
import { describe, expect, it } from 'vitest';
import {
  BOOKING_OPTION_NAMES_JA,
  bookingOptionSources,
  roomTypeSources,
  termsDocumentSource,
} from './translatable-content.js';

const ROOM_TYPE = {
  id: '6f1c2a7e-5b8d-4c3e-9a1f-2d4b6c8e0a13',
  nameJa: 'スタンダード キング',
  bedDescriptionJa: 'キング＋ソファーベッド',
  descriptionJa: '32㎡の客室です。',
};

describe('翻訳する文章（ホテル側が日本語で入力した文章。要件 16.4）', () => {
  it('[16.4] 客室タイプは、名前・寝具・説明の3つの項目を、客室タイプの ID ごとに翻訳する', () => {
    expect(roomTypeSources(ROOM_TYPE)).toEqual({
      name: {
        entityType: 'ROOM_TYPE',
        entityId: ROOM_TYPE.id,
        field: 'name',
        textJa: 'スタンダード キング',
      },
      bedDescription: {
        entityType: 'ROOM_TYPE',
        entityId: ROOM_TYPE.id,
        field: 'bed_description',
        textJa: 'キング＋ソファーベッド',
      },
      description: {
        entityType: 'ROOM_TYPE',
        entityId: ROOM_TYPE.id,
        field: 'description',
        textJa: '32㎡の客室です。',
      },
    });
  });

  it('[4.14][16.4] 宿泊約款は、版の行（terms_documents の ID）ごとに本文を翻訳する', () => {
    expect(termsDocumentSource({ id: 'terms-id', bodyJa: '第1条' })).toEqual({
      entityType: 'TERMS_DOCUMENT',
      entityId: 'terms-id',
      field: 'body',
      textJa: '第1条',
    });
  });

  it('[4.10][16.4] オプション（朝食・アーリーチェックイン・レイトチェックアウト）の名称は、オプションのコードごとに翻訳する', () => {
    expect(BOOKING_OPTION_NAMES_JA).toEqual({
      BREAKFAST: '朝食',
      EARLY_CHECKIN: 'アーリーチェックイン',
      LATE_CHECKOUT: 'レイトチェックアウト',
    });
    expect(bookingOptionSources()).toEqual(
      BOOKING_OPTIONS.map((code) => ({
        code,
        source: {
          entityType: 'BOOKING_OPTION',
          entityId: code,
          field: 'name',
          textJa: BOOKING_OPTION_NAMES_JA[code],
        },
      })),
    );
  });
});
