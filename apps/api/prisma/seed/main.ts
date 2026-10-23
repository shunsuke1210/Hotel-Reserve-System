// pnpm db:seed：初期データ（客室タイプ・部屋・料金の版1・祝日・宿泊約款・振込先）を投入する（tasks.md 1.5）。
//
//   pnpm db:seed                    開発用のデータベース（APP_ENV の既定は development）
//   APP_ENV=production pnpm db:seed  本番（.env.production か環境変数の接続先）
//
// 先に pnpm db:migrate でマイグレーションを適用しておく。何度実行してもよい（ない行だけを追加し、既にある行は変えない）。
// pnpm db:migrate と同じく、テーブルの所有者（MIGRATION_DATABASE_URL）で接続する。
// 結合テストは、テストごとのデータベースに seedInitialData（seed.ts）で投入するので、このスクリプトは使わない。
import {
  ConfigError,
  describeDatabaseTarget,
  loadConfig,
  requireMigrationDatabaseUrl,
} from '../../src/shared/config/app-config.js';
import { PrismaService } from '../../src/shared/prisma/prisma.service.js';
import { seedInitialData, type SeedSummary } from './seed.js';

const LABELS: Record<keyof SeedSummary, string> = {
  roomTypes: '客室タイプ',
  rooms: '部屋',
  rateVersions: '料金の版',
  roomTypePrices: '基本料金',
  holidays: '祝日',
  termsDocuments: '宿泊約款',
  hotelSettings: 'ホテルの設定',
};

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.appEnv === 'test') {
    throw new Error(
      '結合テスト用のデータベースには、結合テストが seedInitialData で投入します（pnpm test:integration）',
    );
  }
  const ownerUrl = requireMigrationDatabaseUrl(config);

  console.log(`初期データを投入します（${config.appEnv}：${describeDatabaseTarget(ownerUrl)}）`);
  const prisma = new PrismaService(ownerUrl);
  try {
    const summary = await seedInitialData(prisma, { now: new Date() });
    for (const [key, label] of Object.entries(LABELS) as [keyof SeedSummary, string][]) {
      console.log(`  ${label}：${summary[key]}件を追加`);
    }
    console.log('完了しました（既にある行は変えていません）');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // 設定の誤りは文言だけを示す（値は含まれない）
  console.error(error instanceof ConfigError ? error.message : error);
  process.exitCode = 1;
});
