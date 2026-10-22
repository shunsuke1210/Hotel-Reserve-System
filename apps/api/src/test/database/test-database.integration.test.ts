// 結合テスト用のデータベースの仕組み（test-database.ts）を確かめる（tasks.md 1.4）。
// テストのファイルごと（または必要な単位ごと）に、マイグレーションを適用した空のデータベースを新しく作る。
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig, requireMigrationDatabaseUrl } from '../../shared/config/app-config.js';
import { connectPg, createTestDatabase, type TestDatabase } from './test-database.js';

const created: TestDatabase[] = [];
afterAll(async () => {
  await Promise.all(created.map((database) => database.drop()));
});

async function newDatabase(): Promise<TestDatabase> {
  const database = await createTestDatabase();
  created.push(database);
  return database;
}

async function databaseExists(name: string): Promise<boolean> {
  const maintenance = await connectPg(requireMigrationDatabaseUrl(loadConfig({ appEnv: 'test' })));
  try {
    const { rows } = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      name,
    ]);
    return rows.length === 1;
  } finally {
    await maintenance.end();
  }
}

describe('結合テスト用のデータベース（createTestDatabase）', () => {
  it('[9.1] 作るたびに、スキーマを適用した空の別々のデータベースになり、ほかのデータベースの行は見えない', async () => {
    const first = await newDatabase();
    const roomType = await first.prisma.roomType.create({
      data: {
        code: `ISO-${randomUUID().slice(0, 8)}`,
        nameJa: '分離の確認',
        areaSqm: 20,
        bedDescriptionJa: '—',
        capacityAdults: 1,
        standardOccupancy: 1,
        displayOrder: 1,
        descriptionJa: '—',
      },
    });
    expect(await first.prisma.roomType.count()).toBe(1);

    const second = await newDatabase();
    expect(second.name).not.toBe(first.name);
    // 前のデータベースに行があっても、新しいデータベースは空で、同じスキーマを持つ
    expect(await second.prisma.roomType.count()).toBe(0);
    await expect(
      second.prisma.roomType.findUnique({ where: { id: roomType.id } }),
    ).resolves.toBeNull();
    expect(await second.prisma.roomNight.count()).toBe(0);
  });

  it('アプリ用とテーブルの所有者用の接続先は、作ったデータベースを指す', async () => {
    const database = await newDatabase();
    for (const url of [database.appUrl, database.ownerUrl]) {
      const client = await connectPg(url);
      try {
        const { rows } = await client.query<{ name: string }>('SELECT current_database() AS name');
        expect(rows[0]?.name).toBe(database.name);
      } finally {
        await client.end();
      }
    }
    expect(new URL(database.appUrl).username).not.toBe(new URL(database.ownerUrl).username);
  });

  it('drop で接続を閉じてデータベースを削除する（何度呼んでもよい）', async () => {
    const database = await createTestDatabase();
    await database.prisma.$queryRaw`SELECT 1`;
    expect(await databaseExists(database.name)).toBe(true);
    await database.drop();
    await database.drop();
    expect(await databaseExists(database.name)).toBe(false);
  });
});
