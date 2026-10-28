// 1つの要求の文言の言語（ApiError.message の言語。設計の補足 L-11）。
// - 社内用 API：常に日本語（スタッフ向けは日本語だけ。要件 16.6）
// - 公開用 API：ログイン中は会員の preferred_locale（MemberAuthGuard が要求の文脈に入れる）、
//   ログインしていなければ Accept-Language
// 業務のコード（メールの言語など）でも要求の言語が要るときは、この関数を使う。
import type { Locale } from '@hotel/contracts';
import type { Request } from 'express';
import { findRequestContext } from '../logging/request-context.js';
import { DEFAULT_LOCALE, negotiateLocale } from './locale.js';

export function requestLocale(req: Request): Locale {
  const context = findRequestContext(req);
  if (!context || context.listener === 'staff') return DEFAULT_LOCALE;
  return context.preferredLocale ?? negotiateLocale(req.headers['accept-language']);
}
