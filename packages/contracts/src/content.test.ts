import { describe, expect, it } from 'vitest';
import {
  BOOKING_OPTIONS,
  RoomTypeListResponseSchema,
  TermsDocumentResponseSchema,
  type RoomTypeListResponse,
  type TermsDocumentResponse,
} from './content.js';

const ROOM_TYPES_RESPONSE: RoomTypeListResponse = {
  locale: 'en',
  roomTypes: [
    {
      id: '6f1c2a7e-5b8d-4c3e-9a1f-2d4b6c8e0a13',
      code: 'STANDARD_KING',
      name: '[en] スタンダード キング',
      areaSqm: 32,
      bedDescription: '[en] キング＋ソファーベッド',
      capacityAdults: 3,
      description: '[en] 32㎡の客室です。',
    },
  ],
  options: [
    { code: 'BREAKFAST', name: '[en] 朝食' },
    { code: 'EARLY_CHECKIN', name: '[en] アーリーチェックイン' },
    { code: 'LATE_CHECKOUT', name: '[en] レイトチェックアウト' },
  ],
};

const TERMS_RESPONSE: TermsDocumentResponse = {
  locale: 'ko',
  version: 1,
  publishedAt: '2025-12-31T15:00:00.000Z',
  body: '[ko] 宿泊約款（仮）',
};

describe('客室タイプ・オプション・宿泊約款の内容（GET /room-types・GET /terms/current の応答）', () => {
  it('[4.10][16.4] 名称を翻訳するオプションは、朝食・アーリーチェックイン・レイトチェックアウトの3つ', () => {
    expect(BOOKING_OPTIONS).toEqual(['BREAKFAST', 'EARLY_CHECKIN', 'LATE_CHECKOUT']);
  });

  it('[16.4] GET /room-types の応答の形（要求の言語・客室タイプ・オプション）を検証できる', () => {
    expect(RoomTypeListResponseSchema.parse(ROOM_TYPES_RESPONSE)).toEqual(ROOM_TYPES_RESPONSE);
    expect(
      RoomTypeListResponseSchema.safeParse({ ...ROOM_TYPES_RESPONSE, locale: 'fr' }).success,
    ).toBe(false);
    expect(
      RoomTypeListResponseSchema.safeParse({
        ...ROOM_TYPES_RESPONSE,
        options: [{ code: 'PARKING', name: 'Parking' }],
      }).success,
    ).toBe(false);
  });

  it('[4.14][16.4] GET /terms/current の応答の形（要求の言語・版・公開の日時・本文）を検証できる', () => {
    expect(TermsDocumentResponseSchema.parse(TERMS_RESPONSE)).toEqual(TERMS_RESPONSE);
    expect(TermsDocumentResponseSchema.safeParse({ ...TERMS_RESPONSE, version: 0 }).success).toBe(
      false,
    );
    expect(
      TermsDocumentResponseSchema.safeParse({ ...TERMS_RESPONSE, publishedAt: '2026-01-01' })
        .success,
    ).toBe(false);
  });
});
