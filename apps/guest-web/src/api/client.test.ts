import { LocaleSchema, type Locale } from '@hotel/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, createApiClient, type ApiClientOptions } from './client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(
  respond: () => Response | Promise<Response> = () => jsonResponse(200, { ok: true }),
  overrides: Partial<ApiClientOptions> = {},
) {
  const fetchMock = vi.fn<typeof fetch>(async () => respond());
  const onUnauthenticated = vi.fn();
  let locale: Locale = 'ja';
  const client = createApiClient({
    baseUrl: '/api/guest',
    fetch: fetchMock,
    getLocale: () => locale,
    onUnauthenticated,
    fallbackMessages: { network: () => '通信できませんでした', unexpected: () => '想定外のエラー' },
    ...overrides,
  });
  /** n 回目（0 から）に送った要求の URL・メソッド・ヘッダー・本文 */
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
  return {
    client,
    fetchMock,
    onUnauthenticated,
    sent,
    setLocale: (next: Locale) => {
      locale = next;
    },
  };
}

describe('公開用 API の呼び出し（api/client.ts）', () => {
  it('[16.1] 選んだ言語を Accept-Language で送り、言語を切り替えると次の要求から変わる（設計の補足 L-11）', async () => {
    const { client, sent, setLocale } = setup();

    await client.get('/availability');
    setLocale('zh-Hant');
    await client.post('/auth/login', { email: 'a@example.com', password: 'x' });

    expect(sent(0).headers.get('Accept-Language')).toBe('ja');
    expect(sent(1).headers.get('Accept-Language')).toBe('zh-Hant');
  });

  it('状態を変える要求（POST・PUT・PATCH・DELETE）にだけ X-Requested-With: XMLHttpRequest を付ける（設計の補足 L-3）', async () => {
    const { client, sent } = setup();

    await client.get('/me');
    await client.post('/reservations/quote', { rooms: 1 });
    await client.put('/me/card', { cardNumber: '4242' });
    await client.patch('/me', { phone: '0312345678' });
    await client.delete('/me/session');

    expect(sent(0).method).toBe('GET');
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

  it('公開用 API の接頭辞の下の URL に、本文を JSON で、Cookie を同じオリジンだけで送る', async () => {
    const { client, sent } = setup();

    await client.post('/reservations/quote', { adults: 2, rooms: 1 });

    expect(sent().url).toBe('/api/guest/reservations/quote');
    expect(sent().headers.get('Content-Type')).toBe('application/json');
    expect(sent().headers.get('Accept')).toBe('application/json');
    expect(sent().body).toBe(JSON.stringify({ adults: 2, rooms: 1 }));
    expect(sent().credentials).toBe('same-origin');
  });

  it('検索の条件をクエリ文字列にし、値のない項目は送らない', async () => {
    const { client, sent } = setup();

    await client.get('/availability', {
      query: { arrival: '2026-05-31', nights: 2, adults: 2, children: 0, coupon: undefined },
    });

    expect(sent().url).toBe(
      '/api/guest/availability?arrival=2026-05-31&nights=2&adults=2&children=0',
    );
  });

  it('成功の応答を、契約（contracts）の zod スキーマで検証した値として返す', async () => {
    const { client } = setup(() => jsonResponse(200, 'ko'));

    const locale: Locale = await client.get('/me/locale', { schema: LocaleSchema });

    expect(locale).toBe('ko');
  });

  it('応答が契約の形と違えば、成功の応答でも失敗にする', async () => {
    const { client } = setup(() => jsonResponse(200, 'fr'));

    await expect(client.get('/me/locale', { schema: LocaleSchema })).rejects.toThrow();
  });

  it('本文のない応答（204）は undefined を返す', async () => {
    const { client } = setup(() => new Response(null, { status: 204 }));

    await expect(client.post('/auth/logout')).resolves.toBeUndefined();
  });

  it('エラーの応答を契約のエラーの形（ApiError）として読み、HTTP ステータスと一緒に投げる', async () => {
    const { client } = setup(() =>
      jsonResponse(422, {
        code: 'OUT_OF_BOOKING_WINDOW',
        message: '365日より先の宿泊は予約できません',
        details: { field: 'arrival' },
      }),
    );

    const error = await client.get('/availability').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    const apiError = error as ApiRequestError;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe('OUT_OF_BOOKING_WINDOW');
    expect(apiError.apiError).toEqual({
      code: 'OUT_OF_BOOKING_WINDOW',
      message: '365日より先の宿泊は予約できません',
      details: { field: 'arrival' },
    });
    expect(apiError.message).toBe('365日より先の宿泊は予約できません');
  });

  it('ApiError の形でないエラーの応答（中継の障害など）は INTERNAL として、想定外のエラーの文言にする', async () => {
    const { client } = setup(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }));

    const error = (await client.get('/me').catch((e: unknown) => e)) as ApiRequestError;

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(502);
    expect(error.apiError).toEqual({ code: 'INTERNAL', message: '想定外のエラー' });
  });

  it('通信できなかったときは、通信の失敗の文言の ApiRequestError を投げる（status は 0）', async () => {
    const { client } = setup(() => {
      throw new TypeError('Failed to fetch');
    });

    const error = (await client.get('/me').catch((e: unknown) => e)) as ApiRequestError;

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(0);
    expect(error.apiError).toEqual({ code: 'INTERNAL', message: '通信できませんでした' });
  });

  it('要求の取り消し（AbortError）は、そのまま投げる', async () => {
    const { client } = setup(() => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });

    const error = await client.get('/me').catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(ApiRequestError);
    expect((error as Error).name).toBe('AbortError');
  });

  it('UNAUTHENTICATED（ログイン切れ）のときは、ログイン画面へ移す処理を呼び、呼び出し元にもエラーを返す', async () => {
    const { client, onUnauthenticated } = setup(() =>
      jsonResponse(401, { code: 'UNAUTHENTICATED', message: 'ログインしてください' }),
    );

    const error = (await client.get('/me').catch((e: unknown) => e)) as ApiRequestError;

    expect(error.code).toBe('UNAUTHENTICATED');
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(onUnauthenticated).toHaveBeenCalledWith(error);
  });

  it('同じ 401 でも INVALID_CREDENTIALS（ログインの失敗）では、ログイン画面へ移す処理を呼ばない', async () => {
    const { client, onUnauthenticated } = setup(() =>
      jsonResponse(401, {
        code: 'INVALID_CREDENTIALS',
        message: 'メールアドレスまたはパスワードが違います',
      }),
    );

    const error = (await client
      .post('/auth/login', { email: 'a@example.com', password: 'x' })
      .catch((e: unknown) => e)) as ApiRequestError;

    expect(error.code).toBe('INVALID_CREDENTIALS');
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });
});
