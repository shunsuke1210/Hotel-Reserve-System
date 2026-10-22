// 清掃アプリの画面の切り替え（C01〜C03）。共通のレイアウト（ヘッダー・エラーの帯）の下にまとめる
import type { RouteObject } from 'react-router';
import { AppLayout } from './layout/app-layout';
import { C01LoginPage } from './pages/c01-login-page';
import { C02StatusBoardPage } from './pages/c02-status-board-page';
import { LOGIN_PATH } from './routing/login-redirect';

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <C02StatusBoardPage /> },
      { path: LOGIN_PATH, element: <C01LoginPage /> },
    ],
  },
];
