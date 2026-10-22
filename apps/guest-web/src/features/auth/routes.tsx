// 認証の機能の画面の切り替え（G03〜G08）
import type { RouteObject } from 'react-router';
import { G03LoginPage } from '../../pages/g03-login-page';
import { LOGIN_PATH } from '../../routing/login-redirect';

export const authRoutes: RouteObject[] = [{ path: LOGIN_PATH, element: <G03LoginPage /> }];
