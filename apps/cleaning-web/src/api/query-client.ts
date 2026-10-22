// API の結果の取得と保持（TanStack Query）の既定
import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from './client';

/**
 * 取得（query）の再試行の判定。業務エラー・入力の誤り（4xx）はやり直しても結果が変わらないので再試行せず、
 * 通信の失敗とサーバーの障害（5xx）だけを1回再試行する。
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery },
      // 状態を変える操作（予約・決済など）は、二重の処理を避けるため自動では再試行しない
      mutations: { retry: false },
    },
  });
}
