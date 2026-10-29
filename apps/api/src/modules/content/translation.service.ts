// 翻訳文の取得と保存（design.md File Structure Plan の content/translation.service、Data Models translations。要件 16.4・21.5）。
//
// ホテル側が日本語で入力した文章（客室タイプの名前・寝具・説明、オプションの名称、宿泊約款）を、宿泊客の言語で返す。
// 翻訳は Translator（外部サービスのインターフェース）で行い、結果を translations に保存する。表示のたびには翻訳しない。
//
// 文の決め方（日本語以外の言語）：
//   1. 保存した翻訳文が使えれば、それを返す。使えるのは、スタッフが直した文（is_edited）か、今の原文から作った
//      機械翻訳の文（source_hash が今の原文の指紋と同じ）
//   2. 翻訳文がない、または原文が変わった後の機械翻訳の文なら、翻訳サービスで翻訳し、保存して返す
//      - スタッフが直した文は、原文が変わっても上書きしない（そのまま 1. で使う。原文の変更に合わせて作り直すのは
//        後のフェーズの管理者画面の担当。要件 21.6）
//      - 翻訳サービスが失敗したら、その文は日本語の原文で返し、何も保存しない（表示を止めない。次の要求で翻訳し直す）
//   3. translate: false（トランザクションの中など、外部サービスを呼ばない場面）では、2. の代わりに日本語の原文を返す
// 日本語では、データベースを読まずに原文を返す。
import { createHash } from 'node:crypto';
import type { Locale } from '@hotel/contracts';
import { Injectable, Logger } from '@nestjs/common';
import {
  TRANSLATION_LOCALES,
  Translator,
  type TranslationLocale,
} from '../../integrations/translation/translator.port.js';
import type { TransactionClient } from '../../shared/prisma/transaction.js';

/** 翻訳する文章の種類（translations.entity_type） */
export const TRANSLATION_ENTITY_TYPES = ['ROOM_TYPE', 'TERMS_DOCUMENT', 'BOOKING_OPTION'] as const;
export type TranslationEntityType = (typeof TRANSLATION_ENTITY_TYPES)[number];

/** 翻訳する1つの文章（どの行のどの項目か、と日本語の原文） */
export interface TranslationSource {
  entityType: TranslationEntityType;
  /** 行の ID（オプションはコード） */
  entityId: string;
  /** 項目の名前（translations.field） */
  field: string;
  /** 日本語の原文 */
  textJa: string;
}

/** データベースの接続（PrismaService またはトランザクションの中のクライアント） */
export type ContentDb = TransactionClient;

export interface LocalizeOptions {
  /**
   * 使える翻訳文がないとき、翻訳サービスで翻訳して保存するか（省略時は true）。
   * トランザクションの中では false にする（外部サービスを呼ばない。shared/prisma/transaction.ts）。false なら日本語の原文を返す
   */
  translate?: boolean;
}

/** 日本語の原文の指紋（SHA-256 の16進）。翻訳文を作ったときの原文と、今の原文が同じかを見分ける（translations.source_hash） */
export function sourceHashOf(textJa: string): string {
  return createHash('sha256').update(textJa, 'utf8').digest('hex');
}

/**
 * 保存した翻訳文をそのまま使えるか。スタッフが直した文は、原文が変わっていても使う（上書きしない）。
 * 機械翻訳の文は、今の原文から作ったものだけを使う。
 */
export function isUsableTranslation(
  row: { sourceHash: string; isEdited: boolean },
  textJa: string,
): boolean {
  return row.isEdited || row.sourceHash === sourceHashOf(textJa);
}

interface StoredTranslation {
  id: string;
  entityType: string;
  entityId: string;
  field: string;
  text: string;
  sourceHash: string;
  isEdited: boolean;
}

const STORED_COLUMNS = {
  id: true,
  entityType: true,
  entityId: true,
  field: true,
  text: true,
  sourceHash: true,
  isEdited: true,
} as const;

function keyOf(row: { entityType: string; entityId: string; field: string }): string {
  return JSON.stringify([row.entityType, row.entityId, row.field]);
}

function uniqueKey(source: TranslationSource, locale: TranslationLocale) {
  return {
    entityType_entityId_field_locale: {
      entityType: source.entityType,
      entityId: source.entityId,
      field: source.field,
      locale,
    },
  };
}

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);

  constructor(private readonly translator: Translator) {}

  /**
   * 文章を指定した言語の文にして、sources と同じ順に返す（文の決め方はファイルの先頭のコメント）。
   * 使える翻訳文がなければ翻訳して保存するので、トランザクションの中では options.translate を false にする。
   */
  async localize(
    db: ContentDb,
    sources: readonly TranslationSource[],
    locale: Locale,
    options: LocalizeOptions = {},
  ): Promise<string[]> {
    if (locale === 'ja' || sources.length === 0) return sources.map((source) => source.textJa);
    const stored = await this.findStored(db, sources, locale);
    return Promise.all(
      sources.map(async (source) => {
        const row = stored.get(keyOf(source));
        if (row && isUsableTranslation(row, source.textJa)) return row.text;
        if (options.translate === false) return source.textJa;
        return this.translateAndSave(db, source, locale, row);
      }),
    );
  }

  /**
   * まだない翻訳文（文章×言語）だけを翻訳して保存し、加えた行の数を返す（初期データの投入。tasks.md 1.5）。
   * 既にある行は、原文が変わっていても、スタッフが直していても書き換えない。翻訳サービスの失敗はそのまま投げる
   * （何も保存しない。もう一度実行すれば、ない行だけを作り直す）。
   */
  async createMissing(
    db: ContentDb,
    sources: readonly TranslationSource[],
    locales: readonly TranslationLocale[] = TRANSLATION_LOCALES,
  ): Promise<number> {
    if (sources.length === 0 || locales.length === 0) return 0;
    const existing = new Set(
      (
        await db.translation.findMany({
          where: this.whereSources(sources, { in: [...locales] }),
          select: { entityType: true, entityId: true, field: true, locale: true },
        })
      ).map((row) => JSON.stringify([keyOf(row), row.locale])),
    );
    const missing = sources.flatMap((source) =>
      locales
        .filter((locale) => !existing.has(JSON.stringify([keyOf(source), locale])))
        .map((locale) => ({ source, locale })),
    );
    if (missing.length === 0) return 0;

    const data = await Promise.all(
      missing.map(async ({ source, locale }) => ({
        entityType: source.entityType,
        entityId: source.entityId,
        field: source.field,
        locale,
        text: await this.translator.translate(source.textJa, locale),
        sourceHash: sourceHashOf(source.textJa),
        isEdited: false,
      })),
    );
    // 同時に別の処理が作った行は飛ばす（既にある行は変えない）
    const created = await db.translation.createMany({ data, skipDuplicates: true });
    return created.count;
  }

  private async findStored(
    db: ContentDb,
    sources: readonly TranslationSource[],
    locale: TranslationLocale,
  ): Promise<Map<string, StoredTranslation>> {
    const rows = await db.translation.findMany({
      where: this.whereSources(sources, locale),
      select: STORED_COLUMNS,
    });
    return new Map(rows.map((row) => [keyOf(row), row]));
  }

  /** 文章の行（種類と ID）と言語で絞り込む条件。項目は呼び出し側で突き合わせる */
  private whereSources(sources: readonly TranslationSource[], locale: string | { in: string[] }) {
    return {
      locale,
      entityType: { in: [...new Set(sources.map((source) => source.entityType))] },
      entityId: { in: [...new Set(sources.map((source) => source.entityId))] },
    };
  }

  /** 今の原文を翻訳して保存し、その文を返す。row は保存されている（使えない）翻訳文 */
  private async translateAndSave(
    db: ContentDb,
    source: TranslationSource,
    locale: TranslationLocale,
    row: StoredTranslation | undefined,
  ): Promise<string> {
    let text: string;
    try {
      text = await this.translator.translate(source.textJa, locale);
    } catch (error) {
      // 原文・翻訳文は書かない（エラーの名前だけ）
      this.logger.warn(
        `翻訳できなかったため日本語の原文を返します（${source.entityType}.${source.field}、${locale}：${error instanceof Error ? error.name : 'unknown'}）`,
      );
      return source.textJa;
    }
    const sourceHash = sourceHashOf(source.textJa);
    const saved = row
      ? // 機械翻訳の文だけを書き換える（読んだ後にスタッフが直した、または別の要求が作り直した行は変えない）
        await db.translation.updateMany({
          where: { id: row.id, isEdited: false, sourceHash: row.sourceHash },
          data: { text, sourceHash },
        })
      : await db.translation.createMany({
          data: [
            {
              ...uniqueKey(source, locale).entityType_entityId_field_locale,
              text,
              sourceHash,
              isEdited: false,
            },
          ],
          skipDuplicates: true,
        });
    if (saved.count === 1) return text;

    // 同時に別の要求が保存した（またはスタッフが直した）行があれば、使えるならそれを返す
    const current = await db.translation.findUnique({
      where: uniqueKey(source, locale),
      select: STORED_COLUMNS,
    });
    return current && isUsableTranslation(current, source.textJa) ? current.text : text;
  }
}
