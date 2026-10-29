// 客室タイプ・オプション・宿泊約款の内容（公開用 API の GET /room-types・GET /terms/current の応答。
// design.md「公開用 API」、要件 4.14・16.4）。
// ホテル側が日本語で入力した文章（客室タイプの名前・寝具・説明、オプションの名称、宿泊約款）は、要求の言語が
// 日本語なら原文、ほかの言語なら機械翻訳の文（スタッフが直した場合は直した文）で返す。
import { z } from 'zod';
import { LocaleSchema, type Locale } from './enums.js';

/** 予約のオプション（朝食・アーリーチェックイン・レイトチェックアウト。要件 4.10）。名称はホテルが日本語で決め、翻訳して表示する */
export const BOOKING_OPTIONS = ['BREAKFAST', 'EARLY_CHECKIN', 'LATE_CHECKOUT'] as const;
export type BookingOption = (typeof BOOKING_OPTIONS)[number];
export const BookingOptionSchema = z.enum(BOOKING_OPTIONS);

/** 客室タイプの内容（G02・G09 の表示。name・bedDescription・description は要求の言語の文） */
export interface RoomTypeContent {
  id: string;
  /** 客室タイプのコード（STANDARD_KING など。言語によらない） */
  code: string;
  name: string;
  /** 広さ（㎡） */
  areaSqm: number;
  /** 寝具 */
  bedDescription: string;
  /** 定員（大人） */
  capacityAdults: number;
  /** 説明 */
  description: string;
}
export const RoomTypeContentSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  name: z.string(),
  areaSqm: z.number().int().positive(),
  bedDescription: z.string(),
  capacityAdults: z.number().int().positive(),
  description: z.string(),
}) satisfies z.ZodType<RoomTypeContent>;

/** オプションの名称（要求の言語の文） */
export interface BookingOptionContent {
  code: BookingOption;
  name: string;
}
export const BookingOptionContentSchema = z.object({
  code: BookingOptionSchema,
  name: z.string(),
}) satisfies z.ZodType<BookingOptionContent>;

/** GET /room-types の応答（客室タイプは表示の順、オプションは BOOKING_OPTIONS の順） */
export interface RoomTypeListResponse {
  /** 文の言語 */
  locale: Locale;
  roomTypes: RoomTypeContent[];
  options: BookingOptionContent[];
}
export const RoomTypeListResponseSchema = z.object({
  locale: LocaleSchema,
  roomTypes: z.array(RoomTypeContentSchema),
  options: z.array(BookingOptionContentSchema),
}) satisfies z.ZodType<RoomTypeListResponse>;

/** GET /terms/current の応答（今の版の宿泊約款。キャンセル規定と団体の扱いを含む全文） */
export interface TermsDocumentResponse {
  /** 文の言語 */
  locale: Locale;
  /** 版（予約の確保のときに同意した版として記録する） */
  version: number;
  /** 公開の日時（ISO 8601） */
  publishedAt: string;
  /** 本文 */
  body: string;
}
export const TermsDocumentResponseSchema = z.object({
  locale: LocaleSchema,
  version: z.number().int().positive(),
  publishedAt: z.iso.datetime({ offset: true }),
  body: z.string(),
}) satisfies z.ZodType<TermsDocumentResponse>;
