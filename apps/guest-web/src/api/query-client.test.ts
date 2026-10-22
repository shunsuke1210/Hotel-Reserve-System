import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './client';
import { createQueryClient, shouldRetryQuery } from './query-client';

describe('API の結果の取得と保持の既定（TanStack Query）', () => {
  it('業務エラー・入力の誤り（4xx）は、やり直しても結果が変わらないので再試行しない', () => {
    const error = new ApiRequestError(409, {
      code: 'NO_AVAILABILITY',
      message: '空室がありません',
    });

    expect(shouldRetryQuery(0, error)).toBe(false);
  });

  it('通信の失敗とサーバーの障害（5xx）は、1回だけ再試行する', () => {
    const network = new ApiRequestError(0, { code: 'INTERNAL', message: '通信できませんでした' });
    const server = new ApiRequestError(503, {
      code: 'PAYMENT_GATEWAY_UNAVAILABLE',
      message: '決済サービスに接続できません',
    });

    expect(shouldRetryQuery(0, network)).toBe(true);
    expect(shouldRetryQuery(1, network)).toBe(false);
    expect(shouldRetryQuery(0, server)).toBe(true);
    expect(shouldRetryQuery(1, server)).toBe(false);
  });

  it('状態を変える操作（mutation）は、二重の処理を避けるため自動では再試行しない', () => {
    const client = createQueryClient();

    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
    expect(client.getDefaultOptions().queries?.retry).toBe(shouldRetryQuery);
  });
});
