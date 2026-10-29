// 5言語のメールの文面（要件 16.2：メールの定型文を選んだ言語で表示する。design.md P-15：テンプレートは5言語分）。
import type { Locale } from '@hotel/contracts';
import { en } from './en.js';
import { ja } from './ja.js';
import { ko } from './ko.js';
import type { MailCatalog } from './types.js';
import { zhHans } from './zh-hans.js';
import { zhHant } from './zh-hant.js';

export const MAIL_CATALOGS: Readonly<Record<Locale, MailCatalog>> = {
  ja,
  en,
  ko,
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
};
