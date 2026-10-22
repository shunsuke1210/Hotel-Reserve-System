import { LOCALES, type Locale } from '@hotel/contracts';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App, createGuestApp, type GuestAppOptions } from './app';
import { LOCALE_STORAGE_KEY } from './i18n/locale';

/** トップ画面（G01 空室検索）の見出し */
const TOP_HEADINGS: Record<Locale, string> = {
  ja: '空室検索',
  en: 'Search for Rooms',
  ko: '빈 객실 검색',
  'zh-Hans': '查询空房',
  'zh-Hant': '查詢空房',
};

/** 画面の名前（ヘッダー・ブラウザのタブ） */
const APP_TITLES: Record<Locale, string> = {
  ja: '宿泊予約',
  en: 'Hotel Reservations',
  ko: '숙박 예약',
  'zh-Hans': '住宿预订',
  'zh-Hant': '住宿預訂',
};

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

function renderGuestApp(options: Partial<GuestAppOptions> = {}) {
  const app = createGuestApp({
    initialEntries: ['/'],
    fetch: vi.fn<typeof fetch>(),
    storage: memoryStorage(),
    browserLanguages: ['ja-JP'],
    ...options,
  });
  render(<App app={app} />);
  return app;
}

const topHeading = () => screen.getByRole('heading', { level: 1 });
const languageSelect = () => screen.getByRole('combobox');

describe('宿泊客アプリの土台', () => {
  it('起動するとトップ画面（G01）を日本語で表示する', () => {
    renderGuestApp();

    expect(topHeading().textContent).toBe('空室検索');
    expect(screen.getByRole('banner').textContent).toContain('宿泊予約');
  });

  it('[16.1] 画面の右上で、5つの言語（日本語・English・한국어・简体中文・繁體中文）を選べる', () => {
    renderGuestApp();

    const options = within(languageSelect()).getAllByRole('option') as HTMLOptionElement[];
    expect(options.map((option) => [option.value, option.textContent])).toEqual([
      ['ja', '日本語'],
      ['en', 'English'],
      ['ko', '한국어'],
      ['zh-Hans', '简体中文'],
      ['zh-Hant', '繁體中文'],
    ]);
    expect(within(screen.getByRole('banner')).getByRole('combobox')).toBe(languageSelect());
  });

  it('[16.1] 言語を切り替えると、トップ画面の見出しと画面の名前がその言語になり、日本語に戻せる', async () => {
    renderGuestApp();

    for (const locale of [...LOCALES.filter((l) => l !== 'ja'), 'ja'] as const) {
      fireEvent.change(languageSelect(), { target: { value: locale } });

      expect(
        await screen.findByRole('heading', { level: 1, name: TOP_HEADINGS[locale] }),
        locale,
      ).toBeDefined();
      expect(screen.getByRole('banner').textContent, locale).toContain(APP_TITLES[locale]);
      expect((languageSelect() as HTMLSelectElement).value).toBe(locale);
      expect(document.documentElement.lang).toBe(locale);
      expect(document.title).toBe(APP_TITLES[locale]);
    }
  });

  it('[16.1] 選んだ言語を覚えておき、次に開いたときもその言語で表示する', async () => {
    const storage = memoryStorage();
    renderGuestApp({ storage });

    fireEvent.change(languageSelect(), { target: { value: 'ko' } });
    await screen.findByRole('heading', { level: 1, name: TOP_HEADINGS.ko });
    expect(storage.setItem).toHaveBeenCalledWith(LOCALE_STORAGE_KEY, 'ko');

    cleanup();
    renderGuestApp({ storage, browserLanguages: ['en-US'] });
    expect(topHeading().textContent).toBe(TOP_HEADINGS.ko);
  });

  it('[16.1] 言語を選んでいなければ、ブラウザの言語で表示する', () => {
    renderGuestApp({ browserLanguages: ['zh-TW', 'en'] });

    expect(topHeading().textContent).toBe(TOP_HEADINGS['zh-Hant']);
    expect(document.documentElement.lang).toBe('zh-Hant');
  });

  it('[16.1] 端末の保存領域が使えなくても（プライベートモードなど）、言語を切り替えられる', async () => {
    const storage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    renderGuestApp({ storage });

    fireEvent.change(languageSelect(), { target: { value: 'en' } });

    expect(await screen.findByRole('heading', { level: 1, name: TOP_HEADINGS.en })).toBeDefined();
  });
});
