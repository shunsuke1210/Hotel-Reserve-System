import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import indexHtml from '../index.html?raw';
import { App, createCleaningApp } from './app';

function renderCleaningApp() {
  const app = createCleaningApp({ initialEntries: ['/'], fetch: vi.fn<typeof fetch>() });
  render(<App app={app} />);
  return app;
}

describe('清掃アプリの土台', () => {
  it('起動するとトップ画面（C02 清掃状況一覧）を表示する', () => {
    renderCleaningApp();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('清掃状況一覧');
    expect(screen.getByRole('banner').textContent).toContain('予約管理（清掃）');
  });

  it('[16.6] ブラウザの言語が英語でも日本語だけで表示し、言語の切り替えはない', () => {
    expect(navigator.language).toBe('en-US');

    renderCleaningApp();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('清掃状況一覧');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(indexHtml).toContain('<html lang="ja">');
    expect(indexHtml).toContain('<title>予約管理（清掃）</title>');
  });
});
