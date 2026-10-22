// 文言の項目名を型で検査する（存在しない項目を t() に渡すと型の検査で誤りになる）
import 'i18next';
import type { DEFAULT_NAMESPACE, Messages } from './resources';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof DEFAULT_NAMESPACE;
    resources: Messages;
  }
}
