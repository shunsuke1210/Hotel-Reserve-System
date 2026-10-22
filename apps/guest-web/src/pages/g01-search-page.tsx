// G01 空室検索（トップ）。入力項目と検索はタスク 8.1 で作る
import { useTranslation } from 'react-i18next';

export function G01SearchPage() {
  const { t } = useTranslation('search');
  return (
    <section>
      <h1>{t('top.title')}</h1>
    </section>
  );
}
