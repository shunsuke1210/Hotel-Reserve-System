import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './client';
import { createQueryClient, shouldRetryQuery } from './query-client';

describe('API の結果の取得と保持の既定（TanStack Query）', () => {
  it('業務エラー・入力の誤り（4xx）は再試行せず、通信の失敗とサーバーの障害（5xx）は1回だけ再試行する', () => {
    const forbidden = new ApiRequestError(403, { code: 'FORBIDDEN', message: '権限がありません' });
    const network = new ApiRequestError(0, { code: 'INTERNAL', message: '通信できませんでした' });
    const server = new ApiRequestError(500, { code: 'INTERNAL', message: '障害' });

    expect(shouldRetryQuery(0, forbidden)).toBe(false);
    expect(shouldRetryQuery(0, network)).toBe(true);
    expect(shouldRetryQuery(1, network)).toBe(false);
    expect(shouldRetryQuery(0, server)).toBe(true);
    expect(shouldRetryQuery(1, server)).toBe(false);
  });

  it('状態を変える操作（mutation）は自動では再試行しない', () => {
    const client = createQueryClient();

    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
    expect(client.getDefaultOptions().queries?.retry).toBe(shouldRetryQuery);
  });
});
