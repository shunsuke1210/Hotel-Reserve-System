// エラーの帯（design-screens.md 共通の約束「業務エラーは画面上部の帯で表示する」）。
// - API の業務エラーは、API が作った日本語の文言（ApiError.message）をそのまま表示する
//   （FORBIDDEN は「権限がありません」。要件 2.4、設計の補足 L-33）
// - ApiError でない想定外のエラーは、汎用の文言を表示する（エラーの中身は画面に出さない）
// - UNAUTHENTICATED はログイン画面へ移すので表示しない
// - 帯は、表示したときの画面にだけ出す（別の画面へ移ると消える）
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { ApiRequestError } from '../api/client';

const UNEXPECTED_ERROR_MESSAGE =
  'システムでエラーが発生しました。しばらく時間をおいてから、もう一度お試しください';

interface BannerState {
  message: string;
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
  message: string | null;
}

const ErrorBannerContext = createContext<ErrorBannerContextValue | null>(null);

function toBannerMessage(error: unknown): string | null {
  if (error instanceof ApiRequestError) {
    return error.code === 'UNAUTHENTICATED' ? null : error.apiError.message;
  }
  return UNEXPECTED_ERROR_MESSAGE;
}

export function ErrorBannerProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [state, setState] = useState<BannerState | null>(null);

  const showMessage = useCallback(
    (message: string) => setState({ message, locationKey: location.key }),
    [location.key],
  );
  const showError = useCallback(
    (error: unknown) => {
      const message = toBannerMessage(error);
      if (message !== null) showMessage(message);
    },
    [showMessage],
  );
  const clear = useCallback(() => setState(null), []);

  const message = state && state.locationKey === location.key ? state.message : null;
  const value = useMemo(
    () => ({ message, showError, showMessage, clear }),
    [message, showError, showMessage, clear],
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
  const { message, clear } = useErrorBannerContext();
  if (message === null) return null;

  return (
    <div className="error-banner" role="alert">
      <p className="error-banner__message">{message}</p>
      <button type="button" className="error-banner__close" onClick={clear}>
        閉じる
      </button>
    </div>
  );
}
