import { act, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../i18n/i18n';
import { JapanTime, LocalDate, LocalNumber } from './formatted';

const DEADLINE = new Date('2026-11-18T06:00:00Z'); // 2026-11-18 15:00（日本時間）

describe('日付・数字・時刻の表示の共通部品', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'America/New_York');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('[16.3] 時刻を日本時間で表示し、横に「日本時間」の表記を選んだ言語で付ける', async () => {
    const i18n = createI18n('en');
    render(
      <I18nextProvider i18n={i18n}>
        <p data-testid="deadline">
          <JapanTime value={DEADLINE} />
        </p>
      </I18nextProvider>,
    );

    expect(screen.getByTestId('deadline').textContent).toBe('15:00 (Japan time)');
    expect(screen.getByTestId('deadline').querySelector('time')?.dateTime).toBe(
      '2026-11-18T06:00:00.000Z',
    );

    await act(() => i18n.changeLanguage('ja'));
    expect(screen.getByTestId('deadline').textContent).toBe('15:00（日本時間）');

    await act(() => i18n.changeLanguage('ko'));
    expect(screen.getByTestId('deadline').textContent).toBe('15:00 (일본 시간)');

    await act(() => i18n.changeLanguage('zh-Hans'));
    expect(screen.getByTestId('deadline').textContent).toBe('15:00（日本时间）');

    await act(() => i18n.changeLanguage('zh-Hant'));
    expect(screen.getByTestId('deadline').textContent).toBe('15:00（日本時間）');
  });

  it('[16.3] 日付と時刻をまとめた表示にも「日本時間」の表記を付ける', () => {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <p data-testid="deadline">
          <JapanTime value={DEADLINE} withDate />
        </p>
      </I18nextProvider>,
    );

    expect(screen.getByTestId('deadline').textContent).toBe(
      'Wed, Nov 18, 2026, 15:00 (Japan time)',
    );
  });

  it('[16.3] 宿泊日と数字を、選んだ言語の書き方で表示し、言語を切り替えると書き方が変わる', async () => {
    const i18n = createI18n('ko');
    render(
      <I18nextProvider i18n={i18n}>
        <p data-testid="arrival">
          <LocalDate value="2026-05-31" />
        </p>
        <p data-testid="total">
          <LocalNumber value={61900} />
        </p>
      </I18nextProvider>,
    );

    expect(screen.getByTestId('arrival').textContent).toBe('2026년 5월 31일 (일)');
    expect(screen.getByTestId('arrival').querySelector('time')?.dateTime).toBe('2026-05-31');
    expect(screen.getByTestId('total').textContent).toBe('61,900');

    await act(() => i18n.changeLanguage('en'));
    expect(screen.getByTestId('arrival').textContent).toBe('Sun, May 31, 2026');
  });
});
