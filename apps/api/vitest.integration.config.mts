// API の結合テスト（データベースを使うテスト）の設定。`pnpm test:integration` で実行する。
// ビルドとプラグインの設定（SWC での変換など）は vite.config.mts と共有し、テストの対象だけを差し替える。
// 単体テスト（pnpm check）はデータベースなしで動くように、*.integration.test.ts を対象から外している。
import { defineConfig } from 'vitest/config';
import apiConfig from './vite.config.mjs';

export default defineConfig({
  ...apiConfig,
  test: {
    name: 'api-integration',
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    // データベースへの接続を待つため、単体テストより長くする
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
