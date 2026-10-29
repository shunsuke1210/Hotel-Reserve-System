// 客室タイプ・オプション・宿泊約款の内容と翻訳文（公開用 API の GET /room-types・GET /terms/current、tasks.md 3.5）を、
// 初期データを投入したテスト用のデータベースで確かめる。
// 完了状態：言語を指定して客室タイプの一覧と宿泊約款を取得すると、その言語の翻訳文が返る。
//
// 期待する翻訳文は、模擬の翻訳の形（design.md「模擬の翻訳：`[en] 原文`」）と、データベースの日本語の原文から作る。
import { createHash } from 'node:crypto';
import {
  LOCALES,
  RoomTypeListResponseSchema,
  TermsDocumentResponseSchema,
  type Locale,
} from '@hotel/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedInitialData } from '../../../prisma/seed/seed.js';
import { TestTranslator } from '../../integrations/testing/test-translator.js';
import { Translator } from '../../integrations/translation/translator.port.js';
import { FixedBusinessClock } from '../../shared/clock/business-clock.js';
import { errorMessage } from '../../shared/errors/error-messages.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { runInTransaction } from '../../shared/prisma/transaction.js';
import { insertMember } from '../../test/auth/fixtures.js';
import { signIn } from '../../test/auth/sessions.js';
import { createTestDatabase, type TestDatabase } from '../../test/database/test-database.js';
import { createTestListenerApp } from '../../test/listener-app.js';
import { ContentService } from './content.service.js';

const NOW = '2026-11-10T10:00:00+09:00';

/** brief.md FC-04 の客室タイプの表示の順（初期データのコード。tasks.md Implementation Notes 1.5） */
const ROOM_TYPE_CODES = [
  'STANDARD_KING',
  'STANDARD_TWIN',
  'DELUXE_KING',
  'DELUXE_TWIN',
  'PREMIUM_KING',
  'SUITE',
  'KANAZAWA_SUITE',
];

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** 模擬の翻訳の結果（日本語は原文のまま） */
const inLocale = (locale: Locale, textJa: string): string =>
  locale === 'ja' ? textJa : `[${locale}] ${textJa}`;

interface Fixture {
  db: TestDatabase;
  owner: PrismaService;
  guest: INestApplication;
  translator: TestTranslator;
  clock: FixedBusinessClock;
}

/** 初期データ（翻訳文を含む）を投入したデータベースと、公開用の待ち受け口を作る */
async function setUp(): Promise<Fixture> {
  const db = await createTestDatabase();
  const owner = new PrismaService(db.ownerUrl);
  await seedInitialData(owner, { now: new Date(NOW), translator: new TestTranslator() });
  const translator = new TestTranslator();
  const clock = new FixedBusinessClock(NOW);
  const guest = await createTestListenerApp('guest', {
    prisma: db.prisma,
    clock,
    overrides: [{ provide: Translator, useValue: translator }],
  });
  return { db, owner, guest, translator, clock };
}

async function tearDown(fixture: Fixture | undefined): Promise<void> {
  await fixture?.guest.close();
  await fixture?.owner.$disconnect();
  await fixture?.db.drop();
}

function getRoomTypes(fixture: Fixture, lang?: string) {
  return request(fixture.guest.getHttpServer())
    .get('/api/guest/room-types')
    .query(lang === undefined ? {} : { lang });
}

function getTerms(fixture: Fixture, lang?: string) {
  return request(fixture.guest.getHttpServer())
    .get('/api/guest/terms/current')
    .query(lang === undefined ? {} : { lang });
}

function translationKey(entityType: string, entityId: string, field: string, locale: Locale) {
  return { entityType_entityId_field_locale: { entityType, entityId, field, locale } };
}

describe('保存済みの翻訳文の表示（GET /room-types・GET /terms/current）', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await setUp();
  });
  afterAll(async () => {
    await tearDown(f);
  });
  beforeEach(() => {
    f.translator.reset();
  });

  it('[16.4] TC-MB-291：English では、客室タイプの名前・寝具・説明が en の翻訳文（[en] 原文）で、表示の順に7タイプ返る', async () => {
    const response = await getRoomTypes(f, 'en').expect(200);
    const body = RoomTypeListResponseSchema.parse(response.body);
    expect(body.locale).toBe('en');
    expect(body.roomTypes.map((type) => type.code)).toEqual(ROOM_TYPE_CODES);

    const sk = await f.db.prisma.roomType.findUniqueOrThrow({ where: { code: 'STANDARD_KING' } });
    expect(body.roomTypes[0]).toEqual({
      id: sk.id,
      code: 'STANDARD_KING',
      name: `[en] ${sk.nameJa}`,
      areaSqm: 32,
      bedDescription: `[en] ${sk.bedDescriptionJa}`,
      capacityAdults: 3,
      description: `[en] ${sk.descriptionJa}`,
    });
    // 保存した翻訳文を使い、表示のたびには翻訳しない
    expect(f.translator.calls).toEqual([]);
  });

  it('[16.4] TC-MB-293：日本語では、客室タイプの説明とオプションの名称が日本語の原文', async () => {
    const response = await getRoomTypes(f, 'ja').expect(200);
    const types = await f.db.prisma.roomType.findMany({ orderBy: { displayOrder: 'asc' } });
    expect(response.body.roomTypes).toEqual(
      types.map((type) => ({
        id: type.id,
        code: type.code,
        name: type.nameJa,
        areaSqm: type.areaSqm,
        bedDescription: type.bedDescriptionJa,
        capacityAdults: type.capacityAdults,
        description: type.descriptionJa,
      })),
    );
    expect(response.body.options).toEqual([
      { code: 'BREAKFAST', name: '朝食' },
      { code: 'EARLY_CHECKIN', name: 'アーリーチェックイン' },
      { code: 'LATE_CHECKOUT', name: 'レイトチェックアウト' },
    ]);
    expect(f.translator.calls).toEqual([]);
  });

  it('[16.4] TC-MB-295：简体中文 では、オプションの朝食の名称が zh-Hans の翻訳文', async () => {
    const response = await getRoomTypes(f, 'zh-Hans').expect(200);
    expect(response.body.options).toEqual([
      { code: 'BREAKFAST', name: '[zh-Hans] 朝食' },
      { code: 'EARLY_CHECKIN', name: '[zh-Hans] アーリーチェックイン' },
      { code: 'LATE_CHECKOUT', name: '[zh-Hans] レイトチェックアウト' },
    ]);
  });

  it('[4.14][16.4] TC-MB-294・TC-RS-105：한국어 では、今の版の宿泊約款の全文が ko の翻訳文', async () => {
    const response = await getTerms(f, 'ko').expect(200);
    const terms = await f.db.prisma.termsDocument.findUniqueOrThrow({ where: { version: 1 } });
    expect(TermsDocumentResponseSchema.parse(response.body)).toEqual({
      locale: 'ko',
      version: 1,
      publishedAt: terms.publishedAt.toISOString(),
      body: `[ko] ${terms.bodyJa}`,
    });
    expect(f.translator.calls).toEqual([]);
  });

  it.each(LOCALES)(
    '[16.1][16.4] %s では、全タイプの名前・寝具・説明、オプションの名称、宿泊約款がその言語の文',
    async (locale) => {
      const roomTypes = (await getRoomTypes(f, locale).expect(200)).body;
      const types = await f.db.prisma.roomType.findMany({ orderBy: { displayOrder: 'asc' } });
      expect(roomTypes.locale).toBe(locale);
      expect(
        roomTypes.roomTypes.map((type: { name: string; bedDescription: string }) => [
          type.name,
          type.bedDescription,
        ]),
      ).toEqual(
        types.map((type) => [
          inLocale(locale, type.nameJa),
          inLocale(locale, type.bedDescriptionJa),
        ]),
      );
      expect(roomTypes.roomTypes.map((type: { description: string }) => type.description)).toEqual(
        types.map((type) => inLocale(locale, type.descriptionJa)),
      );
      expect(roomTypes.options.map((option: { name: string }) => option.name)).toEqual(
        ['朝食', 'アーリーチェックイン', 'レイトチェックアウト'].map((name) =>
          inLocale(locale, name),
        ),
      );

      const terms = (await getTerms(f, locale).expect(200)).body;
      const document = await f.db.prisma.termsDocument.findUniqueOrThrow({ where: { version: 1 } });
      expect(terms).toMatchObject({ locale, version: 1, body: inLocale(locale, document.bodyJa) });
      expect(f.translator.calls).toEqual([]);
    },
  );

  it('[16.4][21.5] TC-MB-292：スタッフが直した en の翻訳文（is_edited）があれば、直した文を表示する', async () => {
    const sk = await f.db.prisma.roomType.findUniqueOrThrow({ where: { code: 'STANDARD_KING' } });
    const key = translationKey('ROOM_TYPE', sk.id, 'description', 'en');
    const original = await f.db.prisma.translation.findUniqueOrThrow({ where: key });
    await f.db.prisma.translation.update({
      where: key,
      data: { text: 'Edited description', isEdited: true },
    });
    try {
      const english = (await getRoomTypes(f, 'en').expect(200)).body;
      expect(english.roomTypes[0].description).toBe('Edited description');
      // ほかの言語は機械翻訳のまま
      const korean = (await getRoomTypes(f, 'ko').expect(200)).body;
      expect(korean.roomTypes[0].description).toBe(`[ko] ${sk.descriptionJa}`);
      expect(f.translator.calls).toEqual([]);
    } finally {
      await f.db.prisma.translation.update({
        where: key,
        data: { text: original.text, isEdited: false },
      });
    }
  });

  it('[16.4] lang がなければ、ログイン中の会員の言語（preferred_locale）の文を返す（L-11）', async () => {
    const memberId = await insertMember(f.db.prisma, {
      email: 'zh-hant@example.com',
      phone: '09011112222',
      passwordHash: 'x',
      preferredLocale: 'zh-Hant',
    });
    const cookie = await signIn(f.guest, 'MEMBER', memberId);
    const response = await request(f.guest.getHttpServer())
      .get('/api/guest/terms/current')
      .set('Cookie', cookie)
      .set('Accept-Language', 'ko')
      .expect(200);
    expect(response.body.locale).toBe('zh-Hant');
    expect(response.body.body).toMatch(/^\[zh-Hant\] 宿泊約款/);

    // lang を指定すれば、会員の言語よりも lang を優先する（画面で選んだ言語）
    const english = await request(f.guest.getHttpServer())
      .get('/api/guest/terms/current?lang=en')
      .set('Cookie', cookie)
      .expect(200);
    expect(english.body.locale).toBe('en');
  });

  it('[16.1] 対応しない言語は VALIDATION_FAILED（400）', async () => {
    const response = await getRoomTypes(f, 'fr').set('Accept-Language', 'ko').expect(400);
    expect(response.body).toEqual({
      code: 'VALIDATION_FAILED',
      message: errorMessage('VALIDATION_FAILED', 'ko'),
    });
  });
});

describe('宿泊約款の今の版（GET /terms/current）', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await setUp();
  });
  afterAll(async () => {
    await tearDown(f);
  });
  beforeEach(() => {
    f.translator.reset();
    f.clock.set(NOW);
  });

  it('[4.14] TC-RS-105：公開の日時を過ぎた版のうち最も新しい版を返し、公開前の版は返さない（公開の日時ちょうどから今の版）', async () => {
    const version2 = {
      version: 2,
      bodyJa: '宿泊約款（第2版）\n第1条 チェックインは15:00からとします。',
      publishedAt: new Date('2026-12-01T00:00:00+09:00'),
    };
    await f.owner.termsDocument.create({ data: version2 });

    const before = await getTerms(f, 'ja').expect(200);
    expect(before.body.version).toBe(1);

    f.clock.set('2026-12-01T00:00:00+09:00');
    const after = await getTerms(f, 'ja').expect(200);
    expect(after.body).toEqual({
      locale: 'ja',
      version: 2,
      publishedAt: version2.publishedAt.toISOString(),
      body: version2.bodyJa,
    });
  });

  it('[16.4] 翻訳文のない版（初期データの後に加えた版）は、そのときに翻訳して保存し、次からは保存した文を使う', async () => {
    f.clock.set('2026-12-01T00:00:00+09:00');
    const document = await f.db.prisma.termsDocument.findUniqueOrThrow({ where: { version: 2 } });

    const first = await getTerms(f, 'en').expect(200);
    expect(first.body).toMatchObject({ locale: 'en', version: 2, body: `[en] ${document.bodyJa}` });
    expect(f.translator.calls).toEqual([{ textJa: document.bodyJa, to: 'en' }]);
    expect(
      await f.db.prisma.translation.findUniqueOrThrow({
        where: translationKey('TERMS_DOCUMENT', document.id, 'body', 'en'),
      }),
    ).toMatchObject({
      text: `[en] ${document.bodyJa}`,
      sourceHash: sha256(document.bodyJa),
      isEdited: false,
    });

    const second = await getTerms(f, 'en').expect(200);
    expect(second.body.body).toBe(`[en] ${document.bodyJa}`);
    expect(f.translator.calls).toHaveLength(1);
  });

  it('[4.14] 公開した版がまだなければ NOT_FOUND', async () => {
    f.clock.set('2025-12-31T23:59:59+09:00');
    const response = await getTerms(f, 'en').expect(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
});

describe('翻訳文がない・原文が変わったとき', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await setUp();
  });
  afterAll(async () => {
    await tearDown(f);
  });
  beforeEach(() => {
    f.translator.reset();
    f.translator.failWith(null);
  });

  async function roomType(code: string) {
    return f.db.prisma.roomType.findUniqueOrThrow({ where: { code } });
  }

  it('[16.4] 翻訳文がなければ、そのときに翻訳サービスで翻訳して保存する（次からは翻訳しない）', async () => {
    const st = await roomType('STANDARD_TWIN');
    const key = translationKey('ROOM_TYPE', st.id, 'name', 'ko');
    await f.db.prisma.translation.delete({ where: key });

    const response = await getRoomTypes(f, 'ko').expect(200);
    expect(response.body.roomTypes[1]).toMatchObject({
      code: 'STANDARD_TWIN',
      name: `[ko] ${st.nameJa}`,
    });
    expect(f.translator.calls).toEqual([{ textJa: st.nameJa, to: 'ko' }]);
    expect(await f.db.prisma.translation.findUniqueOrThrow({ where: key })).toMatchObject({
      text: `[ko] ${st.nameJa}`,
      sourceHash: sha256(st.nameJa),
      isEdited: false,
    });

    await getRoomTypes(f, 'ko').expect(200);
    expect(f.translator.calls).toHaveLength(1);
  });

  it('[16.4] 日本語の原文が変わったら、機械翻訳の文は翻訳し直して保存し、スタッフが直した文（is_edited）は上書きせずに使う', async () => {
    const suite = await roomType('SUITE');
    const editedKey = translationKey('ROOM_TYPE', suite.id, 'description', 'en');
    const machineKey = translationKey('ROOM_TYPE', suite.id, 'description', 'ko');
    await f.db.prisma.translation.update({
      where: editedKey,
      data: { text: 'Edited suite description', isEdited: true },
    });
    const editedBefore = await f.db.prisma.translation.findUniqueOrThrow({ where: editedKey });
    const changed = '13階の64㎡のスイートです。（説明を変更しました）';
    await f.db.prisma.roomType.update({
      where: { id: suite.id },
      data: { descriptionJa: changed },
    });

    const english = await getRoomTypes(f, 'en').expect(200);
    expect(english.body.roomTypes[5].description).toBe('Edited suite description');
    expect(await f.db.prisma.translation.findUniqueOrThrow({ where: editedKey })).toEqual(
      editedBefore,
    );
    expect(f.translator.calls).toEqual([]);

    const korean = await getRoomTypes(f, 'ko').expect(200);
    expect(korean.body.roomTypes[5].description).toBe(`[ko] ${changed}`);
    expect(f.translator.calls).toEqual([{ textJa: changed, to: 'ko' }]);
    expect(await f.db.prisma.translation.findUniqueOrThrow({ where: machineKey })).toMatchObject({
      text: `[ko] ${changed}`,
      sourceHash: sha256(changed),
      isEdited: false,
    });
  });

  it('[16.4] 翻訳サービスが失敗したら、その文は日本語の原文で返し（ほかの文は翻訳文のまま）、何も保存しない。次の要求で翻訳し直す', async () => {
    const ks = await roomType('KANAZAWA_SUITE');
    const key = translationKey('ROOM_TYPE', ks.id, 'description', 'zh-Hant');
    await f.db.prisma.translation.delete({ where: key });
    f.translator.failWith(new Error('翻訳サービスに接続できません'));

    const failed = await getRoomTypes(f, 'zh-Hant').expect(200);
    expect(failed.body.roomTypes[6]).toMatchObject({
      name: `[zh-Hant] ${ks.nameJa}`,
      description: ks.descriptionJa,
    });
    expect(await f.db.prisma.translation.findUnique({ where: key })).toBeNull();

    f.translator.failWith(null);
    const recovered = await getRoomTypes(f, 'zh-Hant').expect(200);
    expect(recovered.body.roomTypes[6].description).toBe(`[zh-Hant] ${ks.descriptionJa}`);
    expect(await f.db.prisma.translation.findUnique({ where: key })).not.toBeNull();
  });

  describe('ContentService.roomTypeName（メールなどに入れる客室タイプの名称。トランザクションの中で使う）', () => {
    it('[16.4][15.1] 会員の言語の名称を、保存した翻訳文から返し、翻訳サービスを呼ばない', async () => {
      const content = f.guest.get(ContentService);
      const dk = await roomType('DELUXE_KING');
      const names = await runInTransaction(f.db.prisma, async (tx) => ({
        ja: await content.roomTypeName(tx, dk.id, 'ja'),
        en: await content.roomTypeName(tx, dk.id, 'en'),
        zhHant: await content.roomTypeName(tx, dk.id, 'zh-Hant'),
      }));
      expect(names).toEqual({
        ja: dk.nameJa,
        en: `[en] ${dk.nameJa}`,
        zhHant: `[zh-Hant] ${dk.nameJa}`,
      });
      expect(f.translator.calls).toEqual([]);
    });

    it('[16.4] 使える翻訳文がなければ（ない・原文が変わった機械翻訳）、翻訳サービスを呼ばずに日本語の原文を返し、何も保存しない', async () => {
      const content = f.guest.get(ContentService);
      const dt = await roomType('DELUXE_TWIN');
      const missingKey = translationKey('ROOM_TYPE', dt.id, 'name', 'en');
      await f.db.prisma.translation.delete({ where: missingKey });
      const renamed = 'デラックス ツイン（改装済み）';
      await f.db.prisma.roomType.update({ where: { id: dt.id }, data: { nameJa: renamed } });

      const names = await runInTransaction(f.db.prisma, async (tx) => ({
        en: await content.roomTypeName(tx, dt.id, 'en'),
        ko: await content.roomTypeName(tx, dt.id, 'ko'),
      }));
      expect(names).toEqual({ en: renamed, ko: renamed });
      expect(f.translator.calls).toEqual([]);
      expect(await f.db.prisma.translation.findUnique({ where: missingKey })).toBeNull();
      expect(
        await f.db.prisma.translation.findUniqueOrThrow({
          where: translationKey('ROOM_TYPE', dt.id, 'name', 'ko'),
        }),
      ).toMatchObject({ text: `[ko] デラックス ツイン`, sourceHash: sha256('デラックス ツイン') });
    });
  });
});

describe('翻訳している間の同時の要求と編集（翻訳文の保存の衝突）', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await setUp();
    // 同時の要求を同じサーバーに送るため、先に空いているポートで待ち受ける
    await f.guest.listen(0);
  });
  afterAll(async () => {
    await tearDown(f);
  });
  beforeEach(() => {
    f.translator.reset();
    f.translator.onTranslate(null);
  });

  async function roomType(code: string) {
    return f.db.prisma.roomType.findUniqueOrThrow({ where: { code } });
  }

  it('[16.4] 翻訳文のない約款を5つの要求が同時に表示しても、すべて 200 で同じ翻訳文を返し、翻訳文の行は1つだけ', async () => {
    const CONCURRENCY = 5;
    const terms = await f.db.prisma.termsDocument.findUniqueOrThrow({ where: { version: 1 } });
    const key = translationKey('TERMS_DOCUMENT', terms.id, 'body', 'en');
    await f.db.prisma.translation.delete({ where: key });

    // 5つの要求がすべて「翻訳文がない」と読んで翻訳を始めてから、そろって保存に進むように待ち合わせる
    let release!: () => void;
    const allTranslating = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fallback = setTimeout(() => release(), 5_000);
    f.translator.onTranslate(async () => {
      if (f.translator.calls.length >= CONCURRENCY) release();
      await allTranslating;
    });
    try {
      const responses = await Promise.all(
        Array.from({ length: CONCURRENCY }, () => getTerms(f, 'en')),
      );
      expect(responses.map((response) => response.status)).toEqual(
        Array.from({ length: CONCURRENCY }, () => 200),
      );
      expect(responses.map((response) => response.body.body)).toEqual(
        Array.from({ length: CONCURRENCY }, () => `[en] ${terms.bodyJa}`),
      );
    } finally {
      clearTimeout(fallback);
    }
    // 5つとも同時に翻訳した（保存がぶつかった）
    expect(f.translator.calls).toHaveLength(CONCURRENCY);
    const rows = await f.db.prisma.translation.findMany({
      where: { entityType: 'TERMS_DOCUMENT', entityId: terms.id, field: 'body', locale: 'en' },
    });
    expect(rows).toEqual([
      expect.objectContaining({
        text: `[en] ${terms.bodyJa}`,
        sourceHash: sha256(terms.bodyJa),
        isEdited: false,
      }),
    ]);
  });

  it('[16.4][21.5] 原文が変わった機械翻訳を翻訳し直している間に、スタッフがその行を直したら、上書きせずに直した文を返す', async () => {
    const sk = await roomType('STANDARD_KING');
    const key = translationKey('ROOM_TYPE', sk.id, 'description', 'en');
    const changed = '32㎡の客室です。（説明を変更しました）';
    await f.db.prisma.roomType.update({ where: { id: sk.id }, data: { descriptionJa: changed } });
    f.translator.onTranslate(async ({ textJa, to }) => {
      if (textJa === changed && to === 'en') {
        await f.db.prisma.translation.update({
          where: key,
          data: { text: 'Edited while translating', isEdited: true },
        });
      }
    });

    const response = await getRoomTypes(f, 'en').expect(200);
    expect(response.body.roomTypes[0]).toMatchObject({
      code: 'STANDARD_KING',
      description: 'Edited while translating',
    });
    expect(f.translator.calls).toEqual([{ textJa: changed, to: 'en' }]);
    expect(await f.db.prisma.translation.findUniqueOrThrow({ where: key })).toMatchObject({
      text: 'Edited while translating',
      sourceHash: sha256(sk.descriptionJa),
      isEdited: true,
    });
  });

  it('[16.4] 翻訳している間に原文がまた変わり、別の要求が新しい原文の翻訳文を保存したら、その行を古い原文の翻訳で上書きしない', async () => {
    const st = await roomType('STANDARD_TWIN');
    const key = translationKey('ROOM_TYPE', st.id, 'description', 'en');
    const first = '32㎡の客室です。（1回目の変更）';
    const second = '32㎡の客室です。（2回目の変更）';
    await f.db.prisma.roomType.update({ where: { id: st.id }, data: { descriptionJa: first } });
    f.translator.onTranslate(async ({ textJa, to }) => {
      if (textJa === first && to === 'en') {
        await f.db.prisma.roomType.update({
          where: { id: st.id },
          data: { descriptionJa: second },
        });
        await f.db.prisma.translation.update({
          where: key,
          data: { text: `[en] ${second}`, sourceHash: sha256(second) },
        });
      }
    });

    // この要求は1回目の原文を読んだので、その翻訳を返す
    const response = await getRoomTypes(f, 'en').expect(200);
    expect(response.body.roomTypes[1]).toMatchObject({
      code: 'STANDARD_TWIN',
      description: `[en] ${first}`,
    });
    // 保存されている行は、新しい原文の翻訳のまま
    expect(await f.db.prisma.translation.findUniqueOrThrow({ where: key })).toMatchObject({
      text: `[en] ${second}`,
      sourceHash: sha256(second),
      isEdited: false,
    });

    // 次の要求は、新しい原文の保存した翻訳文を、翻訳せずに使う
    f.translator.reset();
    const next = await getRoomTypes(f, 'en').expect(200);
    expect(next.body.roomTypes[1].description).toBe(`[en] ${second}`);
    expect(f.translator.calls).toEqual([]);
  });
});
