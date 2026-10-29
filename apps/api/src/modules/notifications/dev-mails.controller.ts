// 開発用のメールの一覧（社内用 API の GET /dev/mails。design.md「模擬のメール」、tasks.md 3.4）。
//
// 開発環境（APP_ENV が development・test）だけに載せる（listeners.ts の listenerRootModule。production では
// このコントローラーを読み込まないので、URL そのものが存在しない：TC-MB-207）。
// 画面のテストが、確認・再設定・配信停止のリンクを取り出すために使う（tasks.md 8.2・11.2）：
//   GET /api/staff/dev/mails?to=new@example.com&template=VERIFY_EMAIL&limit=1 → mails[0].links
// 本文には会員の個人情報とトークンが入るので、開発環境でもスタッフのログイン（フロント以上）が要る（清掃員には見せない）。
// 表示するだけで何も変えないので、操作履歴には記録しない。
import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { BusinessError } from '../../shared/errors/business-error.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { RequireRole } from '../../shared/session/auth.decorators.js';
import { extractLinks, MailRenderer } from './mail-renderer.js';
import { MailTemplateSchema } from './mail-templates.js';

/** 一覧の1通 */
export interface DevMailView {
  id: string;
  memberId: string | null;
  to: string;
  locale: string;
  template: string;
  status: string;
  attempts: number;
  /** 作成した日時（ISO 8601） */
  createdAt: string;
  sentAt: string | null;
  /** 送る（送った）件名と本文。行の内容から作れなければ null */
  subject: string | null;
  body: string | null;
  /** 本文の中の URL（確認のリンクなど） */
  links: string[];
  /** 文面を作れなかったときのコード */
  renderError?: string;
}

export interface DevMailListResponse {
  mails: DevMailView[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const QuerySchema = z.object({
  /** 宛先（大文字・小文字を区別しない完全一致） */
  to: z.string().min(1).max(320).optional(),
  template: MailTemplateSchema.optional(),
  limit: z
    .string()
    .regex(/^\d{1,4}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(MAX_LIMIT))
    .optional(),
});

@RequireRole('FRONT')
@Controller('dev/mails')
export class DevMailsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: MailRenderer,
  ) {}

  /** 作成したメール（新しい順） */
  @Get()
  async list(@Query() rawQuery: unknown): Promise<DevMailListResponse> {
    const query = QuerySchema.safeParse(rawQuery);
    if (!query.success) throw new BusinessError('VALIDATION_FAILED');
    const { to, template, limit } = query.data;
    const rows = await this.prisma.mailOutbox.findMany({
      where: {
        ...(to === undefined ? {} : { toAddress: { equals: to, mode: 'insensitive' } }),
        ...(template === undefined ? {} : { template }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit ?? DEFAULT_LIMIT,
    });
    return {
      mails: rows.map((row) => {
        const base = {
          id: row.id,
          memberId: row.memberId,
          to: row.toAddress,
          locale: row.locale,
          template: row.template,
          status: row.status,
          attempts: row.attempts,
          createdAt: row.createdAt.toISOString(),
          sentAt: row.sentAt?.toISOString() ?? null,
        };
        try {
          const mail = this.renderer.render(row);
          return { ...base, ...mail, links: extractLinks(mail.body) };
        } catch (error) {
          const code =
            typeof (error as { code?: unknown }).code === 'string'
              ? String((error as { code: string }).code)
              : 'MAIL_RENDER_FAILED';
          return { ...base, subject: null, body: null, links: [], renderError: code };
        }
      }),
    };
  }
}
