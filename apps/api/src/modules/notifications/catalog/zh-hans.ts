// メールの文面（中国語・簡体字）。design.md P-15 の12のテンプレート。訳文はモデルが作ったもの（母語話者の確認を勧める）。
import type { GuestCounts, PaymentMethod, PaymentRecordMethod } from '@hotel/contracts';
import { HOTEL_HOURS } from '../hotel-profile.js';
import { lineIf, translated, type MailCatalog, type TemplateContext } from './types.js';

const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  PREPAID: '预付',
  PAY_AT_HOTEL: '到店付款',
};

const RECORD_METHODS: Record<PaymentRecordMethod, string> = {
  CARD_ON_FILE: '已登记的信用卡',
  CASH: '现金',
  CARD: '信用卡',
  BANK_TRANSFER: '银行转账',
  OTHER: '其他',
};

/** 口座種別（hotel_settings の日本語の値）の訳。対応表にない値はそのまま示す */
const ACCOUNT_TYPES: Readonly<Record<string, string>> = {
  普通: '普通存款',
  当座: '支票存款',
  貯蓄: '储蓄存款',
};

function guests(g: GuestCounts): string {
  return [
    `成人${g.adults}人`,
    ...lineIf(g.children > 0, `儿童${g.children}人`),
    ...lineIf(g.infants > 0, `幼儿${g.infants}人`),
  ].join('、');
}

function stay(ctx: TemplateContext, p: { arrivalDate: string; departureDate: string }): string {
  const { f } = ctx;
  return `住宿日期：${f.date(p.arrivalDate)} ～ ${f.date(p.departureDate)}（${f.nights(p.arrivalDate, p.departureDate)}晚）`;
}

const subject = (ctx: TemplateContext, text: string) => `[${ctx.hotel.name}] ${text}`;

export const zhHans: MailCatalog = {
  templates: {
    VERIFY_EMAIL: (p, ctx) => ({
      subject: subject(ctx, '确认您的电子邮件地址'),
      lines: [
        '为确认您的电子邮件地址，请在24小时内打开以下链接。',
        ctx.links.verifyEmail(p.token),
        '',
        '如果这不是您本人的操作，请忽略此邮件。',
      ],
    }),
    PASSWORD_RESET: (p, ctx) => ({
      subject: subject(ctx, '重新设置密码'),
      lines: [
        '我们已收到重新设置密码的申请。请在1小时内打开以下链接并设置新密码。',
        ctx.links.passwordReset(p.token),
        '',
        '如果您没有提出申请，请忽略此邮件。您的密码不会改变。',
      ],
    }),
    RESERVATION_CONFIRMED: (p, ctx) => {
      const { f } = ctx;
      return {
        subject: subject(ctx, `预订已确认（预订编号 ${p.reservationNumber}）`),
        lines: [
          '感谢您的预订。您的预订已按以下内容确认。',
          '',
          `预订编号：${p.reservationNumber}`,
          `客房类型：${p.roomTypeName}`,
          stay(ctx, p),
          `房间数：${f.count(p.roomCount)}间`,
          `人数：${guests(p.guests)}`,
          `付款方式：${PAYMENT_METHODS[p.paymentMethod]}`,
          `合计金额（含税）：${f.yen(p.totalAmount)}`,
          ...lineIf(
            p.paymentMethod === 'PREPAID',
            `已预付金额：${f.yen(p.totalAmount - p.payAtHotelAmount)}`,
          ),
          ...lineIf(p.payAtHotelAmount > 0, `需在酒店支付的金额：${f.yen(p.payAtHotelAmount)}`),
          '',
          ...(p.earlyBird
            ? ['本预订为早鸟优惠预订，取消或减少住宿天数等变更均不予退款。']
            : p.freeCancellationDeadline === null
              ? []
              : [`可免费取消的期限：${f.dateTime(p.freeCancellationDeadline)}`]),
          `入住：${f.hour(HOTEL_HOURS.checkIn)}起 ／ 退房：${f.hour(HOTEL_HOURS.checkOut)}前（日本时间）`,
          '',
          '如需确认、变更或取消预订，请登录后在“我的页面”中操作。',
          ctx.links.login(),
        ],
      };
    },
    PAYMENT_COMPLETED: (p, ctx) => ({
      subject: subject(ctx, `已收到付款（预订编号 ${p.reservationNumber}）`),
      lines: [
        '我们已收到以下付款。谢谢。',
        '',
        `预订编号：${p.reservationNumber}`,
        `付款金额：${ctx.f.yen(p.amount)}`,
        `付款方式：${RECORD_METHODS[p.method]}`,
      ],
    }),
    HOLD_EXPIRED: (p, ctx) => ({
      subject: subject(ctx, '由于超过付款期限，已解除客房保留'),
      lines: [
        '由于付款手续未在期限（15分钟）内完成，我们已解除为您保留的客房。您的预订尚未确认。',
        '',
        `客房类型：${p.roomTypeName}`,
        stay(ctx, p),
        `房间数：${ctx.f.count(p.roomCount)}间`,
        '',
        '如仍希望入住，请重新预订。',
        ctx.links.top(),
      ],
    }),
    RESERVATION_CHANGED: (p, ctx) => {
      const { f } = ctx;
      const differences = [
        ...lineIf(
          p.chargedAmount > 0,
          `追加付款（已通过您登记的信用卡扣款）：${f.yen(p.chargedAmount)}`,
        ),
        ...lineIf(p.refundAmount > 0, `将退款的金额：${f.yen(p.refundAmount)}`),
        ...lineIf(
          p.payAtHotelDelta > 0,
          `需在酒店支付的金额增加：${f.yen(Math.abs(p.payAtHotelDelta))}`,
        ),
        ...lineIf(
          p.payAtHotelDelta < 0,
          `需在酒店支付的金额减少：${f.yen(Math.abs(p.payAtHotelDelta))}`,
        ),
        ...lineIf(p.cancellationFee > 0, `取消费：${f.yen(p.cancellationFee)}`),
        ...lineIf(
          p.nonRefundableLodgingTax > 0,
          `不予退还的住宿税：${f.yen(p.nonRefundableLodgingTax)}`,
        ),
      ];
      return {
        subject: subject(ctx, `预订变更已完成（预订编号 ${p.reservationNumber}）`),
        lines: [
          '您的预订变更已完成。变更后的预订内容如下。',
          '',
          `预订编号：${p.reservationNumber}`,
          `客房类型：${p.roomTypeName}`,
          stay(ctx, p),
          `房间数：${f.count(p.roomCount)}间`,
          `人数：${guests(p.guests)}`,
          `变更后的合计金额（含税）：${f.yen(p.totalAmount)}`,
          '',
          '差额',
          ...(differences.length > 0 ? differences : ['没有差额。']),
        ],
      };
    },
    RESERVATION_CANCELLED: (p, ctx) => {
      const { f } = ctx;
      return {
        subject: subject(ctx, `预订已取消（预订编号 ${p.reservationNumber}）`),
        lines: [
          '您的预订已取消。',
          '',
          `预订编号：${p.reservationNumber}`,
          stay(ctx, p),
          `取消费：${f.yen(p.cancellationFee)}`,
          ...lineIf(
            p.nonRefundableStayAmount > 0,
            `不予退还的住宿费：${f.yen(p.nonRefundableStayAmount)}`,
          ),
          ...lineIf(
            p.nonRefundableLodgingTax > 0,
            `不予退还的住宿税：${f.yen(p.nonRefundableLodgingTax)}`,
          ),
          ...lineIf(p.refundAmount !== null, `退款金额：${f.yen(p.refundAmount ?? 0)}`),
        ],
      };
    },
    PRE_ARRIVAL: (p, ctx) => {
      const { f } = ctx;
      return {
        subject: subject(ctx, `到店须知（预订编号 ${p.reservationNumber}）`),
        lines: [
          '我们期待明天您的光临。到店前请确认以下内容。',
          '',
          `预订编号：${p.reservationNumber}`,
          `客房类型：${p.roomTypeName}`,
          stay(ctx, p),
          `房间数：${f.count(p.roomCount)}间`,
          '',
          `入住：${f.hour(HOTEL_HOURS.checkIn)}～${f.hour(HOTEL_HOURS.lastCheckIn)}（次日${f.hour(HOTEL_HOURS.lastCheckIn - 24)}）（日本时间）`,
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
          `${noShow ? '未入住费用' : '取消费'}的收取（预订编号 ${p.reservationNumber}）`,
        ),
        lines: [
          noShow
            ? '由于您未在到店日办理入住，我们已收取未入住费用。'
            : '由于您取消或变更了预订，我们已收取取消费。',
          '',
          `预订编号：${p.reservationNumber}`,
          `收取金额：${f.yen(p.amount)}`,
          p.chargedTo === 'REGISTERED_CARD'
            ? '已向您登记的信用卡收取。'
            : '已从您预付的金额中扣除。',
          ...lineIf(nonRefundable, ''),
          ...lineIf(
            p.nonRefundableStayAmount > 0,
            `${noShow ? '不予退还的第2晚及以后的住宿费' : '不予退还的住宿费'}：${f.yen(p.nonRefundableStayAmount)}`,
          ),
          ...lineIf(
            p.nonRefundableLodgingTax > 0,
            `不予退还的住宿税：${f.yen(p.nonRefundableLodgingTax)}`,
          ),
          ...lineIf(
            nonRefundable,
            '※ 不予退还的金额与收取金额分开计算，是您已预付的金额中不予退还的部分。',
          ),
        ],
      };
    },
    REFUND_COMPLETED: (p, ctx) => ({
      subject: subject(ctx, `退款已完成（预订编号 ${p.reservationNumber}）`),
      lines: [
        '以下退款已完成。',
        '',
        `预订编号：${p.reservationNumber}`,
        `退款金额：${ctx.f.yen(p.amount)}`,
        `退款方式：${RECORD_METHODS[p.method]}`,
        ...lineIf(
          p.method === 'CARD_ON_FILE' || p.method === 'CARD',
          '退款至信用卡时，根据发卡机构的处理情况，可能需要一段时间才会反映在账单上。',
        ),
      ],
    }),
    PAYMENT_REQUEST: (p, ctx) => ({
      subject: subject(ctx, `付款请求（预订编号 ${p.reservationNumber}）`),
      lines: [
        '我们无法向您登记的信用卡收取预订的取消费或未入住费用。烦请将以下金额汇入下列账户。',
        '',
        `预订编号：${p.reservationNumber}`,
        `应付金额：${ctx.f.yen(p.amount)}`,
        '',
        '汇款账户',
        `银行名称：${p.bankAccount.bankName}`,
        `支行名称：${p.bankAccount.branchName}`,
        `账户类型：${translated(ACCOUNT_TYPES, p.bankAccount.accountType)}`,
        `账号：${p.bankAccount.accountNumber}`,
        `账户名：${p.bankAccount.accountHolder}`,
        '',
        '如有任何疑问，请联系酒店。',
      ],
    }),
    MARKETING: (p, ctx) => ({
      subject: p.subject,
      lines: [
        ...p.body.split(/\r?\n/),
        '',
        '--',
        `发件人：${ctx.hotel.name}`,
        `地址：${ctx.hotel.address}`,
        '本邮件发送给已同意接收定期邮件的会员。',
        '如需停止接收，请打开以下链接。',
        ctx.links.unsubscribe(p.unsubscribeToken),
      ],
    }),
  },
  signature: (ctx) => ['--', ctx.hotel.name, ctx.hotel.address, ctx.links.top()],
};
