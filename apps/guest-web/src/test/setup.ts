// テストごとに、描画した画面を片付ける（vitest の globals を使わないため、自動では片付かない）
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
