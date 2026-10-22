// フロントアプリの画面の切り替え（F01〜F14）。共通のレイアウト（ヘッダー・エラーの帯）の下にまとめる
import type { RouteObject } from 'react-router';
import { AppLayout } from './layout/app-layout';
import { F01LoginPage } from './pages/f01-login-page';
import { F02ChartPage } from './pages/f02-chart-page';
import { LOGIN_PATH } from './routing/login-redirect';

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <F02ChartPage /> },
      { path: LOGIN_PATH, element: <F01LoginPage /> },
    ],
  },
];
