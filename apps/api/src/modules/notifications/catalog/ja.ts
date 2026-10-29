// メールの文面（日本語）。design.md P-15 の12のテンプレート。
import type { GuestCounts, PaymentMethod, PaymentRecordMethod } from '@hotel/contracts';
import { HOTEL_HOURS } from '../hotel-profile.js';
import { lineIf, type MailCatalog, type TemplateContext } from './types.js';

const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  PREPAID: '事前決済',
  PAY_AT_HOTEL: '現地払い',
};

const RECORD_METHODS: Record<PaymentRecordMethod, string> = {
  CARD_ON_FILE: 'ご登録のカード',
  CASH: '現金',
  CARD: 'カード',
  BANK_TRANSFER: '銀行振込',
  OTHER: 'その他',
};

function guests(g: GuestCounts): string {
  return [
    `大人${g.adults}名`,
    ...lineIf(g.children > 0, `子ども${g.children}名`),
    ...lineIf(g.infants > 0, `幼児${g.infants}名`),
  ].join('・');
}

function stay(ctx: TemplateContext, p: { arrivalDate: string; departureDate: string }): string {
  const { f } = ctx;
  return `宿泊日：${f.date(p.arrivalDate)} 〜 ${f.date(p.departureDate)}（${f.nights(p.arrivalDate, p.departureDate)}泊）`;
}

const subject = (ctx: TemplateContext, text: string) => `【${ctx.hotel.name}】${text}`;

export const ja: MailCatalog = {
  templates: {
    VERIFY_EMAIL: (p, ctx) => ({
      subject: subject(ctx, 'メールアドレスの確認'),
      lines: [
        'メールアドレスを確認するため、24時間以内に次のリンクを開いてください。',
        ctx.links.verifyEmail(p.token),
        '',
        'このメールに心当たりがない場合は、このまま破棄してください。',
      ],
    }),
    PASSWORD_RESET: (p, ctx) => ({
      subject: subject(ctx, 'パスワードの再設定'),
      lines: [
        'パスワードの再設定のお申し込みを受け付けました。1時間以内に次のリンクを開き、新しいパスワードを設定してください。',
        ctx.links.passwordReset(p.token),
        '',
        'お申し込みに心当たりがない場合は、このまま破棄してください。パスワードは変わりません。',
      ],
    }),
    RESERVATION_CONFIRMED: (p, ctx) => {
      const { f } = ctx;
      return {
        subject: subject(ctx, `ご予約が確定しました（予約番号 ${p.reservationNumber}）`),
        lines: [
          'ご予約ありがとうございます。次の内容でご予約が確定しました。',
          '',
          `予約番号：${p.reservationNumber}`,
          `客室タイプ：${p.roomTypeName}`,
          stay(ctx, p),
          `室数：${f.count(p.roomCount)}室`,
          `人数：${guests(p.guests)}`,
          `お支払い方法：${PAYMENT_METHODS[p.paymentMethod]}`,
          `合計金額（税込）：${f.yen(p.totalAmount)}`,
          ...lineIf(
            p.paymentMethod === 'PREPAID',
            `事前にお支払いいただいた金額：${f.yen(p.totalAmount - p.payAtHotelAmount)}`,
          ),
          ...lineIf(
            p.payAtHotelAmount > 0,
            `現地でお支払いいただく金額：${f.yen(p.payAtHotelAmount)}`,
          ),
          '',
          ...(p.earlyBird
            ? ['早期割のご予約のため、キャンセルや泊数などを減らす変更をしても、返金はありません。']
            : p.freeCancellationDeadline === null
              ? []
              : [`無料でキャンセルできる期限：${f.dateTime(p.freeCancellationDeadline)}`]),
          `チェックイン：${f.hour(HOTEL_HOURS.checkIn)}から ／ チェックアウト：${f.hour(HOTEL_HOURS.checkOut)}まで（日本時間）`,
          '',
          'ご予約の確認・変更・キャンセルは、ログインしてマイページから行えます。',
          ctx.links.login(),
        ],
      };
    },
    PAYMENT_COMPLETED: (p, ctx) => ({
      subject: subject(ctx, `お支払いを受け付けました（予約番号 ${p.reservationNumber}）`),
      lines: [
        '次のお支払いを受け付けました。ありがとうございます。',
        '',
        `予約番号：${p.reservationNumber}`,
        `お支払い金額：${ctx.f.yen(p.amount)}`,
        `お支払い方法：${RECORD_METHODS[p.method]}`,
      ],
    }),
    HOLD_EXPIRED: (p, ctx) => ({
      subject: subject(ctx, 'お支払いの期限が過ぎたため、お部屋の確保を解除しました'),
      lines: [
        'お支払いの手続きが期限（15分）までに終わらなかったため、確保していたお部屋を解除しました。ご予約は確定していません。',
        '',
        `客室タイプ：${p.roomTypeName}`,
        stay(ctx, p),
        `室数：${ctx.f.count(p.roomCount)}室`,
        '',
        'ご宿泊をご希望の場合は、もう一度ご予約ください。',
        ctx.links.top(),
      ],
    }),
    RESERVATION_CHANGED: (p, ctx) => {
      const { f } = ctx;
      const differences = [
        ...lineIf(
          p.chargedAmount > 0,
          `追加のお支払い（ご登録のカードで決済しました）：${f.yen(p.chargedAmount)}`,
        ),
        ...lineIf(p.refundAmount > 0, `返金する金額：${f.yen(p.refundAmount)}`),
        ...lineIf(
          p.payAtHotelDelta > 0,
          `現地でお支払いいただく金額の増額：${f.yen(Math.abs(p.payAtHotelDelta))}`,
        ),
        ...lineIf(
          p.payAtHotelDelta < 0,
          `現地でお支払いいただく金額の減額：${f.yen(Math.abs(p.payAtHotelDelta))}`,
        ),
        ...lineIf(p.cancellationFee > 0, `キャンセル料：${f.yen(p.cancellationFee)}`),
        ...lineIf(
          p.nonRefundableLodgingTax > 0,
          `返金しない宿泊税：${f.yen(p.nonRefundableLodgingTax)}`,
        ),
      ];
      return {
        subject: subject(ctx, `ご予約の変更が完了しました（予約番号 ${p.reservationNumber}）`),
        lines: [
          'ご予約の変更が完了しました。変更後のご予約の内容は次のとおりです。',
          '',
          `予約番号：${p.reservationNumber}`,
          `客室タイプ：${p.roomTypeName}`,
          stay(ctx, p),
          `室数：${f.count(p.roomCount)}室`,
          `人数：${guests(p.guests)}`,
          `変更後の合計金額（税込）：${f.yen(p.totalAmount)}`,
          '',
          '差額',
          ...(differences.length > 0 ? differences : ['差額はありません。']),
        ],
      };
    },
    RESERVATION_CANCELLED: (p, ctx) => {
      const { f } = ctx;
      return {
        subject: subject(
          ctx,
          `ご予約のキャンセルが完了しました（予約番号 ${p.reservationNumber}）`,
        ),
        lines: [
          'ご予約のキャンセルが完了しました。',
          '',
          `予約番号：${p.reservationNumber}`,
          stay(ctx, p),
          `キャンセル料：${f.yen(p.cancellationFee)}`,
          ...lineIf(
            p.nonRefundableStayAmount > 0,
            `返金しない宿泊料金：${f.yen(p.nonRefundableStayAmount)}`,
          ),
          ...lineIf(
            p.nonRefundableLodgingTax > 0,
            `返金しない宿泊税：${f.yen(p.nonRefundableLodgingTax)}`,
          ),
          ...lineIf(p.refundAmount !== null, `返金額：${f.yen(p.refundAmount ?? 0)}`),
        ],
      };
    },
    PRE_ARRIVAL: (p, ctx) => {
      const { f } = ctx;
      return {
        subject: subject(ctx, `ご到着日のご案内（予約番号 ${p.reservationNumber}）`),
        lines: [
          '明日のご到着をお待ちしております。ご到着の前に、次の内容をご確認ください。',
          '',
          `予約番号：${p.reservationNumber}`,
          `客室タイプ：${p.roomTypeName}`,
          stay(ctx, p),
          `室数：${f.count(p.roomCount)}室`,
          '',
          `チェックイン：${f.hour(HOTEL_HOURS.checkIn)}〜${f.hour(HOTEL_HOURS.lastCheckIn)}（翌日${f.hour(HOTEL_HOURS.lastCheckIn - 24)}）（日本時間）`,
          ...lineIf(
            p.earlyCheckinHour !== null,
            `アーリーチェックイン：${f.hour(p.earlyCheckinHour ?? 0)}から`,
          ),
          `チェックアウト：${f.hour(HOTEL_HOURS.checkOut)}まで`,
          '',
          'アクセス',
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
          `${noShow ? 'ノーショー料金' : 'キャンセル料'}のご請求（予約番号 ${p.reservationNumber}）`,
        ),
        lines: [
          noShow
            ? 'ご到着日にチェックインがなかったため、ノーショー料金を請求しました。'
            : 'ご予約のキャンセルまたは変更に伴い、キャンセル料を請求しました。',
          '',
          `予約番号：${p.reservationNumber}`,
          `ご請求額：${f.yen(p.amount)}`,
          p.chargedTo === 'REGISTERED_CARD'
            ? 'ご登録のカードに請求しました。'
            : 'お支払い済みの金額から差し引きました。',
          ...lineIf(nonRefundable, ''),
          ...lineIf(
            p.nonRefundableStayAmount > 0,
            `${noShow ? '返金しない2泊目以降の宿泊料金' : '返金しない宿泊料金'}：${f.yen(p.nonRefundableStayAmount)}`,
          ),
          ...lineIf(
            p.nonRefundableLodgingTax > 0,
            `返金しない宿泊税：${f.yen(p.nonRefundableLodgingTax)}`,
          ),
          ...lineIf(
            nonRefundable,
            '※ 返金しない金額は、ご請求額とは別に、お支払い済みの金額のうち返金しない分です。',
          ),
        ],
      };
    },
    REFUND_COMPLETED: (p, ctx) => ({
      subject: subject(ctx, `返金が完了しました（予約番号 ${p.reservationNumber}）`),
      lines: [
        '次の返金が完了しました。',
        '',
        `予約番号：${p.reservationNumber}`,
        `返金額：${ctx.f.yen(p.amount)}`,
        `返金の方法：${RECORD_METHODS[p.method]}`,
        ...lineIf(
          p.method === 'CARD_ON_FILE' || p.method === 'CARD',
          'カードへの返金は、カード会社の処理により、ご利用明細に反映されるまで時間がかかる場合があります。',
        ),
      ],
    }),
    PAYMENT_REQUEST: (p, ctx) => ({
      subject: subject(ctx, `お支払いのお願い（予約番号 ${p.reservationNumber}）`),
      lines: [
        'ご予約のキャンセル料・ノーショー料金を、ご登録のカードに請求できませんでした。お手数ですが、次の金額を下記の口座へお振り込みください。',
        '',
        `予約番号：${p.reservationNumber}`,
        `お支払いいただく金額：${ctx.f.yen(p.amount)}`,
        '',
        'お振込先',
        `銀行名：${p.bankAccount.bankName}`,
        `支店名：${p.bankAccount.branchName}`,
        `口座の種類：${p.bankAccount.accountType}`,
        `口座番号：${p.bankAccount.accountNumber}`,
        `口座名義：${p.bankAccount.accountHolder}`,
        '',
        'ご不明な点は、ホテルまでお問い合わせください。',
      ],
    }),
    MARKETING: (p, ctx) => ({
      subject: p.subject,
      lines: [
        ...p.body.split(/\r?\n/),
        '',
        '--',
        `送信者：${ctx.hotel.name}`,
        `所在地：${ctx.hotel.address}`,
        'このメールは、定期配信メールの受信に同意いただいた会員の方にお送りしています。',
        '配信を停止するには、次のリンクを開いてください。',
        ctx.links.unsubscribe(p.unsubscribeToken),
      ],
    }),
  },
  signature: (ctx) => ['--', ctx.hotel.name, ctx.hotel.address, ctx.links.top()],
};
