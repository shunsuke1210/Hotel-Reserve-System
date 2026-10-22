// 検索の機能の画面の切り替え（G01・G02）
import type { RouteObject } from 'react-router';
import { G01SearchPage } from '../../pages/g01-search-page';

export const searchRoutes: RouteObject[] = [{ index: true, element: <G01SearchPage /> }];
