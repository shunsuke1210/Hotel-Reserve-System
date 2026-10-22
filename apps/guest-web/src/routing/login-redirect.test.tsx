import { renderHook, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App, createGuestApp } from '../app';
import { LOGIN_PATH, loginPathFor, readReturnTo, useReturnTo } from './login-redirect';

function unauthenticatedFetch() {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ code: 'UNAUTHENTICATED', message: 'ログインしてください' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
}

describe('ログイン切れのときにログイン画面へ移り、ログインの後に元の画面へ戻る', () => {
  it('ログインの後に戻る画面を、ログイン画面の URL に入れる', () => {
    expect(LOGIN_PATH).toBe('/login');
    expect(loginPathFor('/?arrival=2026-05-31&nights=2')).toBe(
      '/login?returnTo=%2F%3Farrival%3D2026-05-31%26nights%3D2',
    );
  });

  it('戻る画面を URL から読み取る（なければトップ画面）', () => {
    expect(readReturnTo('?returnTo=%2Fmypage%3Ftab%3D1%23r1')).toBe('/mypage?tab=1#r1');
    expect(readReturnTo(new URLSearchParams({ returnTo: '/reservations/42' }))).toBe(
      '/reservations/42',
    );
    expect(readReturnTo('')).toBe('/');
  });

  it.each([
    'https://evil.example/',
    '//evil.example/path',
    '/\\evil.example',
    'javascript:alert(1)',
    'mypage',
    // ASCII の制御文字は、ブラウザが URL を読むときに取り除くため「//」や「/\」と同じになる
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    '/\t\\evil.example',
    // 「.」「..」（%2E を含む）は URL として読むと取り除かれ、「//evil.example」になる
    '/.//evil.example',
    '/..//evil.example',
    '/a/..//evil.example',
    '/%2E//evil.example',
    '/%2e%2e//evil.example',
  ])('このアプリの中の画面でない戻り先 "%s" には戻らない（トップ画面にする）', (returnTo) => {
    expect(readReturnTo(new URLSearchParams({ returnTo }))).toBe('/');
  });

  it.each(['/mypage?tab=1#r1', '/?arrival=2026-05-31&nights=2', '/reservations/42'])(
    'このアプリの中の画面 "%s" は、そのまま戻り先になる',
    (returnTo) => {
      const loginUrl = new URL(loginPathFor(returnTo), 'http://localhost');
      expect(readReturnTo(loginUrl.search)).toBe(returnTo);
    },
  );

  it('ログイン画面の部品は、URL から戻る画面を取り出せる', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[loginPathFor('/mypage?tab=1')]}>{children}</MemoryRouter>
    );

    const { result } = renderHook(() => useReturnTo(), { wrapper });

    expect(result.current).toBe('/mypage?tab=1');
  });

  it('API が UNAUTHENTICATED を返すと、ログイン画面へ移り、元の画面（検索の条件を含む）を覚えている', async () => {
    const app = createGuestApp({
      initialEntries: ['/?arrival=2026-05-31&nights=2'],
      fetch: unauthenticatedFetch(),
      storage: null,
      browserLanguages: ['ja'],
    });
    render(<App app={app} />);
    expect(screen.getByRole('heading', { level: 1, name: '空室検索' })).toBeDefined();

    await expect(app.api.get('/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    expect(await screen.findByRole('heading', { level: 1, name: 'ログイン' })).toBeDefined();
    expect(app.router.state.location.pathname).toBe('/login');
    expect(readReturnTo(app.router.state.location.search)).toBe('/?arrival=2026-05-31&nights=2');
  });

  it('ログイン画面にいるときの UNAUTHENTICATED では、戻る画面を変えない', async () => {
    const app = createGuestApp({
      initialEntries: [loginPathFor('/mypage')],
      fetch: unauthenticatedFetch(),
      storage: null,
      browserLanguages: ['ja'],
    });
    render(<App app={app} />);

    await expect(app.api.get('/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    expect(app.router.state.location.pathname).toBe('/login');
    expect(readReturnTo(app.router.state.location.search)).toBe('/mypage');
  });
});
