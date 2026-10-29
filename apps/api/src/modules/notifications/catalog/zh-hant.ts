// メールの文面（中国語・繁体字）。design.md P-15 の12のテンプレート。訳文はモデルが作ったもの（母語話者の確認を勧める）。
import type { GuestCounts, PaymentMethod, PaymentRecordMethod } from '@hotel/contracts';
import { HOTEL_HOURS } from '../hotel-profile.js';
import { lineIf, translated, type MailCatalog, type TemplateContext } from './types.js';

const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  PREPAID: '預付',
  PAY_AT_HOTEL: '到店付款',
};

const RECORD_METHODS: Record<PaymentRecordMethod, string> = {
  CARD_ON_FILE: '已登記的信用卡',
  CASH: '現金',
  CARD: '信用卡',
  BANK_TRANSFER: '銀行轉帳',
  OTHER: '其他',
};

/** 口座種別（hotel_settings の日本語の値）の訳。対応表にない値はそのまま示す */
const ACCOUNT_TYPES: Readonly<Record<string, string>> = {
  普通: '普通存款',
  当座: '支票存款',
  貯蓄: '儲蓄存款',
};

function guests(g: GuestCounts): string {
  return [
    `成人${g.adults}人`,
    ...lineIf(g.children > 0, `兒童${g.children}人`),
    ...lineIf(g.infants > 0, `幼兒${g.infants}人`),
  ].join('、');
}

function stay(ctx: TemplateContext, p: { arrivalDate: string; departureDate: string }): string {
  const { f } = ctx;
  return `住宿日期：${f.date(p.arrivalDate)} ～ ${f.date(p.departureDate)}（${f.nights(p.arrivalDate, p.departureDate)}晚）`;
}

const subject = (ctx: TemplateContext, text: string) => `[${ctx.hotel.name}] ${text}`;

export const zhHant: MailCatalog = {
  templates: {
    VERIFY_EMAIL: (p, ctx) => ({
      subject: subject(ctx, '確認您的電子郵件地址'),
      lines: [
        '為確認您的電子郵件地址，請在24小時內開啟以下連結。',
        ctx.links.verifyEmail(p.token),
        '',
        '如果這不是您本人的操作，請忽略此郵件。',
      ],
    }),
    PASSWORD_RESET: (p, ctx) => ({
      subject: subject(ctx, '重新設定密碼'),
      lines: [
        '我們已收到重新設定密碼的申請。請在1小時內開啟以下連結並設定新密碼。',
        ctx.links.passwordReset(p.token),
        '',
        '如果您沒有提出申請，請忽略此郵件。您的密碼不會變更。',
      ],
    }),
    RESERVATION_CONFIRMED: (p, ctx) => {
      const { f } = ctx;
      return {
        subject: subject(ctx, `預訂已確認（預訂編號 ${p.reservationNumber}）`),
        lines: [
          '感謝您的預訂。您的預訂已按以下內容確認。',
          '',
          `預訂編號：${p.reservationNumber}`,
          `客房類型：${p.roomTypeName}`,
          stay(ctx, p),
          `房間數：${f.count(p.roomCount)}間`,
          `人數：${guests(p.guests)}`,
          `付款方式：${PAYMENT_METHODS[p.paymentMethod]}`,
          `合計金額（含稅）：${f.yen(p.totalAmount)}`,
          ...lineIf(
            p.paymentMethod === 'PREPAID',
            `已預付金額：${f.yen(p.totalAmount - p.payAtHotelAmount)}`,
          ),
          ...lineIf(p.payAtHotelAmount > 0, `需在飯店支付的金額：${f.yen(p.payAtHotelAmount)}`),
          '',
          ...(p.earlyBird
            ? ['本預訂為早鳥優惠預訂，取消或減少住宿天數等變更均不予退款。']
            : p.freeCancellationDeadline === null
              ? []
              : [`可免費取消的期限：${f.dateTime(p.freeCancellationDeadline)}`]),
          `入住：${f.hour(HOTEL_HOURS.checkIn)}起 ／ 退房：${f.hour(HOTEL_HOURS.checkOut)}前（日本時間）`,
          '',
          '如需確認、變更或取消預訂，請登入後在「我的頁面」中操作。',
          ctx.links.login(),
        ],
      };
    },
    PAYMENT_COMPLETED: (p, ctx) => ({
      subject: subject(ctx, `已收到付款（預訂編號 ${p.reservationNumber}）`),
      lines: [
        '我們已收到以下付款。謝謝。',
        '',
        `預訂編號：${p.reservationNumber}`,
        `付款金額：${ctx.f.yen(p.amount)}`,
        `付款方式：${RECORD_METHODS[p.method]}`,
      ],
    }),
    HOLD_EXPIRED: (p, ctx) => ({
      subject: subject(ctx, '由於超過付款期限，已解除客房保留'),
      lines: [
        '由於付款手續未在期限（15分鐘）內完成，我們已解除為您保留的客房。您的預訂尚未確認。',
        '',
        `客房類型：${p.roomTypeName}`,
        stay(ctx, p),
        `房間數：${ctx.f.count(p.roomCount)}間`,
        '',
        '如仍希望入住，請重新預訂。',
        ctx.links.top(),
      ],
    }),
    RESERVATION_CHANGED: (p, ctx) => {
      const { f } = ctx;
      const differences = [
        ...lineIf(
          p.chargedAmount > 0,
          `追加付款（已透過您登記的信用卡扣款）：${f.yen(p.chargedAmount)}`,
        ),
        ...lineIf(p.refundAmount > 0, `將退款的金額：${f.yen(p.refundAmount)}`),
        ...lineIf(
          p.payAtHotelDelta > 0,
          `需在飯店支付的金額增加：${f.yen(Math.abs(p.payAtHotelDelta))}`,
        ),
        ...lineIf(
          p.payAtHotelDelta < 0,
          `需在飯店支付的金額減少：${f.yen(Math.abs(p.payAtHotelDelta))}`,
        ),
        ...lineIf(p.cancellationFee > 0, `取消費：${f.yen(p.cancellationFee)}`),
        ...lineIf(
          p.nonRefundableLodgingTax > 0,
          `不予退還的住宿稅：${f.yen(p.nonRefundableLodgingTax)}`,
        ),
      ];
      return {
        subject: subject(ctx, `預訂變更已完成（預訂編號 ${p.reservationNumber}）`),
        lines: [
          '您的預訂變更已完成。變更後的預訂內容如下。',
          '',
          `預訂編號：${p.reservationNumber}`,
          `客房類型：${p.roomTypeName}`,
          stay(ctx, p),
          `房間數：${f.count(p.roomCount)}間`,
          `人數：${guests(p.guests)}`,
          `變更後的合計金額（含稅）：${f.yen(p.totalAmount)}`,
          '',
          '差額',
          ...(differences.length > 0 ? differences : ['沒有差額。']),
        ],
      };
    },
    RESERVATION_CANCELLED: (p, ctx) => {
      const { f } = ctx;
      return {
        subject: subject(ctx, `預訂已取消（預訂編號 ${p.reservationNumber}）`),
        lines: [
          '您的預訂已取消。',
          '',
          `預訂編號：${p.reservationNumber}`,
          stay(ctx, p),
          `取消費：${f.yen(p.cancellationFee)}`,
          ...lineIf(
            p.nonRefundableStayAmount > 0,
            `不予退還的住宿費：${f.yen(p.nonRefundableStayAmount)}`,
          ),
          ...lineIf(
            p.nonRefundableLodgingTax > 0,
            `不予退還的住宿稅：${f.yen(p.nonRefundableLodgingTax)}`,
          ),
          ...lineIf(p.refundAmount !== null, `退款金額：${f.yen(p.refundAmount ?? 0)}`),
        ],
      };
    },
    PRE_ARRIVAL: (p, ctx) => {
      const { f } = ctx;
      return {
        subject: subject(ctx, `到店須知（預訂編號 ${p.reservationNumber}）`),
        lines: [
          '我們期待明天您的光臨。到店前請確認以下內容。',
          '',
          `預訂編號：${p.reservationNumber}`,
          `客房類型：${p.roomTypeName}`,
          stay(ctx, p),
          `房間數：${f.count(p.roomCount)}間`,
          '',
          `入住：${f.hour(HOTEL_HOURS.checkIn)}～${f.hour(HOTEL_HOURS.lastCheckIn)}（次日${f.hour(HOTEL_HOURS.lastCheckIn - 24)}）（日本時間）`,
          ...lineIf(p.earlyCheckinHour !== null, `提前入住：${f.hour(p.earlyCheckinHour ?? 0)}起`),
          `退房：${f.hour(HOTEL_HOURS.checkOut)}前`,
          '',
          '交通方式',
          ctx.hotel.address,
          ctx.hotel.access,
        ],
      };
    },
    FEE_CHARGED: (p, ctx) => {
      const { f } = ctx;
      const noShow = p.reason === 'NO_SHOW';
      const nonRefundable = p.nonRefundableStayAmount > 0 || p.nonRefundableLodgingTax > 0;
      return {
        subject: subject(
          ctx,
          `${noShow ? '未入住費用' : '取消費'}的收取（預訂編號 ${p.reservationNumber}）`,
        ),
        lines: [
          noShow
            ? '由於您未在到店日辦理入住，我們已收取未入住費用。'
            : '由於您取消或變更了預訂，我們已收取取消費。',
          '',
          `預訂編號：${p.reservationNumber}`,
          `收取金額：${f.yen(p.amount)}`,
          p.chargedTo === 'REGISTERED_CARD'
            ? '已向您登記的信用卡收取。'
            : '已從您預付的金額中扣除。',
          ...lineIf(nonRefundable, ''),
          ...lineIf(
            p.nonRefundableStayAmount > 0,
            `${noShow ? '不予退還的第2晚及以後的住宿費' : '不予退還的住宿費'}：${f.yen(p.nonRefundableStayAmount)}`,
          ),
          ...lineIf(
            p.nonRefundableLodgingTax > 0,
            `不予退還的住宿稅：${f.yen(p.nonRefundableLodgingTax)}`,
          ),
          ...lineIf(
            nonRefundable,
            '※ 不予退還的金額與收取金額分開計算，是您已預付的金額中不予退還的部分。',
          ),
        ],
      };
    },
    REFUND_COMPLETED: (p, ctx) => ({
      subject: subject(ctx, `退款已完成（預訂編號 ${p.reservationNumber}）`),
      lines: [
        '以下退款已完成。',
        '',
        `預訂編號：${p.reservationNumber}`,
        `退款金額：${ctx.f.yen(p.amount)}`,
        `退款方式：${RECORD_METHODS[p.method]}`,
        ...lineIf(
          p.method === 'CARD_ON_FILE' || p.method === 'CARD',
          '退款至信用卡時，根據發卡機構的處理情況，可能需要一段時間才會反映在帳單上。',
        ),
      ],
    }),
    PAYMENT_REQUEST: (p, ctx) => ({
      subject: subject(ctx, `付款請求（預訂編號 ${p.reservationNumber}）`),
      lines: [
        '我們無法向您登記的信用卡收取預訂的取消費或未入住費用。煩請將以下金額匯入下列帳戶。',
        '',
        `預訂編號：${p.reservationNumber}`,
        `應付金額：${ctx.f.yen(p.amount)}`,
        '',
        '匯款帳戶',
        `銀行名稱：${p.bankAccount.bankName}`,
        `分行名稱：${p.bankAccount.branchName}`,
        `帳戶類型：${translated(ACCOUNT_TYPES, p.bankAccount.accountType)}`,
        `帳號：${p.bankAccount.accountNumber}`,
        `戶名：${p.bankAccount.accountHolder}`,
        '',
        '如有任何疑問，請聯絡飯店。',
      ],
    }),
    MARKETING: (p, ctx) => ({
      subject: p.subject,
      lines: [
        ...p.body.split(/\r?\n/),
        '',
        '--',
        `寄件人：${ctx.hotel.name}`,
        `地址：${ctx.hotel.address}`,
        '本郵件寄送給已同意接收定期郵件的會員。',
        '如需停止接收，請開啟以下連結。',
        ctx.links.unsubscribe(p.unsubscribeToken),
      ],
    }),
  },
  signature: (ctx) => ['--', ctx.hotel.name, ctx.hotel.address, ctx.links.top()],
};
