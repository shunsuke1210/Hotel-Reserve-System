import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App, createCleaningApp } from '../app';
import { LOGIN_PATH, loginPathFor, readReturnTo, useReturnTo } from './login-redirect';

function unauthenticatedFetch() {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ code: 'UNAUTHENTICATED', message: 'ログインしてください' }), {
        status: 401,
      }),
  );
}

describe('ログイン切れのときにログイン画面（C01）へ移り、ログインの後に元の画面へ戻る', () => {
  it('戻る画面をログイン画面の URL に入れ、そこから取り出す', () => {
    expect(LOGIN_PATH).toBe('/login');
    expect(loginPathFor('/?floor=5')).toBe('/login?returnTo=%2F%3Ffloor%3D5');
    expect(readReturnTo('?returnTo=%2F%3Ffloor%3D5')).toBe('/?floor=5');
    expect(readReturnTo('')).toBe('/');
  });

  it.each([
    'https://evil.example/',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
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
  ])('このアプリの中の画面でない戻り先 "%s" には戻らない', (returnTo) => {
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
      <MemoryRouter initialEntries={[loginPathFor('/?floor=5')]}>{children}</MemoryRouter>
    );

    expect(renderHook(() => useReturnTo(), { wrapper }).result.current).toBe('/?floor=5');
  });

  it('API が UNAUTHENTICATED を返すと、ログイン画面へ移り、元の画面を覚えている', async () => {
    const app = createCleaningApp({
      initialEntries: ['/?floor=5'],
      fetch: unauthenticatedFetch(),
    });
    render(<App app={app} />);
    expect(screen.getByRole('heading', { level: 1, name: '清掃状況一覧' })).toBeDefined();

    await expect(app.api.get('/rooms/status-board')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'スタッフログイン' }),
    ).toBeDefined();
    expect(app.router.state.location.pathname).toBe('/login');
    expect(readReturnTo(app.router.state.location.search)).toBe('/?floor=5');
  });

  it('ログイン画面にいるときの UNAUTHENTICATED では、戻る画面を変えない', async () => {
    const app = createCleaningApp({
      initialEntries: [loginPathFor('/?floor=5')],
      fetch: unauthenticatedFetch(),
    });
    render(<App app={app} />);

    await expect(app.api.get('/rooms/status-board')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    expect(app.router.state.location.pathname).toBe('/login');
    expect(readReturnTo(app.router.state.location.search)).toBe('/?floor=5');
  });
});
