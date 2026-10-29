// 言語ごとのメールの文面（catalog/{言語}.ts）の形。
// 各言語のファイルは、12のテンプレートすべての文面を持つ（型で抜けを防ぐ。要件 16.2、TC-MB-232）。
import type { HotelProfileText } from '../hotel-profile.js';
import type { MailFormat } from '../mail-format.js';
import type { GuestLinks } from '../mail-links.js';
import type { MailPayload, MailTemplate } from '../mail-templates.js';

/** 文面を作るときに使えるもの */
export interface TemplateContext {
  /** 金額・日付・時刻の書き方（その言語） */
  readonly f: MailFormat;
  /** ホテルの名称・所在地・アクセス（その言語） */
  readonly hotel: HotelProfileText;
  /** 宿泊客アプリのリンク */
  readonly links: GuestLinks;
}

/** 1通の文面（本文は行の並び。renderMail が署名を付けて改行でつなぐ） */
export interface MailText {
  readonly subject: string;
  readonly lines: readonly string[];
}

export type TemplateRenderer<T extends MailTemplate> = (
  payload: MailPayload<T>,
  ctx: TemplateContext,
) => MailText;

export interface MailCatalog {
  readonly templates: { readonly [T in MailTemplate]: TemplateRenderer<T> };
  /** すべてのメールの末尾に付ける署名（ホテルの名称・所在地・サイト） */
  signature(ctx: TemplateContext): readonly string[];
}

/** 0 でない行だけを残す補助：条件が偽なら空の配列 */
export function lineIf(condition: boolean, ...lines: string[]): string[] {
  return condition ? lines : [];
}

/**
 * 対応表の訳。対応表にない値はそのまま返す。
 * 対応表は普通のオブジェクトなので、自分の項目だけを見る（「constructor」などの既定のプロパティを訳に使わない）
 */
export function translated(labels: Readonly<Record<string, string>>, value: string): string {
  return Object.hasOwn(labels, value) ? (labels[value] ?? value) : value;
}
