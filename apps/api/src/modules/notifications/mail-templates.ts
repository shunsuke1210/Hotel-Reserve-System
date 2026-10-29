// メールのテンプレートの一覧と、テンプレートごとの内容（mail_outbox.payload）の形（design.md P-15、Data Models mail_outbox）。
//
// 内容は、文面を作るのに要る値だけを持つ（宛先・言語は mail_outbox の列）。文面は送るとき（outbox）と開発用の一覧で、
// 内容とテンプレート（catalog/）から組み立てる。呼び出し側が項目を忘れないように、項目はすべて必須にしている
// （記載しない金額は 0、該当しない値は null を渡す）。金額は円の整数。日付は日本時間の暦の日付（YYYY-MM-DD）。
// 内容に余計な項目（氏名など）を渡しても、ここにない項目は保存しない（zod の object は知らない項目を取り除く）。
import {
  EarlyCheckinHourSchema,
  PaymentMethodSchema,
  PaymentRecordMethodSchema,
} from '@hotel/contracts';
import { z } from 'zod';

/** テンプレート（mail_outbox.template。design.md P-15 の表の順） */
export const MAIL_TEMPLATES = [
  'VERIFY_EMAIL',
  'PASSWORD_RESET',
  'RESERVATION_CONFIRMED',
  'PAYMENT_COMPLETED',
  'HOLD_EXPIRED',
  'RESERVATION_CHANGED',
  'RESERVATION_CANCELLED',
  'PRE_ARRIVAL',
  'FEE_CHARGED',
  'REFUND_COMPLETED',
  'PAYMENT_REQUEST',
  'MARKETING',
] as const;
export type MailTemplate = (typeof MAIL_TEMPLATES)[number];
export const MailTemplateSchema = z.enum(MAIL_TEMPLATES);

/** 定期配信以外のテンプレート（MailService.enqueue で作る。定期配信は同意の確認と配信停止のリンクが要るので別の関数） */
export type TransactionalMailTemplate = Exclude<MailTemplate, 'MARKETING'>;

/** mail_outbox.status */
export const MAIL_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type MailStatus = (typeof MAIL_STATUSES)[number];

/**
 * 送信を試す最大の回数（design.md「定時処理の失敗」：最大5回で FAILED）。試行の合計で数える：
 * 4回目の失敗の後は PENDING（attempts=4）、5回目の失敗で FAILED（attempts=5。TC-MB-270・271）
 */
export const MAX_SEND_ATTEMPTS = 5;

const yen = z.number().int().min(0);
const positiveYen = z.number().int().min(1);
const signedYen = z.number().int();
const isoDate = z.iso.date();
/** 瞬間（ISO 8601、時差つき。例：Date の toISOString()） */
const instant = z.iso.datetime({ offset: true });
const reservationNumber = z.string().regex(/^[A-Za-z0-9-]{1,32}$/);
/** 1行の文字列（件名に入る値・名称。改行を入れさせない） */
const singleLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[^\r\n]*$/);
const token = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[^\s]+$/);
const roomCount = z.number().int().min(1);
const guests = z.object({
  adults: z.number().int().min(1),
  children: z.number().int().min(0),
  infants: z.number().int().min(0),
});
const stay = {
  arrivalDate: isoDate,
  departureDate: isoDate,
};
/** 出発日は到着日より後 */
const departureAfterArrival = (p: { arrivalDate: string; departureDate: string }) =>
  p.departureDate > p.arrivalDate;
const DEPARTURE_AFTER_ARRIVAL = {
  path: ['departureDate'],
  message: '出発日は到着日より後にしてください',
};

export const MAIL_PAYLOAD_SCHEMAS = {
  /** 会員登録・メールアドレスの変更の確認（1.4、1.12、DT-M4）。token は確認のリンクに入れるトークン（auth_tokens にはハッシュだけを保存） */
  VERIFY_EMAIL: z.object({ token }),
  /** パスワードの再設定（1.9） */
  PASSWORD_RESET: z.object({ token }),
  /** 予約の確定（4.22） */
  RESERVATION_CONFIRMED: z
    .object({
      reservationNumber,
      /** 客室タイプの名称（会員の言語の名称を渡す） */
      roomTypeName: singleLine(200),
      ...stay,
      roomCount,
      guests,
      paymentMethod: PaymentMethodSchema,
      /** 合計（税込） */
      totalAmount: yen,
      /** そのうち現地で支払う額（現地払いは合計、事前決済はアーリー・レイトの料金。4.19） */
      payAtHotelAmount: yen,
      /** 早期割（取り消しても返金しない。8.9） */
      earlyBird: z.boolean(),
      /** 無料で取り消せる期限（団体・早期割など示さないときは null） */
      freeCancellationDeadline: instant.nullable(),
    })
    .refine(departureAfterArrival, DEPARTURE_AFTER_ARRIVAL)
    .refine((p) => p.payAtHotelAmount <= p.totalAmount, {
      path: ['payAtHotelAmount'],
      message: '現地で支払う額は合計以下にしてください',
    }),
  /** 入金の完了（事前決済の確定の2通目、現地での入金の記録。4.23、11.9、DT-M33） */
  PAYMENT_COMPLETED: z.object({
    reservationNumber,
    amount: positiveYen,
    method: PaymentRecordMethodSchema,
  }),
  /** 確保の時間切れ（4.17。予約番号は確定まで発行しないので、内容で示す。L-52） */
  HOLD_EXPIRED: z
    .object({
      roomTypeName: singleLine(200),
      ...stay,
      roomCount,
    })
    .refine(departureAfterArrival, DEPARTURE_AFTER_ARRIVAL),
  /** 変更の確定（7.16。差額を記載する） */
  RESERVATION_CHANGED: z
    .object({
      reservationNumber,
      roomTypeName: singleLine(200),
      ...stay,
      roomCount,
      guests,
      /** 変更後の合計（税込） */
      totalAmount: yen,
      /** 追加で決済した額（ChangeQuote.chargeNow） */
      chargedAmount: yen,
      /** 返金する額（ChangeQuote.refundNow） */
      refundAmount: yen,
      /** 現地で支払う額の増減（ChangeQuote.onsiteDelta。減れば負） */
      payAtHotelDelta: signedYen,
      /** 減らす変更・日程の変更のキャンセル料 */
      cancellationFee: yen,
      /** 返金しない宿泊税（DT-M7） */
      nonRefundableLodgingTax: yen,
    })
    .refine(departureAfterArrival, DEPARTURE_AFTER_ARRIVAL),
  /** キャンセルの確定（8.13。キャンセル料と返金しない宿泊税は別の行：DT-M7） */
  RESERVATION_CANCELLED: z
    .object({
      reservationNumber,
      ...stay,
      cancellationFee: yen,
      /** 返金しない宿泊料金（早期割など） */
      nonRefundableStayAmount: yen,
      nonRefundableLodgingTax: yen,
      /** 返金額（返金がない現地払いなどは null） */
      refundAmount: yen.nullable(),
    })
    .refine(departureAfterArrival, DEPARTURE_AFTER_ARRIVAL),
  /** 到着前の案内（15.2。チェックイン時刻とアクセス） */
  PRE_ARRIVAL: z
    .object({
      reservationNumber,
      roomTypeName: singleLine(200),
      ...stay,
      roomCount,
      /** アーリーチェックインの開始時刻（なければ null） */
      earlyCheckinHour: EarlyCheckinHourSchema.nullable(),
    })
    .refine(departureAfterArrival, DEPARTURE_AFTER_ARRIVAL),
  /** キャンセル料・ノーショー料の請求（15.4、DT-M6、DT-M45、DT-M48） */
  FEE_CHARGED: z.object({
    reservationNumber,
    reason: z.enum(['CANCELLATION', 'NO_SHOW']),
    /** 請求額（早期割のノーショーは1泊目のノーショー料：DT-M45） */
    amount: positiveYen,
    /** 請求先：登録カード、またはお支払い済みの額からの差し引き（DT-M6） */
    chargedTo: z.enum(['REGISTERED_CARD', 'PREPAYMENT']),
    /** 返金しない宿泊料金（早期割のノーショーの2泊目以降：DT-M45）。請求額とは別の行 */
    nonRefundableStayAmount: yen,
    /** 返金しない宿泊税（全泊の分を1行：DT-M48）。請求額とは別の行 */
    nonRefundableLodgingTax: yen,
  }),
  /** 返金の完了（カードへの返金・現地での払い戻し。15.5、DT-M33、L-44） */
  REFUND_COMPLETED: z.object({
    reservationNumber,
    amount: positiveYen,
    method: PaymentRecordMethodSchema,
  }),
  /** 未回収の支払いのお願い（15.8、8.23）。振込先は MailService が hotel_settings から入れる */
  PAYMENT_REQUEST: z.object({
    reservationNumber,
    /** 未回収の額 */
    amount: positiveYen,
    bankAccount: z.object({
      bankName: singleLine(200),
      branchName: singleLine(200),
      accountType: singleLine(50),
      accountNumber: singleLine(50),
      accountHolder: singleLine(200),
    }),
  }),
  /** 定期配信（15.6、15.7。MVP では配信しない：NT-03b）。送信者の名称と配信停止のリンクはテンプレートが必ず入れる */
  MARKETING: z.object({
    subject: singleLine(200),
    body: z.string().min(1).max(20_000),
    /** 配信停止のリンクに入れる署名つきの値（unsubscribe-token.ts） */
    unsubscribeToken: token,
  }),
} as const satisfies Record<MailTemplate, z.ZodType>;

/** テンプレートの内容（mail_outbox.payload に保存する形） */
export type MailPayload<T extends MailTemplate> = z.infer<(typeof MAIL_PAYLOAD_SCHEMAS)[T]>;

/** 呼び出し側が渡す内容（PAYMENT_REQUEST の振込先は MailService が入れる） */
export type MailPayloadInput<T extends TransactionalMailTemplate> = T extends 'PAYMENT_REQUEST'
  ? Omit<MailPayload<'PAYMENT_REQUEST'>, 'bankAccount'>
  : MailPayload<T>;

/** 定期配信の件名と本文（会員の言語のもの） */
export type MarketingContent = Pick<MailPayload<'MARKETING'>, 'subject' | 'body'>;

/** 内容の形の誤りの場所（項目の名前だけ。値は個人情報を含みうるので出さない） */
export function describeIssuePaths(error: z.ZodError): string {
  const paths = error.issues.map((issue) =>
    issue.path.length === 0 ? '(全体)' : issue.path.map(String).join('.'),
  );
  return [...new Set(paths)].join(', ');
}
