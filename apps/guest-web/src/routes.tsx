// 宿泊客アプリの画面の切り替え（G01〜G20）。各画面は機能ごとのルートの定義（features/*/routes.tsx）に置き、
// ここではそれらを共通のレイアウト（ヘッダー・言語の切り替え・エラーの帯）の下にまとめる。
import type { RouteObject } from 'react-router';
import { authRoutes } from './features/auth/routes';
import { bookingRoutes } from './features/booking/routes';
import { mypageRoutes } from './features/mypage/routes';
import { searchRoutes } from './features/search/routes';
import { AppLayout } from './layout/app-layout';

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [...searchRoutes, ...authRoutes, ...bookingRoutes, ...mypageRoutes],
  },
];
