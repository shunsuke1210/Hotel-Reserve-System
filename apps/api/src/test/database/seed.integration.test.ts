// 初期データ（design.md「初期データ（seed）」、tasks.md 1.5）を、空のテスト用データベースに投入して確かめる。
// 投入は pnpm db:seed と同じく、テーブルの所有者（マイグレーション用の利用者）の接続で行い、
// 確認はアプリ用の利用者（API と同じ権限）の接続で行う（API から読めることも確かめる）。
//
// 期待する値は brief.md（FC-02・FC-04・PR-11〜PR-15・TX-02・RS-17・基本料金の表）と design.md から書き写したもので、
// 初期データのファイルからは読まない（同じ誤りを見逃さないため）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedInitialData } from '../../../prisma/seed/seed.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

const DATE = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/** brief.md FC-04 の客室タイプ（広さ・寝具・定員（大人）・基準人数・室数）と、基本料金の初期値（税抜・1人1泊） */
const ROOM_TYPES = [
  ['スタンダード キング', 32, 'キング＋ソファーベッド', 3, 2, 100, 15_000],
  ['スタンダード ツイン', 32, 'シングル2＋ソファーベッド', 3, 2, 90, 15_000],
  ['デラックス キング', 38, 'キング', 2, 2, 20, 18_000],
  ['デラックス ツイン', 38, 'シングル2＋ソファーベッド', 3, 2, 20, 18_000],
  ['プレミアム キング', 46, 'キング＋ソファーベッド', 3, 2, 16, 23_000],
  ['スイート', 64, 'キング＋リビング', 4, 2, 6, 40_000],
  ['金沢スイート', 96, 'キング＋リビング', 4, 2, 1, 70_000],
] as const;

type TypeName = (typeof ROOM_TYPES)[number][0];
const SK: TypeName = 'スタンダード キング';
const ST: TypeName = 'スタンダード ツイン';
const DK: TypeName = 'デラックス キング';
const DT: TypeName = 'デラックス ツイン';

/**
 * 各階の客室タイプの並び（部屋番号の小さい順）。design.md の範囲（4〜12F は各階25〜26室で、
 * スタンダード キング11〜12室・スタンダード ツイン10室・デラックス キング／ツイン各2〜3室）の中で決めた配置。
 * テストケースの前提（501〜503 はスタンダード キング、デラックス キングが3室の階は 5F・6F、7F・9F のスタンダード キングは11室）に合わせた。
 */
const EXPECTED_FLOORS: Record<number, [TypeName, number][]> = {
  4: [
    [SK, 12],
    [ST, 10],
    [DK, 2],
    [DT, 2],
  ],
  5: [
    [SK, 11],
    [ST, 10],
    [DK, 3],
    [DT, 2],
  ],
  6: [
    [SK, 11],
    [ST, 10],
    [DK, 3],
    [DT, 2],
  ],
  7: [
    [SK, 11],
    [ST, 10],
    [DK, 2],
    [DT, 3],
  ],
  8: [
    [SK, 11],
    [ST, 10],
    [DK, 2],
    [DT, 3],
  ],
  9: [
    [SK, 11],
    [ST, 10],
    [DK, 2],
    [DT, 2],
  ],
  10: [
    [SK, 11],
    [ST, 10],
    [DK, 2],
    [DT, 2],
  ],
  11: [
    [SK, 11],
    [ST, 10],
    [DK, 2],
    [DT, 2],
  ],
  12: [
    [SK, 11],
    [ST, 10],
    [DK, 2],
    [DT, 2],
  ],
  13: [
    ['プレミアム キング', 16],
    ['スイート', 6],
    ['金沢スイート', 1],
  ],
};

/** 内閣府「国民の祝日」の 2026年の一覧（振替休日・国民の休日は、内閣府の一覧では「休日」） */
const HOLIDAYS_2026 = [
  ['2026-01-01', '元日'],
  ['2026-01-12', '成人の日'],
  ['2026-02-11', '建国記念の日'],
  ['2026-02-23', '天皇誕生日'],
  ['2026-03-20', '春分の日'],
  ['2026-04-29', '昭和の日'],
  ['2026-05-03', '憲法記念日'],
  ['2026-05-04', 'みどりの日'],
  ['2026-05-05', 'こどもの日'],
  ['2026-05-06', '休日'], // 振替休日（5/3 が日曜）
  ['2026-07-20', '海の日'],
  ['2026-08-11', '山の日'],
  ['2026-09-21', '敬老の日'],
  ['2026-09-22', '休日'], // 国民の休日（敬老の日と秋分の日に挟まれた日）
  ['2026-09-23', '秋分の日'],
  ['2026-10-12', 'スポーツの日'],
  ['2026-11-03', '文化の日'],
  ['2026-11-23', '勤労感謝の日'],
];

let db: TestDatabase;
let owner: PrismaService;

/** 初期データの投入（pnpm db:seed と同じく、テーブルの所有者の接続で行う） */
function seed() {
  return seedInitialData(owner, { now: new Date('2026-10-23T09:00:00+09:00') });
}

async function tableCounts() {
  const prisma = db.prisma;
  return {
    roomTypes: await prisma.roomType.count(),
    rooms: await prisma.room.count(),
    rateVersions: await prisma.rateVersion.count(),
    roomTypePrices: await prisma.roomTypePrice.count(),
    holidays: await prisma.holiday.count(),
    termsDocuments: await prisma.termsDocument.count(),
    hotelSettings: await prisma.hotelSetting.count(),
    staff: await prisma.staff.count(),
    translations: await prisma.translation.count(),
  };
}

beforeAll(async () => {
  db = await createTestDatabase();
  owner = new PrismaService(db.ownerUrl);
  await seed();
});

afterAll(async () => {
  await owner?.$disconnect();
  await db?.drop();
});

describe('初期データ：客室タイプと部屋', () => {
  it('[6.1] 客室タイプが7件あり、名前・広さ・寝具・定員（大人）・基準人数が brief.md FC-04 のとおり', async () => {
    const types = await db.prisma.roomType.findMany({ orderBy: { displayOrder: 'asc' } });
    expect(
      types.map((type) => [
        type.nameJa,
        type.areaSqm,
        type.bedDescriptionJa,
        type.capacityAdults,
        type.standardOccupancy,
      ]),
    ).toEqual(
      ROOM_TYPES.map(([name, area, bed, capacity, standard]) => [
        name,
        area,
        bed,
        capacity,
        standard,
      ]),
    );
    expect(new Set(types.map((type) => type.code)).size).toBe(7);
    for (const type of types) {
      expect(type.descriptionJa.length).toBeGreaterThan(0);
    }
  });

  it('[9.2] 部屋は253室で、客室タイプごとの室数が brief.md FC-04 のとおり、状態はすべて清掃完了', async () => {
    const rooms = await db.prisma.room.findMany({ include: { roomType: true } });
    expect(rooms).toHaveLength(253);
    const countByType = new Map<string, number>();
    for (const room of rooms) {
      countByType.set(room.roomType.nameJa, (countByType.get(room.roomType.nameJa) ?? 0) + 1);
    }
    expect(Object.fromEntries(countByType)).toEqual(
      Object.fromEntries(ROOM_TYPES.map(([name, , , , , count]) => [name, count])),
    );
    expect(new Set(rooms.map((room) => room.status))).toEqual(new Set(['CLEAN']));
    expect(rooms.every((room) => room.statusChangedBy === null)).toBe(true);
  });

  it('[9.2] 部屋は 4〜13F にあり、部屋番号は「階×100＋1からの通し番号」で、各階の中はタイプごとにまとまって並ぶ', async () => {
    const rooms = await db.prisma.room.findMany({
      include: { roomType: true },
      orderBy: { roomNumber: 'asc' },
    });
    const actual: Record<number, [string, number][]> = {};
    for (const room of rooms) {
      expect(Math.floor(room.roomNumber / 100)).toBe(room.floor);
      const floor = (actual[room.floor] ??= []);
      expect(room.roomNumber).toBe(room.floor * 100 + floor.reduce((sum, [, n]) => sum + n, 0) + 1);
      const last = floor.at(-1);
      if (last?.[0] === room.roomType.nameJa) last[1] += 1;
      else floor.push([room.roomType.nameJa, 1]);
    }
    expect(actual).toEqual(EXPECTED_FLOORS);
  });

  it('[9.2] 4〜12F は各階25〜26室（スタンダード キング11〜12室・スタンダード ツイン10室・デラックス キング／ツイン各2〜3室）、13F はプレミアム キング・スイート・金沢スイートだけ（design.md の範囲）', async () => {
    const rooms = await db.prisma.room.findMany({ include: { roomType: true } });
    for (let floor = 4; floor <= 12; floor++) {
      const onFloor = rooms.filter((room) => room.floor === floor);
      const count = (name: string) =>
        onFloor.filter((room) => room.roomType.nameJa === name).length;
      expect(onFloor.length, `${floor}F`).toBeGreaterThanOrEqual(25);
      expect(onFloor.length, `${floor}F`).toBeLessThanOrEqual(26);
      expect([11, 12], `${floor}F`).toContain(count(SK));
      expect(count(ST), `${floor}F`).toBe(10);
      expect([2, 3], `${floor}F`).toContain(count(DK));
      expect([2, 3], `${floor}F`).toContain(count(DT));
      expect(count(SK) + count(ST) + count(DK) + count(DT), `${floor}F`).toBe(onFloor.length);
    }
    const top = rooms.filter((room) => room.floor === 13).map((room) => room.roomType.nameJa);
    expect(new Set(top)).toEqual(new Set(['プレミアム キング', 'スイート', '金沢スイート']));
    // design.md の例「401〜426」
    expect(
      rooms
        .filter((room) => room.floor === 4)
        .map((room) => room.roomNumber)
        .sort(),
    ).toEqual(Array.from({ length: 26 }, (_, i) => 401 + i));
  });

  it('[9.2] バリアフリーの部屋はスタンダード ツインの1室だけ', async () => {
    const accessible = await db.prisma.room.findMany({
      where: { isAccessible: true },
      include: { roomType: true },
    });
    expect(accessible.map((room) => room.roomType.nameJa)).toEqual([ST]);
  });
});

describe('初期データ：料金の版1と基本料金', () => {
  it('[6.6][6.9][6.11][6.12][6.14][6.15][6.16] 料金の版が1件あり、割増・人数割・連泊割・早期割・下限・消費税・朝食・時間外・宿泊税の値が design.md のとおり', async () => {
    const versions = await db.prisma.rateVersion.findMany();
    expect(versions).toHaveLength(1);
    const [version] = versions;
    expect({
      weekendSurchargeBp: version?.weekendSurchargeBp,
      headcountTiers: version?.headcountTiers,
      stayTiers: version?.stayTiers,
      earlyBirdBp: version?.earlyBirdBp,
      rateFloorBp: version?.rateFloorBp,
      consumptionTaxBp: version?.consumptionTaxBp,
      breakfastPriceExcl: version?.breakfastPriceExcl,
      offHoursPricePerHourIncl: version?.offHoursPricePerHourIncl,
      lodgingTaxBrackets: version?.lodgingTaxBrackets,
    }).toEqual({
      weekendSurchargeBp: 2000,
      headcountTiers: [
        { minPersons: 2, discountBp: 500 },
        { minPersons: 4, discountBp: 1000 },
        { minPersons: 10, discountBp: 1500 },
      ],
      stayTiers: [
        { minNights: 2, discountBp: 1000 },
        { minNights: 5, discountBp: 2000 },
      ],
      earlyBirdBp: 1000,
      rateFloorBp: -5000,
      consumptionTaxBp: 1000,
      breakfastPriceExcl: 3500,
      offHoursPricePerHourIncl: 1000,
      lodgingTaxBrackets: [
        { minExclTax: 0, taxPerPersonNight: 0 },
        { minExclTax: 5000, taxPerPersonNight: 200 },
        { minExclTax: 20000, taxPerPersonNight: 500 },
      ],
    });
  });

  it('[6.1] 版1は、テストケースで予約を確定する最も早い時刻（2026-08-01）より前から有効（L-12）', async () => {
    const version = await db.prisma.rateVersion.findFirstOrThrow();
    expect(version.effectiveFrom.getTime()).toBeLessThanOrEqual(
      new Date('2026-08-01T00:00:00+09:00').getTime(),
    );
  });

  it('[6.1] 版1に、客室タイプごとの基本料金（税抜・大人1人1泊）がある', async () => {
    const prices = await db.prisma.roomTypePrice.findMany({ include: { roomType: true } });
    expect(
      Object.fromEntries(prices.map((price) => [price.roomType.nameJa, price.basePriceExcl])),
    ).toEqual(Object.fromEntries(ROOM_TYPES.map(([name, , , , , , price]) => [name, price])));
    const version = await db.prisma.rateVersion.findFirstOrThrow();
    expect(prices.every((price) => price.rateVersionId === version.id)).toBe(true);
  });
});

describe('初期データ：祝日・宿泊約款・ホテルの設定', () => {
  it('[6.6] 内閣府の「国民の祝日」の 2026年の一覧（振替休日 5/6・国民の休日 9/22 を含む）が、そのまま祝日として登録されている', async () => {
    const holidays = await db.prisma.holiday.findMany({
      where: { date: { gte: DATE('2026-01-01'), lte: DATE('2026-12-31') } },
      orderBy: { date: 'asc' },
    });
    expect(holidays.map((holiday) => [isoDate(holiday.date), holiday.name])).toEqual(HOLIDAYS_2026);
  });

  it('[6.6] 予約を受け付ける期間（365日先）のために、2027年の祝日（振替休日 3/22 を含む）も登録されている', async () => {
    const dates = (
      await db.prisma.holiday.findMany({
        where: { date: { gte: DATE('2027-01-01'), lte: DATE('2027-12-31') } },
      })
    ).map((holiday) => isoDate(holiday.date));
    expect(dates).toEqual(expect.arrayContaining(['2027-01-01', '2027-03-22', '2027-11-23']));
  });

  it('[4.14] 宿泊約款の版1があり、キャンセル規定と団体の扱いを含む（仮の文章）', async () => {
    const terms = await db.prisma.termsDocument.findMany();
    expect(terms.map((document) => document.version)).toEqual([1]);
    const [document] = terms;
    expect(document?.bodyJa).toContain('キャンセル');
    expect(document?.bodyJa).toContain('団体');
    expect(document?.publishedAt.getTime()).toBeLessThanOrEqual(
      new Date('2026-08-01T00:00:00+09:00').getTime(),
    );
  });

  it('[8.23] 振込先（銀行名・支店・口座種別・口座番号・名義）がホテルの設定にある', async () => {
    const settings = await db.prisma.hotelSetting.findMany();
    const values = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
    for (const key of [
      'bank_transfer.bank_name',
      'bank_transfer.branch_name',
      'bank_transfer.account_type',
      'bank_transfer.account_number',
      'bank_transfer.account_holder',
    ]) {
      expect(values[key], key).toEqual(expect.stringMatching(/\S/));
    }
    expect(values['bank_transfer.account_type']).toMatch(/^(普通|当座)$/);
    expect(values['bank_transfer.account_number']).toMatch(/^\d{7}$/);
  });

  it('スタッフのアカウントは登録しない（パスワードのハッシュ化ができた後の 4.1 で登録する）', async () => {
    expect(await db.prisma.staff.count()).toBe(0);
  });
});

describe('初期データの再投入', () => {
  it('[9.2][21.7] 2回目の投入では行が増えず、既にある行（部屋の状態・料金の版・設定）を書き換えない', async () => {
    const before = await tableCounts();
    expect(before).toMatchObject({
      roomTypes: 7,
      rooms: 253,
      rateVersions: 1,
      roomTypePrices: 7,
      termsDocuments: 1,
      hotelSettings: 5,
    });

    // 運用で変わった値（部屋の状態・振込先）と、料金の版の行
    const room501 = await db.prisma.room.update({
      where: { roomNumber: 501 },
      data: { status: 'OUT_OF_ORDER', statusChangedAt: new Date('2026-10-23T10:00:00+09:00') },
    });
    await db.prisma.hotelSetting.update({
      where: { key: 'bank_transfer.branch_name' },
      data: { value: '変更した支店' },
    });
    const version = await db.prisma.rateVersion.findFirstOrThrow();

    await expect(seed()).resolves.toBeDefined();

    expect(await tableCounts()).toEqual(before);
    expect(await db.prisma.room.findUniqueOrThrow({ where: { roomNumber: 501 } })).toEqual(room501);
    expect(
      (
        await db.prisma.hotelSetting.findUniqueOrThrow({
          where: { key: 'bank_transfer.branch_name' },
        })
      ).value,
    ).toBe('変更した支店');
    expect(await db.prisma.rateVersion.findFirstOrThrow()).toEqual(version);
  });
});
