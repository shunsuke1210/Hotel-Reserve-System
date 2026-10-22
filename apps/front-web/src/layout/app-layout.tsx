// 全画面に共通の枠：ヘッダー（画面の名前）、エラーの帯、各画面の内容。スタッフ向けは日本語だけ（要件 16.6）
import { Outlet } from 'react-router';
import { ErrorBanner, ErrorBannerProvider } from '../components/error-banner';

export const APP_TITLE = '予約管理（フロント）';

export function AppLayout() {
  return (
    <ErrorBannerProvider>
      <header className="app-header">
        <p className="app-header__title">{APP_TITLE}</p>
      </header>
      <ErrorBanner />
      <main className="app-main">
        <Outlet />
      </main>
    </ErrorBannerProvider>
  );
}
