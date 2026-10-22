// フロントアプリ（front-web）のビルド・開発用サーバー・テストの設定。
// 開発中は /api/staff を社内用 API（StaffApp、ポート3002）へ中継し、本番と同じく同じオリジンで呼び出す
// （本番は社内用 nginx が中継する。Cookie のセッションをそのまま使うため）。
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const PORT = 5174;
const apiProxy = { '/api/staff': 'http://localhost:3002' };

export default defineConfig({
  plugins: [react()],
  server: { port: PORT, strictPort: true, proxy: apiProxy },
  preview: { port: PORT, strictPort: true, proxy: apiProxy },
  test: {
    name: 'front-web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
