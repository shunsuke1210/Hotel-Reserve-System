// 清掃アプリの組み立て：画面の切り替え、API の呼び出し、取得した結果の保持をつなぐ
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import {
  RouterProvider,
  createBrowserRouter,
  createMemoryRouter,
  type DataRouter,
} from 'react-router';
import { ApiProvider } from './api/api-context';
import { createApiClient, type ApiClient } from './api/client';
import { createQueryClient } from './api/query-client';
import { routes } from './routes';
import { redirectToLogin } from './routing/login-redirect';

export interface CleaningAppOptions {
  /** 指定するとメモリ上の履歴で動かす（テスト用）。指定しなければブラウザの URL で動かす */
  initialEntries?: string[];
  fetch?: typeof fetch;
}

export interface CleaningApp {
  router: DataRouter;
  api: ApiClient;
  queryClient: QueryClient;
}

export function createCleaningApp(options: CleaningAppOptions = {}): CleaningApp {
  const router = options.initialEntries
    ? createMemoryRouter(routes, { initialEntries: options.initialEntries })
    : createBrowserRouter(routes);
  const api = createApiClient({
    fetch: options.fetch,
    onUnauthenticated: () => redirectToLogin(router),
  });
  return { router, api, queryClient: createQueryClient() };
}

export function App({ app }: { app: CleaningApp }) {
  return (
    <QueryClientProvider client={app.queryClient}>
      <ApiProvider client={app.api}>
        <RouterProvider router={app.router} />
      </ApiProvider>
    </QueryClientProvider>
  );
}
