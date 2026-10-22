// API のビルドとテストの設定。
// - NestJS は依存の注入にデコレーターの型情報（emitDecoratorMetadata）を使うため、
//   TypeScript の変換は esbuild ではなく SWC（unplugin-swc）で行う（tsconfig.json の設定を読む）。
// - 契約パッケージ（@hotel/contracts）は TypeScript のソースのまま共有しているため、
//   ビルドでは dist/main.js に束ねる。それ以外の依存（NestJS・zod など）は束ねず、実行時に読み込む。
import swc from 'unplugin-swc';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ jsc: { target: 'es2023' } })],
  ssr: {
    noExternal: ['@hotel/contracts'],
  },
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    target: 'node24',
    sourcemap: true,
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'main.js',
      },
    },
  },
  test: {
    name: 'api',
    include: ['src/**/*.test.ts'],
    // データベースを使う結合テストは pnpm test:integration（vitest.integration.config.mts）で実行する
    exclude: [...configDefaults.exclude, 'src/**/*.integration.test.ts'],
    environment: 'node',
  },
});
