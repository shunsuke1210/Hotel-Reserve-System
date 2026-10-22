// PrismaService（データベースの接続）とトランザクションの補助を、テスト用のデータベースで確かめる（tasks.md 1.4）。
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/database/test-database.js';
import { loadConfig } from '../config/app-config.js';
import { createTestListenerApp } from '../../test/listener-app.js';
import { isUniqueViolation } from './prisma-errors.js';
import { PrismaService } from './prisma.service.js';
import { runInTransaction } from './transaction.js';

describe('PrismaModule（2つの待ち受け口で1つの接続プールを共有する）', () => {
  const apps: INestApplication[] = [];
  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  it('公開用と社内用は同じ PrismaService を使い、設定ファイルの接続先（アプリ用の利用者）で接続する', async () => {
    const guest = await createTestListenerApp('guest', { prisma: 'process' });
    const staff = await createTestListenerApp('staff', { prisma: 'process' });
    apps.push(guest, staff);

    // Prisma Client は Proxy を返すので instanceof は使えない。同じものかどうかは === で比べる
    // （失敗したときに、テストの差分の表示が Proxy をたどり続けないように、真偽値で比べる）
    const prisma = guest.get(PrismaService);
    expect(staff.get(PrismaService) === prisma).toBe(true);

    // 結合テストは APP_ENV=test なので、TEST_DATABASE_URL（アプリ用の利用者）で接続する
    const config = loadConfig({ appEnv: 'test' });
    const [row] = await prisma.$queryRaw<{ user: string; database: string }[]>`
      SELECT current_user AS "user", current_database() AS database`;
    expect(row).toEqual({
      user: decodeURIComponent(new URL(config.databaseUrl).username),
      database: decodeURIComponent(new URL(config.databaseUrl).pathname.slice(1)),
    });

    // 片方を閉じても、もう一方は使い続けられる。両方を閉じると次は新しい接続プールを作る
    await guest.close();
    apps.splice(apps.indexOf(guest), 1);
    await expect(staff.get(PrismaService).$queryRaw`SELECT 1 AS one`).resolves.toEqual([
      { one: 1 },
    ]);
    await staff.close();
    apps.splice(apps.indexOf(staff), 1);

    const reopened = await createTestListenerApp('staff', { prisma: 'process' });
    apps.push(reopened);
    expect(reopened.get(PrismaService) === prisma).toBe(false);
    await expect(reopened.get(PrismaService).$queryRaw`SELECT 1 AS one`).resolves.toEqual([
      { one: 1 },
    ]);
  });
});

describe('runInTransaction と isUniqueViolation', () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    await db?.drop();
  });

  const holiday = (date: string, name = '祝日') => ({ date: new Date(`${date}T00:00:00Z`), name });

  it('処理が成功すればまとめて確定し、途中で失敗すれば何も変わらない', async () => {
    await runInTransaction(db.prisma, async (tx) => {
      await tx.holiday.create({ data: holiday('2026-11-03', '文化の日') });
      await tx.holiday.create({ data: holiday('2026-11-23', '勤労感謝の日') });
    });
    expect(await db.prisma.holiday.count()).toBe(2);

    const failure = new Error('途中で失敗');
    await expect(
      runInTransaction(db.prisma, async (tx) => {
        await tx.holiday.create({ data: holiday('2026-12-31') });
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await db.prisma.holiday.count()).toBe(2);
  });

  it('一意制約の違反を、制約の名前つきで見分けられる（Prisma の操作・生の SQL のどちらでも）', async () => {
    const key = `dup-${randomUUID()}`;
    await db.prisma.hotelSetting.create({ data: { key, value: 'a' } });

    const viaClient = await db.prisma.hotelSetting
      .create({ data: { key, value: 'b' } })
      .catch((error: unknown) => error);
    expect(isUniqueViolation(viaClient)).toBe(true);
    expect(isUniqueViolation(viaClient, 'hotel_settings_pkey')).toBe(true);
    expect(isUniqueViolation(viaClient, 'room_nights_room_id_stay_date_key')).toBe(false);

    const viaRawSql = await db.prisma
      .$executeRaw`INSERT INTO hotel_settings (key, value) VALUES (${key}, 'c')`.catch(
      (error: unknown) => error,
    );
    expect(isUniqueViolation(viaRawSql, 'hotel_settings_pkey')).toBe(true);

    const notUnique = await db.prisma.$executeRaw`SELECT 1 / 0`.catch((error: unknown) => error);
    expect(isUniqueViolation(notUnique)).toBe(false);
    expect(isUniqueViolation(new Error('unique'))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it('トランザクションの中で一意制約に違反すると、そのトランザクションは取り消され、違反を見分けられる', async () => {
    const key = `tx-${randomUUID()}`;
    await db.prisma.hotelSetting.create({ data: { key, value: 'a' } });
    const error = await runInTransaction(db.prisma, async (tx) => {
      await tx.holiday.create({ data: holiday('2027-01-01', '元日') });
      await tx.hotelSetting.create({ data: { key, value: 'b' } });
    }).catch((caught: unknown) => caught);
    expect(isUniqueViolation(error, 'hotel_settings_pkey')).toBe(true);
    expect(
      await db.prisma.holiday.findUnique({ where: { date: holiday('2027-01-01').date } }),
    ).toBeNull();
  });
});
