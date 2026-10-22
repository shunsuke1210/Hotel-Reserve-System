// 宿泊客アプリ（guest-web）のビルド・開発用サーバー・テストの設定。
// 開発中は /api/guest を公開用 API（GuestApp、ポート3001）へ中継し、本番と同じく同じオリジンで呼び出す
// （本番は公開用 nginx が中継する。Cookie のセッションをそのまま使うため）。
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const PORT = 5173;
const apiProxy = { '/api/guest': 'http://localhost:3001' };

export default defineConfig({
  plugins: [react()],
  server: { port: PORT, strictPort: true, proxy: apiProxy },
  preview: { port: PORT, strictPort: true, proxy: apiProxy },
  test: {
    name: 'guest-web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
