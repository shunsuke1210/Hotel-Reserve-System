// API の結合テスト（データベースを使うテスト）の設定。`pnpm test:integration` で実行する。
// ビルドとプラグインの設定（SWC での変換など）は vite.config.mts と共有し、テストの対象だけを差し替える。
// 単体テスト（pnpm check）はデータベースなしで動くように、*.integration.test.ts を対象から外している。
//
// 実行のはじめに、テスト用のサーバーへマイグレーションを適用したひな形のデータベースを作る（src/test/database/global-setup.ts）。
// 各テストは createTestDatabase（src/test/database/test-database.ts）で、その複製の空のデータベースを使う。
import { defineConfig } from 'vitest/config';
import apiConfig from './vite.config.mjs';

export default defineConfig({
  ...apiConfig,
  test: {
    name: 'api-integration',
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    globalSetup: ['src/test/database/global-setup.ts'],
    // 設定（loadConfig）は test 環境のもの（TEST_DATABASE_URL など）を使う
    env: { APP_ENV: 'test' },
    // データベースへの接続と、データベースの作成を待つため、単体テストより長くする
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
