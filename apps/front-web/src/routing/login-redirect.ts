// ログイン切れのときの画面の移り方（design.md Error Handling の UNAUTHENTICATED、
// design-screens.md 共通の約束「ログイン画面に移り、ログイン後に元の画面に戻る」）。
// 戻る画面はログイン画面の URL（?returnTo=）に入れる。ページを読み込み直しても失われない。
import { useSearchParams, type DataRouter } from 'react-router';

/** ログイン画面（F01） */
export const LOGIN_PATH = '/login';
export const RETURN_TO_PARAM = 'returnTo';
const DEFAULT_RETURN_TO = '/';

/** ログインの後に returnTo へ戻る、ログイン画面の URL */
export function loginPathFor(returnTo: string): string {
  return `${LOGIN_PATH}?${new URLSearchParams({ [RETURN_TO_PARAM]: returnTo }).toString()}`;
}

/** 戻り先がこのアプリの中の画面かを確かめるときに、基準にする仮のオリジン */
const PLACEHOLDER_ORIGIN = 'http://app.invalid';

/**
 * 戻り先に認めない文字：ASCII の制御文字・空白・「\」。
 * ブラウザは URL を読むときに制御文字（タブ・改行など）を取り除き、「\」を「/」と同じに扱うため、
 * 「/<タブ>/evil.example」のような値がほかのサイトの URL（//evil.example）になる。
 */
const UNSAFE_CHARACTERS = /[\u0000- \u007f\\]/;

/**
 * 戻り先が、このアプリの中の画面ならその URL（パス・クエリ・フラグメント）を返し、そうでなければ null を返す。
 * ほかのサイトへ移す URL を戻り先にさせないため、「/」で始まり、認めない文字を含まず、
 * 仮のオリジンを基準に URL として読んでもオリジンが変わらないものだけを認める。
 * さらに、読んだ後の URL が「//」「/\」で始まるもの（「/.//evil.example」のように「.」「..」が
 * 取り除かれて、ほかのサイトを指す URL になったもの）も認めない。
 */
function toInternalPath(candidate: string): string | null {
  if (!candidate.startsWith('/') || UNSAFE_CHARACTERS.test(candidate)) return null;
  let url: URL;
  try {
    url = new URL(candidate, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (path.startsWith('//') || path.startsWith('/\\')) return null;
  return path;
}

/** ログイン画面の URL のクエリ文字列から、ログインの後に戻る画面を取り出す（なければトップ画面） */
export function readReturnTo(search: string | URLSearchParams): string {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const returnTo = params.get(RETURN_TO_PARAM);
  return (returnTo !== null && toInternalPath(returnTo)) || DEFAULT_RETURN_TO;
}

/** ログイン画面で、ログインの後に戻る画面を取り出す */
export function useReturnTo(): string {
  const [searchParams] = useSearchParams();
  return readReturnTo(searchParams);
}

/** いまの画面を戻り先として覚えて、ログイン画面へ移る（すでにログイン画面にいるときは何もしない） */
export function redirectToLogin(router: Pick<DataRouter, 'state' | 'navigate'>): void {
  const { pathname, search, hash } = router.state.location;
  if (pathname === LOGIN_PATH) return;
  void router.navigate(loginPathFor(`${pathname}${search}${hash}`), { replace: true });
}
