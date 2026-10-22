// 画面の文言（要件 16.1・16.2）。文言ファイルは機能ごと・言語ごとに分け、
// 各機能のタスクが自分の機能の文言ファイル（locales/{機能}/{言語}.json）だけを編集できるようにする。
//   common：ヘッダー・言語の切り替え・エラーの帯・時刻の表記など、全画面で共通の文言
//   search：検索（G01・G02）  auth：認証（G03〜G08）  booking：予約（G09〜G12）
//   mypage：マイページ（G13〜G20）
import type { Locale } from '@hotel/contracts';
import authEn from './locales/auth/en.json';
import authJa from './locales/auth/ja.json';
import authKo from './locales/auth/ko.json';
import authZhHans from './locales/auth/zh-Hans.json';
import authZhHant from './locales/auth/zh-Hant.json';
import bookingEn from './locales/booking/en.json';
import bookingJa from './locales/booking/ja.json';
import bookingKo from './locales/booking/ko.json';
import bookingZhHans from './locales/booking/zh-Hans.json';
import bookingZhHant from './locales/booking/zh-Hant.json';
import commonEn from './locales/common/en.json';
import commonJa from './locales/common/ja.json';
import commonKo from './locales/common/ko.json';
import commonZhHans from './locales/common/zh-Hans.json';
import commonZhHant from './locales/common/zh-Hant.json';
import mypageEn from './locales/mypage/en.json';
import mypageJa from './locales/mypage/ja.json';
import mypageKo from './locales/mypage/ko.json';
import mypageZhHans from './locales/mypage/zh-Hans.json';
import mypageZhHant from './locales/mypage/zh-Hant.json';
import searchEn from './locales/search/en.json';
import searchJa from './locales/search/ja.json';
import searchKo from './locales/search/ko.json';
import searchZhHans from './locales/search/zh-Hans.json';
import searchZhHant from './locales/search/zh-Hant.json';

export const NAMESPACES = ['common', 'search', 'auth', 'booking', 'mypage'] as const;
export type Namespace = (typeof NAMESPACES)[number];
export const DEFAULT_NAMESPACE = 'common' satisfies Namespace;

/** 日本語の文言を基準の形とし、ほかの言語も同じ項目を持つ（型の検査で項目の抜けを見つける） */
const ja = {
  common: commonJa,
  search: searchJa,
  auth: authJa,
  booking: bookingJa,
  mypage: mypageJa,
};
export type Messages = typeof ja;

export const resources: Record<Locale, Messages> = {
  ja,
  en: { common: commonEn, search: searchEn, auth: authEn, booking: bookingEn, mypage: mypageEn },
  ko: { common: commonKo, search: searchKo, auth: authKo, booking: bookingKo, mypage: mypageKo },
  'zh-Hans': {
    common: commonZhHans,
    search: searchZhHans,
    auth: authZhHans,
    booking: bookingZhHans,
    mypage: mypageZhHans,
  },
  'zh-Hant': {
    common: commonZhHant,
    search: searchZhHant,
    auth: authZhHant,
    booking: bookingZhHant,
    mypage: mypageZhHant,
  },
};
