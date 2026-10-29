// メールの文面（韓国語）。design.md P-15 の12のテンプレート。訳文はモデルが作ったもの（母語話者の確認を勧める）。
import type { GuestCounts, PaymentMethod, PaymentRecordMethod } from '@hotel/contracts';
import { HOTEL_HOURS } from '../hotel-profile.js';
import { lineIf, translated, type MailCatalog, type TemplateContext } from './types.js';

const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  PREPAID: '사전 결제',
  PAY_AT_HOTEL: '현지 결제',
};

const RECORD_METHODS: Record<PaymentRecordMethod, string> = {
  CARD_ON_FILE: '등록된 카드',
  CASH: '현금',
  CARD: '카드',
  BANK_TRANSFER: '은행 송금',
  OTHER: '기타',
};

/** 口座種別（hotel_settings の日本語の値）の訳。対応表にない値はそのまま示す */
const ACCOUNT_TYPES: Readonly<Record<string, string>> = {
  普通: '보통예금',
  当座: '당좌예금',
  貯蓄: '저축예금',
};

function guests(g: GuestCounts): string {
  return [
    `성인 ${g.adults}명`,
    ...lineIf(g.children > 0, `어린이 ${g.children}명`),
    ...lineIf(g.infants > 0, `유아 ${g.infants}명`),
  ].join(', ');
}

function stay(ctx: TemplateContext, p: { arrivalDate: string; departureDate: string }): string {
  const { f } = ctx;
  return `숙박일: ${f.date(p.arrivalDate)} ~ ${f.date(p.departureDate)}(${f.nights(p.arrivalDate, p.departureDate)}박)`;
}

const subject = (ctx: TemplateContext, text: string) => `[${ctx.hotel.name}] ${text}`;

export const ko: MailCatalog = {
  templates: {
    VERIFY_EMAIL: (p, ctx) => ({
      subject: subject(ctx, '이메일 주소 확인'),
      lines: [
        '이메일 주소를 확인하기 위해 24시간 이내에 아래 링크를 열어 주세요.',
        ctx.links.verifyEmail(p.token),
        '',
        '본인이 요청하지 않은 경우 이 메일을 무시해 주세요.',
      ],
    }),
    PASSWORD_RESET: (p, ctx) => ({
      subject: subject(ctx, '비밀번호 재설정'),
      lines: [
        '비밀번호 재설정 요청을 접수했습니다. 1시간 이내에 아래 링크를 열어 새 비밀번호를 설정해 주세요.',
        ctx.links.passwordReset(p.token),
        '',
        '요청하지 않으셨다면 이 메일을 무시해 주세요. 비밀번호는 변경되지 않습니다.',
      ],
    }),
    RESERVATION_CONFIRMED: (p, ctx) => {
      const { f } = ctx;
      return {
        subject: subject(ctx, `예약이 확정되었습니다(예약 번호 ${p.reservationNumber})`),
        lines: [
          '예약해 주셔서 감사합니다. 다음 내용으로 예약이 확정되었습니다.',
          '',
          `예약 번호: ${p.reservationNumber}`,
          `객실 타입: ${p.roomTypeName}`,
          stay(ctx, p),
          `객실 수: ${f.count(p.roomCount)}실`,
          `인원: ${guests(p.guests)}`,
          `결제 방법: ${PAYMENT_METHODS[p.paymentMethod]}`,
          `합계 금액(세금 포함): ${f.yen(p.totalAmount)}`,
          ...lineIf(
            p.paymentMethod === 'PREPAID',
            `사전 결제 금액: ${f.yen(p.totalAmount - p.payAtHotelAmount)}`,
          ),
          ...lineIf(p.payAtHotelAmount > 0, `현지에서 지불하실 금액: ${f.yen(p.payAtHotelAmount)}`),
          '',
          ...(p.earlyBird
            ? [
                '얼리버드 예약이므로 취소하거나 숙박 일수 등을 줄이는 변경을 해도 환불되지 않습니다.',
              ]
            : p.freeCancellationDeadline === null
              ? []
              : [`무료 취소 기한: ${f.dateTime(p.freeCancellationDeadline)}`]),
          `체크인: ${f.hour(HOTEL_HOURS.checkIn)}부터 / 체크아웃: ${f.hour(HOTEL_HOURS.checkOut)}까지(일본 시간)`,
          '',
          '예약 확인·변경·취소는 로그인 후 마이페이지에서 하실 수 있습니다.',
          ctx.links.login(),
        ],
      };
    },
    PAYMENT_COMPLETED: (p, ctx) => ({
      subject: subject(ctx, `결제가 완료되었습니다(예약 번호 ${p.reservationNumber})`),
      lines: [
        '다음 결제를 접수했습니다. 감사합니다.',
        '',
        `예약 번호: ${p.reservationNumber}`,
        `결제 금액: ${ctx.f.yen(p.amount)}`,
        `결제 방법: ${RECORD_METHODS[p.method]}`,
      ],
    }),
    HOLD_EXPIRED: (p, ctx) => ({
      subject: subject(ctx, '결제 기한이 지나 객실 확보가 해제되었습니다'),
      lines: [
        '결제 절차가 기한(15분) 내에 완료되지 않아 확보해 둔 객실을 해제했습니다. 예약은 확정되지 않았습니다.',
        '',
        `객실 타입: ${p.roomTypeName}`,
        stay(ctx, p),
        `객실 수: ${ctx.f.count(p.roomCount)}실`,
        '',
        '숙박을 원하시면 다시 예약해 주세요.',
        ctx.links.top(),
      ],
    }),
    RESERVATION_CHANGED: (p, ctx) => {
      const { f } = ctx;
      const differences = [
        ...lineIf(
          p.chargedAmount > 0,
          `추가 결제(등록된 카드로 결제했습니다): ${f.yen(p.chargedAmount)}`,
        ),
        ...lineIf(p.refundAmount > 0, `환불 예정 금액: ${f.yen(p.refundAmount)}`),
        ...lineIf(
          p.payAtHotelDelta > 0,
          `현지에서 지불하실 금액 증가: ${f.yen(Math.abs(p.payAtHotelDelta))}`,
        ),
        ...lineIf(
          p.payAtHotelDelta < 0,
          `현지에서 지불하실 금액 감소: ${f.yen(Math.abs(p.payAtHotelDelta))}`,
        ),
        ...lineIf(p.cancellationFee > 0, `취소 수수료: ${f.yen(p.cancellationFee)}`),
        ...lineIf(
          p.nonRefundableLodgingTax > 0,
          `환불되지 않는 숙박세: ${f.yen(p.nonRefundableLodgingTax)}`,
        ),
      ];
      return {
        subject: subject(ctx, `예약 변경이 완료되었습니다(예약 번호 ${p.reservationNumber})`),
        lines: [
          '예약 변경이 완료되었습니다. 변경 후 예약 내용은 다음과 같습니다.',
          '',
          `예약 번호: ${p.reservationNumber}`,
          `객실 타입: ${p.roomTypeName}`,
          stay(ctx, p),
          `객실 수: ${f.count(p.roomCount)}실`,
          `인원: ${guests(p.guests)}`,
          `변경 후 합계 금액(세금 포함): ${f.yen(p.totalAmount)}`,
          '',
          '차액',
          ...(differences.length > 0 ? differences : ['차액은 없습니다.']),
        ],
      };
    },
    RESERVATION_CANCELLED: (p, ctx) => {
      const { f } = ctx;
      return {
        subject: subject(ctx, `예약 취소가 완료되었습니다(예약 번호 ${p.reservationNumber})`),
        lines: [
          '예약 취소가 완료되었습니다.',
          '',
          `예약 번호: ${p.reservationNumber}`,
          stay(ctx, p),
          `취소 수수료: ${f.yen(p.cancellationFee)}`,
          ...lineIf(
            p.nonRefundableStayAmount > 0,
            `환불되지 않는 숙박 요금: ${f.yen(p.nonRefundableStayAmount)}`,
          ),
          ...lineIf(
            p.nonRefundableLodgingTax > 0,
            `환불되지 않는 숙박세: ${f.yen(p.nonRefundableLodgingTax)}`,
          ),
          ...lineIf(p.refundAmount !== null, `환불 금액: ${f.yen(p.refundAmount ?? 0)}`),
        ],
      };
    },
    PRE_ARRIVAL: (p, ctx) => {
      const { f } = ctx;
      return {
        subject: subject(ctx, `도착 안내(예약 번호 ${p.reservationNumber})`),
        lines: [
          '내일 도착을 기다리고 있겠습니다. 도착 전에 다음 내용을 확인해 주세요.',
          '',
          `예약 번호: ${p.reservationNumber}`,
          `객실 타입: ${p.roomTypeName}`,
          stay(ctx, p),
          `객실 수: ${f.count(p.roomCount)}실`,
          '',
          `체크인: ${f.hour(HOTEL_HOURS.checkIn)}~${f.hour(HOTEL_HOURS.lastCheckIn)}(다음 날 ${f.hour(HOTEL_HOURS.lastCheckIn - 24)})(일본 시간)`,
          ...lineIf(
            p.earlyCheckinHour !== null,
            `얼리 체크인: ${f.hour(p.earlyCheckinHour ?? 0)}부터`,
          ),
          `체크아웃: ${f.hour(HOTEL_HOURS.checkOut)}까지`,
          '',
          '오시는 길',
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
          `${noShow ? '노쇼 요금' : '취소 수수료'} 청구(예약 번호 ${p.reservationNumber})`,
        ),
        lines: [
          noShow
            ? '도착일에 체크인하지 않으셔서 노쇼 요금을 청구했습니다.'
            : '예약 취소 또는 변경에 따라 취소 수수료를 청구했습니다.',
          '',
          `예약 번호: ${p.reservationNumber}`,
          `청구 금액: ${f.yen(p.amount)}`,
          p.chargedTo === 'REGISTERED_CARD'
            ? '등록된 카드로 청구했습니다.'
            : '사전에 결제하신 금액에서 공제했습니다.',
          ...lineIf(nonRefundable, ''),
          ...lineIf(
            p.nonRefundableStayAmount > 0,
            `${noShow ? '환불되지 않는 2박째 이후 숙박 요금' : '환불되지 않는 숙박 요금'}: ${f.yen(p.nonRefundableStayAmount)}`,
          ),
          ...lineIf(
            p.nonRefundableLodgingTax > 0,
            `환불되지 않는 숙박세: ${f.yen(p.nonRefundableLodgingTax)}`,
          ),
          ...lineIf(
            nonRefundable,
            '※ 환불되지 않는 금액은 청구 금액과 별도로, 사전에 결제하신 금액 중 환불되지 않는 부분입니다.',
          ),
        ],
      };
    },
    REFUND_COMPLETED: (p, ctx) => ({
      subject: subject(ctx, `환불이 완료되었습니다(예약 번호 ${p.reservationNumber})`),
      lines: [
        '다음 환불이 완료되었습니다.',
        '',
        `예약 번호: ${p.reservationNumber}`,
        `환불 금액: ${ctx.f.yen(p.amount)}`,
        `환불 방법: ${RECORD_METHODS[p.method]}`,
        ...lineIf(
          p.method === 'CARD_ON_FILE' || p.method === 'CARD',
          '카드 환불은 카드사 처리에 따라 이용 내역에 반영되기까지 시간이 걸릴 수 있습니다.',
        ),
      ],
    }),
    PAYMENT_REQUEST: (p, ctx) => ({
      subject: subject(ctx, `결제 요청(예약 번호 ${p.reservationNumber})`),
      lines: [
        '예약의 취소 수수료·노쇼 요금을 등록된 카드로 청구할 수 없었습니다. 번거로우시겠지만 아래 계좌로 다음 금액을 송금해 주세요.',
        '',
        `예약 번호: ${p.reservationNumber}`,
        `결제하실 금액: ${ctx.f.yen(p.amount)}`,
        '',
        '송금 계좌',
        `은행명: ${p.bankAccount.bankName}`,
        `지점명: ${p.bankAccount.branchName}`,
        `계좌 종류: ${translated(ACCOUNT_TYPES, p.bankAccount.accountType)}`,
        `계좌 번호: ${p.bankAccount.accountNumber}`,
        `예금주: ${p.bankAccount.accountHolder}`,
        '',
        '문의 사항이 있으시면 호텔로 연락해 주세요.',
      ],
    }),
    MARKETING: (p, ctx) => ({
      subject: p.subject,
      lines: [
        ...p.body.split(/\r?\n/),
        '',
        '--',
        `발신자: ${ctx.hotel.name}`,
        `주소: ${ctx.hotel.address}`,
        '이 메일은 정기 메일 수신에 동의하신 회원님께 보내드리고 있습니다.',
        '수신을 중단하려면 아래 링크를 열어 주세요.',
        ctx.links.unsubscribe(p.unsubscribeToken),
      ],
    }),
  },
  signature: (ctx) => ['--', ctx.hotel.name, ctx.hotel.address, ctx.links.top()],
};
