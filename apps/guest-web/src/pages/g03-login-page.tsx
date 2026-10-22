// G03 ログイン。入力項目とログインの処理はタスク 8.2 で作る
// （ログインの後は routing/login-redirect.ts の useReturnTo で元の画面へ戻る）
import { useTranslation } from 'react-i18next';

export function G03LoginPage() {
  const { t } = useTranslation('auth');
  return (
    <section>
      <h1>{t('login.title')}</h1>
    </section>
  );
}
