import { defineConfig } from 'vitest/config';

// リポジトリの最上位から、全パッケージの単体テストを1回で実行する
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
