// 公開用 API（GuestApp）の呼び出し。入出力の型とエラーの形は契約（@hotel/contracts）を使う。
// - 画面で選んだ言語を Accept-Language で送る（設計の補足 L-11。API はその言語でエラーの文言を作る）
// - 状態を変える要求には、他サイトからの要求を拒むための独自のヘッダーを付ける（設計の補足 L-3）
// - エラーの応答は ApiError として読み、UNAUTHENTICATED ならログイン画面へ移す処理を呼ぶ（Error Handling）
import { ApiErrorSchema, type ApiError, type ErrorCode, type Locale } from '@hotel/contracts';

/** 公開用 API の接頭辞（本番は公開用 nginx、開発中は Vite の開発用サーバーが同じオリジンで中継する） */
export const GUEST_API_BASE_URL = '/api/guest';

/** 他サイトからの要求を拒むための独自のヘッダー（設計の補足 L-3） */
export const CSRF_HEADER_NAME = 'X-Requested-With';
export const CSRF_HEADER_VALUE = 'XMLHttpRequest';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const STATE_CHANGING_METHODS: ReadonlySet<HttpMethod> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** API が返したエラー（通信できなかったときは status が 0） */
export class ApiRequestError extends Error {
  override readonly name = 'ApiRequestError';

  constructor(
    readonly status: number,
    readonly apiError: ApiError,
  ) {
    super(apiError.message);
  }

  get code(): ErrorCode {
    return this.apiError.code;
  }
}

/** 応答の検証（契約の zod スキーマをそのまま渡せる） */
export interface ResponseSchema<T> {
  parse(data: unknown): T;
}

export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions<T> {
  /** クエリ文字列にする値（undefined の項目は送らない） */
  query?: Record<string, QueryValue>;
  /** JSON にして送る本文 */
  body?: unknown;
  /** 成功の応答の検証 */
  schema?: ResponseSchema<T>;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /** いま画面で選んでいる言語 */
  getLocale: () => Locale;
  /** UNAUTHENTICATED（ログインしていない・ログイン切れ）を受け取ったときの処理 */
  onUnauthenticated?: (error: ApiRequestError) => void;
  /** ApiError の形の応答がないときの文言（選んだ言語） */
  fallbackMessages: {
    network: () => string;
    unexpected: () => string;
  };
}

export interface ApiClient {
  request<T = unknown>(method: HttpMethod, path: string, options?: RequestOptions<T>): Promise<T>;
  get<T = unknown>(path: string, options?: Omit<RequestOptions<T>, 'body'>): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, options?: RequestOptions<T>): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, options?: RequestOptions<T>): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, options?: RequestOptions<T>): Promise<T>;
  delete<T = unknown>(path: string, options?: RequestOptions<T>): Promise<T>;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.append(key, String(value));
  }
  const search = params.toString();
  return `${baseUrl}${path}${search ? `?${search}` : ''}`;
}

/** 要求の取り消し（DOMException の AbortError。実行環境によって Error を継承しないため名前で判定する） */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : undefined;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchFn = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function toApiRequestError(response: Response): Promise<ApiRequestError> {
    const body = await readJson(response).catch(() => undefined);
    const parsed = ApiErrorSchema.safeParse(body);
    return new ApiRequestError(
      response.status,
      parsed.success
        ? parsed.data
        : { code: 'INTERNAL', message: options.fallbackMessages.unexpected() },
    );
  }

  async function request<T>(
    method: HttpMethod,
    path: string,
    { query, body, schema, signal }: RequestOptions<T> = {},
  ): Promise<T> {
    const headers = new Headers({
      Accept: 'application/json',
      'Accept-Language': options.getLocale(),
    });
    if (STATE_CHANGING_METHODS.has(method)) headers.set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);
    if (body !== undefined) headers.set('Content-Type', 'application/json');

    let response: Response;
    try {
      response = await fetchFn(buildUrl(options.baseUrl, path, query), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new ApiRequestError(0, {
        code: 'INTERNAL',
        message: options.fallbackMessages.network(),
      });
    }

    if (!response.ok) {
      const error = await toApiRequestError(response);
      if (error.code === 'UNAUTHENTICATED') options.onUnauthenticated?.(error);
      throw error;
    }

    const data = await readJson(response);
    return schema ? schema.parse(data) : (data as T);
  }

  return {
    request,
    get: (path, requestOptions) => request('GET', path, requestOptions),
    post: (path, body, requestOptions) => request('POST', path, { ...requestOptions, body }),
    put: (path, body, requestOptions) => request('PUT', path, { ...requestOptions, body }),
    patch: (path, body, requestOptions) => request('PATCH', path, { ...requestOptions, body }),
    delete: (path, requestOptions) => request('DELETE', path, requestOptions),
  };
}
