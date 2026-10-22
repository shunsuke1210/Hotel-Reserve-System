import type { Locale } from '@hotel/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useNavigate } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError, createApiClient } from '../api/client';
import { createI18n } from '../i18n/i18n';
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

function renderWithBanner(run: () => Promise<unknown>, locale: Locale = 'ja') {
  render(
    <I18nextProvider i18n={createI18n(locale)}>
      <MemoryRouter initialEntries={['/']}>
        <ErrorBannerProvider>
          <ErrorBanner />
          <Probe run={run} />
        </ErrorBannerProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const reject = (error: unknown) => () => Promise.reject(error);

describe('エラーの帯（画面上部）', () => {
  it('API が返した業務エラーの文言（ApiError.message）を帯に表示する', async () => {
    const api = createApiClient({
      baseUrl: '/api/guest',
      fetch: vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              code: 'HOLD_ALREADY_EXISTS',
              message: 'お支払いが済んでいない予約があります',
            }),
            { status: 409 },
          ),
      ),
      getLocale: () => 'ja',
      fallbackMessages: { network: () => '', unexpected: () => '' },
    });
    renderWithBanner(() => api.post('/reservations/holds', { rooms: 1 }));

    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '実行' }));

    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('お支払いが済んでいない予約があります');
  });

  it('ApiError でない想定外のエラーは、選んだ言語の汎用の文言で表示する', async () => {
    renderWithBanner(reject(new Error('boom')), 'en');

    fireEvent.click(screen.getByRole('button', { name: '実行' }));

    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain(
      'A system error occurred. Please wait a moment and try again.',
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

  it('閉じるボタンで帯を消す', async () => {
    renderWithBanner(
      reject(new ApiRequestError(429, { code: 'RATE_LIMITED', message: '時間をおいてください' })),
    );
    fireEvent.click(screen.getByRole('button', { name: '実行' }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('別の画面へ移ると、前の画面のエラーの帯は消える', async () => {
    renderWithBanner(
      reject(new ApiRequestError(409, { code: 'HOLD_EXPIRED', message: '時間切れです' })),
    );
    fireEvent.click(screen.getByRole('button', { name: '実行' }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: '移動' }));

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
