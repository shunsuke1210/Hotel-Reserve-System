// 全画面に共通の枠：ヘッダー（画面の名前と言語の切り替え）、エラーの帯、各画面の内容
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';
import { ErrorBanner, ErrorBannerProvider } from '../components/error-banner';
import { LanguageSwitcher } from './language-switcher';

export function AppLayout() {
  const { t } = useTranslation();
  return (
    <ErrorBannerProvider>
      <header className="app-header">
        <Link to="/" className="app-header__title">
          {t('app.title')}
        </Link>
        <LanguageSwitcher />
      </header>
      <ErrorBanner />
      <main className="app-main">
        <Outlet />
      </main>
    </ErrorBannerProvider>
  );
}
