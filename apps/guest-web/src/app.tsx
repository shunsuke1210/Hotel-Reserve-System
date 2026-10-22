// 宿泊客アプリの組み立て：言語の切り替え、画面の切り替え、API の呼び出し、取得した結果の保持をつなぐ
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import {
  RouterProvider,
  createBrowserRouter,
  createMemoryRouter,
  type DataRouter,
} from 'react-router';
import { ApiProvider } from './api/api-context';
import { GUEST_API_BASE_URL, createApiClient, type ApiClient } from './api/client';
import { createQueryClient } from './api/query-client';
import { createI18n, currentLocale, type I18n } from './i18n/i18n';
import { LOCALE_STORAGE_KEY, detectInitialLocale } from './i18n/locale';
import { routes } from './routes';
import { redirectToLogin } from './routing/login-redirect';

/** 選んだ言語を覚えておく場所（端末の保存領域） */
export type LocaleStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface GuestAppOptions {
  /** 指定するとメモリ上の履歴で動かす（テスト用）。指定しなければブラウザの URL で動かす */
  initialEntries?: string[];
  fetch?: typeof fetch;
  /** 既定はブラウザの localStorage。null なら覚えない */
  storage?: LocaleStorage | null;
  /** 既定はブラウザの言語の設定（navigator.languages） */
  browserLanguages?: readonly string[];
}

export interface GuestApp {
  i18n: I18n;
  router: DataRouter;
  api: ApiClient;
  queryClient: QueryClient;
}

function defaultStorage(): LocaleStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readSavedLocale(storage: LocaleStorage | null): string | null {
  try {
    return storage?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function saveLocale(storage: LocaleStorage | null, locale: string): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // 保存できない端末（プライベートモードなど）では、言語を覚えないだけにする
  }
}

export function createGuestApp(options: GuestAppOptions = {}): GuestApp {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const i18n = createI18n(
    detectInitialLocale({
      saved: readSavedLocale(storage),
      browserLanguages: options.browserLanguages ?? navigator.languages,
    }),
  );

  // 画面の言語を、文書の言語（読み上げ・フォントの選択に使われる）と画面の名前に反映する
  const applyLocale = () => {
    document.documentElement.lang = currentLocale(i18n);
    document.title = i18n.t('app.title');
  };
  applyLocale();
  i18n.on('languageChanged', () => {
    applyLocale();
    saveLocale(storage, currentLocale(i18n));
  });

  const router = options.initialEntries
    ? createMemoryRouter(routes, { initialEntries: options.initialEntries })
    : createBrowserRouter(routes);

  const api = createApiClient({
    baseUrl: GUEST_API_BASE_URL,
    fetch: options.fetch,
    getLocale: () => currentLocale(i18n),
    onUnauthenticated: () => redirectToLogin(router),
    fallbackMessages: {
      network: () => i18n.t('errors.network'),
      unexpected: () => i18n.t('errors.unexpected'),
    },
  });

  return { i18n, router, api, queryClient: createQueryClient() };
}

export function App({ app }: { app: GuestApp }) {
  return (
    <I18nextProvider i18n={app.i18n}>
      <QueryClientProvider client={app.queryClient}>
        <ApiProvider client={app.api}>
          <RouterProvider router={app.router} />
        </ApiProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
