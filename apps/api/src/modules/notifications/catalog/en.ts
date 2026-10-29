// メールの文面（英語）。design.md P-15 の12のテンプレート。訳文はモデルが作ったもの（母語話者の確認を勧める）。
import type { GuestCounts, PaymentMethod, PaymentRecordMethod } from '@hotel/contracts';
import { HOTEL_HOURS } from '../hotel-profile.js';
import { lineIf, translated, type MailCatalog, type TemplateContext } from './types.js';

const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  PREPAID: 'Prepayment',
  PAY_AT_HOTEL: 'Pay at the hotel',
};

const RECORD_METHODS: Record<PaymentRecordMethod, string> = {
  CARD_ON_FILE: 'Registered card',
  CASH: 'Cash',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  OTHER: 'Other',
};

/** 口座種別（hotel_settings の日本語の値）の訳。対応表にない値はそのまま示す */
const ACCOUNT_TYPES: Readonly<Record<string, string>> = {
  普通: 'Ordinary',
  当座: 'Current',
  貯蓄: 'Savings',
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function guests(g: GuestCounts): string {
  return [
    plural(g.adults, 'adult', 'adults'),
    ...lineIf(g.children > 0, plural(g.children, 'child', 'children')),
    ...lineIf(g.infants > 0, plural(g.infants, 'infant', 'infants')),
  ].join(', ');
}

function stay(ctx: TemplateContext, p: { arrivalDate: string; departureDate: string }): string {
  const { f } = ctx;
  const nights = f.nights(p.arrivalDate, p.departureDate);
  return `Stay: ${f.date(p.arrivalDate)} – ${f.date(p.departureDate)} (${plural(nights, 'night', 'nights')})`;
}

const subject = (ctx: TemplateContext, text: string) => `[${ctx.hotel.name}] ${text}`;

export const en: MailCatalog = {
  templates: {
    VERIFY_EMAIL: (p, ctx) => ({
      subject: subject(ctx, 'Please confirm your email address'),
      lines: [
        'To confirm your email address, please open the following link within 24 hours.',
        ctx.links.verifyEmail(p.token),
        '',
        'If you did not request this, please ignore this email.',
      ],
    }),
    PASSWORD_RESET: (p, ctx) => ({
      subject: subject(ctx, 'Reset your password'),
      lines: [
        'We received a request to reset your password. Please open the following link within 1 hour and set a new password.',
        ctx.links.passwordReset(p.token),
        '',
        'If you did not make this request, please ignore this email. Your password will not be changed.',
      ],
    }),
    RESERVATION_CONFIRMED: (p, ctx) => {
      const { f } = ctx;
      return {
        subject: subject(
          ctx,
          `Your reservation is confirmed (Reservation No. ${p.reservationNumber})`,
        ),
        lines: [
          'Thank you for your reservation. Your reservation has been confirmed as follows.',
          '',
          `Reservation No.: ${p.reservationNumber}`,
          `Room type: ${p.roomTypeName}`,
          stay(ctx, p),
          `Rooms: ${f.count(p.roomCount)}`,
          `Guests: ${guests(p.guests)}`,
          `Payment method: ${PAYMENT_METHODS[p.paymentMethod]}`,
          `Total (tax included): ${f.yen(p.totalAmount)}`,
          ...lineIf(
            p.paymentMethod === 'PREPAID',
            `Amount paid in advance: ${f.yen(p.totalAmount - p.payAtHotelAmount)}`,
          ),
          ...lineIf(
            p.payAtHotelAmount > 0,
            `Amount payable at the hotel: ${f.yen(p.payAtHotelAmount)}`,
          ),
          '',
          ...(p.earlyBird
            ? [
                'As this is an early-bird reservation, no refund will be made for a cancellation or for a change that reduces your stay.',
              ]
            : p.freeCancellationDeadline === null
              ? []
              : [`Free cancellation until: ${f.dateTime(p.freeCancellationDeadline)}`]),
          `Check-in: from ${f.hour(HOTEL_HOURS.checkIn)} / Check-out: by ${f.hour(HOTEL_HOURS.checkOut)} (Japan time)`,
          '',
          'To view, change, or cancel your reservation, please log in and go to My Page.',
          ctx.links.login(),
        ],
      };
    },
    PAYMENT_COMPLETED: (p, ctx) => ({
      subject: subject(ctx, `Payment received (Reservation No. ${p.reservationNumber})`),
      lines: [
        'We have received the following payment. Thank you.',
        '',
        `Reservation No.: ${p.reservationNumber}`,
        `Amount: ${ctx.f.yen(p.amount)}`,
        `Payment method: ${RECORD_METHODS[p.method]}`,
      ],
    }),
    HOLD_EXPIRED: (p, ctx) => ({
      subject: subject(ctx, 'Your room hold has been released because the payment deadline passed'),
      lines: [
        'Because payment was not completed within the time limit (15 minutes), the rooms held for you have been released. Your reservation has not been confirmed.',
        '',
        `Room type: ${p.roomTypeName}`,
        stay(ctx, p),
        `Rooms: ${ctx.f.count(p.roomCount)}`,
        '',
        'If you still wish to stay with us, please make a new reservation.',
        ctx.links.top(),
      ],
    }),
    RESERVATION_CHANGED: (p, ctx) => {
      const { f } = ctx;
      const differences = [
        ...lineIf(
          p.chargedAmount > 0,
          `Additional payment (charged to your registered card): ${f.yen(p.chargedAmount)}`,
        ),
        ...lineIf(p.refundAmount > 0, `Amount to be refunded: ${f.yen(p.refundAmount)}`),
        ...lineIf(
          p.payAtHotelDelta > 0,
          `Increase in the amount payable at the hotel: ${f.yen(Math.abs(p.payAtHotelDelta))}`,
        ),
        ...lineIf(
          p.payAtHotelDelta < 0,
          `Decrease in the amount payable at the hotel: ${f.yen(Math.abs(p.payAtHotelDelta))}`,
        ),
        ...lineIf(p.cancellationFee > 0, `Cancellation fee: ${f.yen(p.cancellationFee)}`),
        ...lineIf(
          p.nonRefundableLodgingTax > 0,
          `Non-refundable accommodation tax: ${f.yen(p.nonRefundableLodgingTax)}`,
        ),
      ];
      return {
        subject: subject(
          ctx,
          `Your reservation has been changed (Reservation No. ${p.reservationNumber})`,
        ),
        lines: [
          'Your reservation has been changed. The updated details are as follows.',
          '',
          `Reservation No.: ${p.reservationNumber}`,
          `Room type: ${p.roomTypeName}`,
          stay(ctx, p),
          `Rooms: ${f.count(p.roomCount)}`,
          `Guests: ${guests(p.guests)}`,
          `New total (tax included): ${f.yen(p.totalAmount)}`,
          '',
          'Price difference',
          ...(differences.length > 0 ? differences : ['There is no price difference.']),
        ],
      };
    },
    RESERVATION_CANCELLED: (p, ctx) => {
      const { f } = ctx;
      return {
        subject: subject(
          ctx,
          `Your reservation has been cancelled (Reservation No. ${p.reservationNumber})`,
        ),
        lines: [
          'Your reservation has been cancelled.',
          '',
          `Reservation No.: ${p.reservationNumber}`,
          stay(ctx, p),
          `Cancellation fee: ${f.yen(p.cancellationFee)}`,
          ...lineIf(
            p.nonRefundableStayAmount > 0,
            `Non-refundable room charges: ${f.yen(p.nonRefundableStayAmount)}`,
          ),
          ...lineIf(
            p.nonRefundableLodgingTax > 0,
            `Non-refundable accommodation tax: ${f.yen(p.nonRefundableLodgingTax)}`,
          ),
          ...lineIf(p.refundAmount !== null, `Refund amount: ${f.yen(p.refundAmount ?? 0)}`),
        ],
      };
    },
    PRE_ARRIVAL: (p, ctx) => {
      const { f } = ctx;
      return {
        subject: subject(
          ctx,
          `Information for your arrival (Reservation No. ${p.reservationNumber})`,
        ),
        lines: [
          'We look forward to welcoming you tomorrow. Please check the following before your arrival.',
          '',
          `Reservation No.: ${p.reservationNumber}`,
          `Room type: ${p.roomTypeName}`,
          stay(ctx, p),
          `Rooms: ${f.count(p.roomCount)}`,
          '',
          `Check-in: ${f.hour(HOTEL_HOURS.checkIn)} – ${f.hour(HOTEL_HOURS.lastCheckIn)} (${f.hour(HOTEL_HOURS.lastCheckIn - 24)} the next day) (Japan time)`,
          ...lineIf(
            p.earlyCheckinHour !== null,
            `Early check-in: from ${f.hour(p.earlyCheckinHour ?? 0)}`,
          ),
          `Check-out: by ${f.hour(HOTEL_HOURS.checkOut)}`,
          '',
          'Access',
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
          `${noShow ? 'No-show fee' : 'Cancellation fee'} charged (Reservation No. ${p.reservationNumber})`,
        ),
        lines: [
          noShow
            ? 'A no-show fee has been charged because you did not check in on your arrival date.'
            : 'A cancellation fee has been charged in connection with the cancellation or change of your reservation.',
          '',
          `Reservation No.: ${p.reservationNumber}`,
          `Amount charged: ${f.yen(p.amount)}`,
          p.chargedTo === 'REGISTERED_CARD'
            ? 'This amount was charged to your registered card.'
            : 'This amount was deducted from the amount you paid in advance.',
          ...lineIf(nonRefundable, ''),
          ...lineIf(
            p.nonRefundableStayAmount > 0,
            `${noShow ? 'Non-refundable room charges for the second and later nights' : 'Non-refundable room charges'}: ${f.yen(p.nonRefundableStayAmount)}`,
          ),
          ...lineIf(
            p.nonRefundableLodgingTax > 0,
            `Non-refundable accommodation tax: ${f.yen(p.nonRefundableLodgingTax)}`,
          ),
          ...lineIf(
            nonRefundable,
            '* The non-refundable amounts are separate from the amount charged. They are the parts of your advance payment that will not be refunded.',
          ),
        ],
      };
    },
    REFUND_COMPLETED: (p, ctx) => ({
      subject: subject(
        ctx,
        `Your refund has been completed (Reservation No. ${p.reservationNumber})`,
      ),
      lines: [
        'The following refund has been completed.',
        '',
        `Reservation No.: ${p.reservationNumber}`,
        `Refund amount: ${ctx.f.yen(p.amount)}`,
        `Refund method: ${RECORD_METHODS[p.method]}`,
        ...lineIf(
          p.method === 'CARD_ON_FILE' || p.method === 'CARD',
          'For card refunds, it may take some time for the refund to appear on your statement, depending on your card issuer.',
        ),
      ],
    }),
    PAYMENT_REQUEST: (p, ctx) => ({
      subject: subject(ctx, `Request for payment (Reservation No. ${p.reservationNumber})`),
      lines: [
        'We were unable to charge the cancellation or no-show fee for your reservation to your registered card. We apologize for the inconvenience, but please transfer the following amount to the bank account below.',
        '',
        `Reservation No.: ${p.reservationNumber}`,
        `Amount due: ${ctx.f.yen(p.amount)}`,
        '',
        'Bank account for the transfer',
        `Bank: ${p.bankAccount.bankName}`,
        `Branch: ${p.bankAccount.branchName}`,
        `Account type: ${translated(ACCOUNT_TYPES, p.bankAccount.accountType)}`,
        `Account number: ${p.bankAccount.accountNumber}`,
        `Account holder: ${p.bankAccount.accountHolder}`,
        '',
        'If you have any questions, please contact the hotel.',
      ],
    }),
    MARKETING: (p, ctx) => ({
      subject: p.subject,
      lines: [
        ...p.body.split(/\r?\n/),
        '',
        '--',
        `Sender: ${ctx.hotel.name}`,
        `Address: ${ctx.hotel.address}`,
        'You are receiving this email because you agreed to receive our newsletters.',
        'To unsubscribe, please open the following link.',
        ctx.links.unsubscribe(p.unsubscribeToken),
      ],
    }),
  },
  signature: (ctx) => ['--', ctx.hotel.name, ctx.hotel.address, ctx.links.top()],
};
