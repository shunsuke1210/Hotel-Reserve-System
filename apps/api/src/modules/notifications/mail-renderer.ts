// mail_outbox の行（テンプレート・言語・内容）から、送るメールの件名と本文を作る（design.md P-15、要件 15.1・16.2）。
//
// 文面は送るとき（定時処理 outbox）と開発用の一覧（/dev/mails）で、同じ関数で作る（同じ行からは同じ文面になる）。
// 行の内容はデータベースから読んだ値なので、テンプレートの形（mail-templates.ts）で確かめ直す。形が誤っていれば
// MailRenderError（送れなかったものとして数える）。文言には項目の名前だけを書き、値（宛先・トークンなど）は書かない。
import { Injectable } from '@nestjs/common';
import { LocaleSchema } from '@hotel/contracts';
import { MAIL_CATALOGS } from './catalog/index.js';
import type { TemplateContext, TemplateRenderer } from './catalog/types.js';
import { HOTEL_PROFILE } from './hotel-profile.js';
import { mailFormat } from './mail-format.js';
import { guestLinks } from './mail-links.js';
import { MailSettings } from './mail-settings.js';
import {
  describeIssuePaths,
  MAIL_PAYLOAD_SCHEMAS,
  MailTemplateSchema,
  type MailTemplate,
} from './mail-templates.js';

export { extractLinks } from './mail-links.js';

/** 送るメールの件名と本文（本文は改行 \n で行を区切る平文） */
export interface RenderedMail {
  subject: string;
  body: string;
}

/** 文面を作るのに要る設定 */
export interface MailRenderContext {
  /** 宿泊客アプリの URL（リンクの基点） */
  guestWebBaseUrl: string;
}

/** 行の内容から文面を作れない（テンプレート・言語・内容の形の誤り） */
export class MailRenderError extends Error {
  override readonly name = 'MailRenderError';
  readonly code = 'MAIL_RENDER_FAILED';
}

/** 行（テンプレート・言語・内容）から件名と本文を作る。作れなければ MailRenderError */
export function renderMail(
  row: { template: string; locale: string; payload: unknown },
  context: MailRenderContext,
): RenderedMail {
  const template = MailTemplateSchema.safeParse(row.template);
  if (!template.success) throw new MailRenderError('メールのテンプレートが正しくありません');
  const locale = LocaleSchema.safeParse(row.locale);
  if (!locale.success) throw new MailRenderError('メールの言語が正しくありません');
  const payload = MAIL_PAYLOAD_SCHEMAS[template.data].safeParse(row.payload);
  if (!payload.success) {
    throw new MailRenderError(
      `メールの内容（${template.data}）の形が正しくありません: ${describeIssuePaths(payload.error)}`,
    );
  }

  const catalog = MAIL_CATALOGS[locale.data];
  const ctx: TemplateContext = {
    f: mailFormat(locale.data),
    hotel: HOTEL_PROFILE[locale.data],
    links: guestLinks(context.guestWebBaseUrl),
  };
  // テンプレートと内容の組は、上の確認で一致している
  const render = catalog.templates[template.data] as TemplateRenderer<MailTemplate>;
  const text = render(payload.data as never, ctx);
  return {
    // 件名は1行（ヘッダーへの差し込みを防ぐ。内容の形でも改行を断っている）
    subject: text.subject.replace(/[\r\n]+/g, ' '),
    body: [...text.lines, '', ...catalog.signature(ctx)].join('\n'),
  };
}

/** 設定（MailSettings）の宿泊客アプリの URL で文面を作る */
@Injectable()
export class MailRenderer {
  constructor(private readonly settings: MailSettings) {}

  render(row: { template: string; locale: string; payload: unknown }): RenderedMail {
    return renderMail(row, { guestWebBaseUrl: this.settings.guestWebBaseUrl });
  }
}
