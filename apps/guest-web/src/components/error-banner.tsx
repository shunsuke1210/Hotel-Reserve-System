// エラーの帯（design-screens.md 共通の約束「業務エラーは画面上部の帯で表示する」）。
// - API の業務エラーは、API が選んだ言語で作った文言（ApiError.message）をそのまま表示する
// - ApiError でない想定外のエラーは、汎用の文言を選んだ言語で表示する（エラーの中身は画面に出さない）
// - UNAUTHENTICATED はログイン画面へ移すので表示しない
// - 帯は、表示したときの画面にだけ出す（別の画面へ移ると消える）
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { ApiRequestError } from '../api/client';

type BannerContent = { kind: 'message'; message: string } | { kind: 'unexpected' };

interface BannerState {
  content: BannerContent;
  /** 表示したときの画面（履歴の項目） */
  locationKey: string;
}

export interface ErrorBannerControls {
  /** 失敗した処理のエラーを帯に表示する */
  showError: (error: unknown) => void;
  /** 文言を帯に表示する */
  showMessage: (message: string) => void;
  clear: () => void;
}

interface ErrorBannerContextValue extends ErrorBannerControls {
  content: BannerContent | null;
}

const ErrorBannerContext = createContext<ErrorBannerContextValue | null>(null);

function toBannerContent(error: unknown): BannerContent | null {
  if (error instanceof ApiRequestError) {
    if (error.code === 'UNAUTHENTICATED') return null;
    return { kind: 'message', message: error.apiError.message };
  }
  return { kind: 'unexpected' };
}

export function ErrorBannerProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [state, setState] = useState<BannerState | null>(null);

  const show = useCallback(
    (content: BannerContent | null) => {
      if (content) setState({ content, locationKey: location.key });
    },
    [location.key],
  );
  const showError = useCallback((error: unknown) => show(toBannerContent(error)), [show]);
  const showMessage = useCallback((message: string) => show({ kind: 'message', message }), [show]);
  const clear = useCallback(() => setState(null), []);

  const content = state && state.locationKey === location.key ? state.content : null;
  const value = useMemo(
    () => ({ content, showError, showMessage, clear }),
    [content, showError, showMessage, clear],
  );
  return <ErrorBannerContext.Provider value={value}>{children}</ErrorBannerContext.Provider>;
}

function useErrorBannerContext(): ErrorBannerContextValue {
  const value = useContext(ErrorBannerContext);
  if (!value) throw new Error('エラーの帯は ErrorBannerProvider の中で使ってください');
  return value;
}

export function useErrorBanner(): ErrorBannerControls {
  const { showError, showMessage, clear } = useErrorBannerContext();
  return useMemo(() => ({ showError, showMessage, clear }), [showError, showMessage, clear]);
}

export function ErrorBanner() {
  const { content, clear } = useErrorBannerContext();
  const { t } = useTranslation();
  if (!content) return null;

  return (
    <div className="error-banner" role="alert">
      <p className="error-banner__message">
        {content.kind === 'message' ? content.message : t('errors.unexpected')}
      </p>
      <button type="button" className="error-banner__close" onClick={clear}>
        {t('errorBanner.close')}
      </button>
    </div>
  );
}
