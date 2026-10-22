import { FORBIDDEN_MESSAGE } from '@hotel/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, createApiClient } from '../api/client';
import { ErrorBanner, ErrorBannerProvider, useErrorBanner } from './error-banner';

/** ボタンを押すと、渡した処理の失敗をエラーの帯に出す。別のボタンで別の画面へ移る */
function Probe({ run }: { run: () => Promise<unknown> }) {
  const { showError } = useErrorBanner();
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => void run().catch(showError)}>
        実行
      </button>
      <button type="button" onClick={() => void navigate('/other')}>
        移動
      </button>
    </>
  );
}

function renderWithBanner(run: () => Promise<unknown>) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ErrorBannerProvider>
        <ErrorBanner />
        <Probe run={run} />
      </ErrorBannerProvider>
    </MemoryRouter>,
  );
}

const reject = (error: unknown) => () => Promise.reject(error);

describe('エラーの帯（画面上部）', () => {
  it('[16.6] 権限のない操作（FORBIDDEN）では、API の文言「権限がありません」を帯に表示する', async () => {
    const api = createApiClient({
      fetch: vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE }), {
            status: 403,
          }),
      ),
    });
    renderWithBanner(() => api.post('/rooms/1/status', { to: 'CLEAN' }));

    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '実行' }));

    expect((await screen.findByRole('alert')).textContent).toContain('権限がありません');
  });

  it('[16.6] ApiError でない想定外のエラーは、日本語の汎用の文言で表示する（エラーの中身は出さない）', async () => {
    renderWithBanner(reject(new Error('boom')));

    fireEvent.click(screen.getByRole('button', { name: '実行' }));

    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain(
      'システムでエラーが発生しました。しばらく時間をおいてから、もう一度お試しください',
    );
    expect(banner.textContent).not.toContain('boom');
  });

  it('UNAUTHENTICATED はログイン画面へ移すので、帯には出さない', async () => {
    renderWithBanner(
      reject(
        new ApiRequestError(401, { code: 'UNAUTHENTICATED', message: 'ログインしてください' }),
      ),
    );

    // 失敗の処理（catch で帯に渡す処理）が終わるまで待ち、画面の更新を反映してから確かめる
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '実行' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('閉じるボタン、または別の画面へ移ると、帯を消す', async () => {
    renderWithBanner(
      reject(
        new ApiRequestError(409, { code: 'ROOM_OCCUPIED', message: '移し先の部屋は使用中です' }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '実行' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '実行' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '移動' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
