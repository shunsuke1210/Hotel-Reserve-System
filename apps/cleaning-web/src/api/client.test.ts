import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, STAFF_API_BASE_URL, createApiClient } from './client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(
  respond: () => Response | Promise<Response> = () => jsonResponse(200, { ok: true }),
) {
  const fetchMock = vi.fn<typeof fetch>(async () => respond());
  const onUnauthenticated = vi.fn();
  const client = createApiClient({ fetch: fetchMock, onUnauthenticated });
  const sent = (n = 0) => {
    const call = fetchMock.mock.calls[n];
    if (!call) throw new Error(`${n} 回目の要求がありません`);
    const [url, init = {}] = call;
    return {
      url: String(url),
      method: init.method,
      headers: new Headers(init.headers),
      body: init.body,
      credentials: init.credentials,
    };
  };
  return { client, onUnauthenticated, sent };
}

describe('社内用 API の呼び出し（api/client.ts）', () => {
  it('社内用 API の接頭辞の下の URL に、本文を JSON で、Cookie を同じオリジンだけで送る', async () => {
    const { client, sent } = setup();

    await client.post('/reservations/42/check-in', { note: 'x' });

    expect(STAFF_API_BASE_URL).toBe('/api/staff');
    expect(sent().url).toBe('/api/staff/reservations/42/check-in');
    expect(sent().headers.get('Content-Type')).toBe('application/json');
    expect(sent().body).toBe(JSON.stringify({ note: 'x' }));
    expect(sent().credentials).toBe('same-origin');
  });

  it('[16.6] スタッフ向けは日本語だけなので、言語（Accept-Language）を指定しない', async () => {
    const { client, sent } = setup();

    await client.get('/rooms/status-board', { query: { date: '2026-11-01' } });

    expect(sent().url).toBe('/api/staff/rooms/status-board?date=2026-11-01');
    expect(sent().headers.has('Accept-Language')).toBe(false);
  });

  it('状態を変える要求（POST・PUT・PATCH・DELETE）にだけ X-Requested-With: XMLHttpRequest を付ける（設計の補足 L-3）', async () => {
    const { client, sent } = setup();

    await client.get('/notices');
    await client.post('/notices/1/resolve');
    await client.put('/reservations/1/roster', []);
    await client.patch('/special-surcharges/1', { rateBp: 1000 });
    await client.delete('/special-surcharges/1');

    expect(sent(0).headers.has('X-Requested-With')).toBe(false);
    for (const [n, method] of [
      [1, 'POST'],
      [2, 'PUT'],
      [3, 'PATCH'],
      [4, 'DELETE'],
    ] as const) {
      expect(sent(n).method).toBe(method);
      expect(sent(n).headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    }
  });

  it('エラーの応答を契約のエラーの形（ApiError）として読み、HTTP ステータスと一緒に投げる', async () => {
    const { client } = setup(() =>
      jsonResponse(403, { code: 'FORBIDDEN', message: '権限がありません' }),
    );

    const error = (await client
      .get('/rooms/status-board')
      .catch((e: unknown) => e)) as ApiRequestError;

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
    expect(error.apiError).toEqual({ code: 'FORBIDDEN', message: '権限がありません' });
  });

  it('ApiError の形でない応答と通信の失敗は、日本語の汎用の文言にする', async () => {
    const badGateway = setup(() => new Response('<html>502</html>', { status: 502 }));
    const offline = setup(() => {
      throw new TypeError('Failed to fetch');
    });

    const e1 = (await badGateway.client
      .get('/rooms/status-board')
      .catch((e: unknown) => e)) as ApiRequestError;
    const e2 = (await offline.client
      .get('/rooms/status-board')
      .catch((e: unknown) => e)) as ApiRequestError;

    expect(e1.status).toBe(502);
    expect(e1.apiError).toEqual({
      code: 'INTERNAL',
      message: 'システムでエラーが発生しました。しばらく時間をおいてから、もう一度お試しください',
    });
    expect(e2.status).toBe(0);
    expect(e2.apiError).toEqual({
      code: 'INTERNAL',
      message: '通信できませんでした。接続を確認して、もう一度お試しください',
    });
  });

  it('要求の取り消し（AbortError）は、そのまま投げる', async () => {
    const { client } = setup(() => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });

    const error = await client.get('/rooms/status-board').catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(ApiRequestError);
    expect((error as Error).name).toBe('AbortError');
  });

  it('本文のない応答（204）は undefined を返す', async () => {
    const { client } = setup(() => new Response(null, { status: 204 }));

    await expect(client.post('/auth/logout')).resolves.toBeUndefined();
  });

  it('UNAUTHENTICATED（ログイン切れ）のときだけ、ログイン画面へ移す処理を呼ぶ', async () => {
    const expired = setup(() =>
      jsonResponse(401, { code: 'UNAUTHENTICATED', message: 'ログインしてください' }),
    );
    const wrongPassword = setup(() =>
      jsonResponse(401, {
        code: 'INVALID_CREDENTIALS',
        message: 'スタッフ番号またはパスワードが違います',
      }),
    );

    const error = await expired.client.get('/rooms/status-board').catch((e: unknown) => e);
    await wrongPassword.client.post('/auth/login', { staffNumber: 'S101' }).catch(() => undefined);

    expect(expired.onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(expired.onUnauthenticated).toHaveBeenCalledWith(error);
    expect(wrongPassword.onUnauthenticated).not.toHaveBeenCalled();
  });
});
