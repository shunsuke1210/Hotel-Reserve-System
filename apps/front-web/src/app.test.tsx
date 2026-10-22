import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import indexHtml from '../index.html?raw';
import { App, createFrontApp } from './app';

function renderFrontApp() {
  const app = createFrontApp({ initialEntries: ['/'], fetch: vi.fn<typeof fetch>() });
  render(<App app={app} />);
  return app;
}

describe('フロントアプリの土台', () => {
  it('起動するとトップ画面（F02 予約状況チャート）を表示する', () => {
    renderFrontApp();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('予約状況チャート');
    expect(screen.getByRole('banner').textContent).toContain('予約管理（フロント）');
  });

  it('[16.6] ブラウザの言語が英語でも日本語だけで表示し、言語の切り替えはない', () => {
    expect(navigator.language).toBe('en-US');

    renderFrontApp();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('予約状況チャート');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(indexHtml).toContain('<html lang="ja">');
    expect(indexHtml).toContain('<title>予約管理（フロント）</title>');
  });
});
