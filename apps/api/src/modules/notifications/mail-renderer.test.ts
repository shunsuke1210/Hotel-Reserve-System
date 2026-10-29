// メールのテンプレート（5言語）と文面の組み立てを、データベースなしで確かめる（tasks.md 3.4、design.md P-15）。
import { LOCALES, type Locale } from '@hotel/contracts';
import { describe, expect, it } from 'vitest';
import { SAMPLE_MAIL_PAYLOADS } from '../../test/mail.js';
import { MAIL_CATALOGS } from './catalog/index.js';
import { HOTEL_PROFILE } from './hotel-profile.js';
import { extractLinks, MailRenderError, renderMail } from './mail-renderer.js';
import { MAIL_TEMPLATES, type MailPayload, type MailTemplate } from './mail-templates.js';

const BASE = 'https://hotel.example.com';

function render<T extends MailTemplate>(
  template: T,
  locale: Locale,
  payload: MailPayload<T> = SAMPLE_MAIL_PAYLOADS[template],
) {
  return renderMail({ template, locale, payload }, { guestWebBaseUrl: BASE });
}

/** 本文の行 */
function linesOf(body: string): string[] {
  return body.split('\n');
}

describe('テンプレートの一覧（P-15）', () => {
  it('[15.1][16.2] P-15 の12のテンプレートのそれぞれに、ja・en・ko・zh-Hans・zh-Hant の5言語の文面がある（TC-MB-232）', () => {
    expect(MAIL_TEMPLATES).toEqual([
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
    ]);
    expect(Object.keys(MAIL_CATALOGS).sort()).toEqual([...LOCALES].sort());
    for (const locale of LOCALES) {
      expect(Object.keys(MAIL_CATALOGS[locale].templates).sort()).toEqual(
        [...MAIL_TEMPLATES].sort(),
      );
    }
  });

  it.each(MAIL_TEMPLATES)(
    '[15.1][16.2] %s は5言語とも、1行の件名と本文ができ、言語ごとに文面が違う（TC-MB-232）',
    (template) => {
      const bodies = new Set<string>();
      for (const locale of LOCALES) {
        const mail = render(template, locale);
        expect(mail.subject.trim()).not.toBe('');
        expect(mail.subject).not.toMatch(/[\r\n]/);
        expect(mail.body.trim()).not.toBe('');
        for (const text of [mail.subject, mail.body]) {
          expect(text).not.toMatch(/undefined|NaN|\[object|null/);
        }
        // 署名にホテルの名称が入る
        expect(mail.body).toContain(HOTEL_PROFILE[locale].name);
        bodies.add(mail.body);
      }
      expect(bodies.size).toBe(LOCALES.length);
    },
  );
});

describe('言語ごとの定型文と書き方（15.1、16.2、16.3）', () => {
  const CONFIRMED_SUBJECTS: Record<Locale, string> = {
    ja: 'ご予約が確定しました',
    en: 'Your reservation is confirmed',
    ko: '예약이 확정되었습니다',
    'zh-Hans': '预订已确认',
    'zh-Hant': '預訂已確認',
  };

  it.each(LOCALES)(
    '[15.1][16.2] RESERVATION_CONFIRMED の定型文は %s の言語になる（TC-MB-225〜229）',
    (locale) => {
      const mail = render('RESERVATION_CONFIRMED', locale);
      expect(mail.subject).toContain(CONFIRMED_SUBJECTS[locale]);
      expect(mail.subject).toContain('AB12CD34EF');
      for (const other of LOCALES.filter((l) => l !== locale)) {
        expect(mail.subject).not.toContain(CONFIRMED_SUBJECTS[other]);
      }
    },
  );

  it('[16.3] 金額は円の整数を、その言語の数字の書き方と単位で示す', () => {
    expect(render('RESERVATION_CONFIRMED', 'ja').body).toContain('61,900円');
    expect(render('RESERVATION_CONFIRMED', 'en').body).toContain('JPY 61,900');
    expect(render('RESERVATION_CONFIRMED', 'ko').body).toContain('61,900엔');
    expect(render('RESERVATION_CONFIRMED', 'zh-Hans').body).toContain('61,900日元');
    expect(render('RESERVATION_CONFIRMED', 'zh-Hant').body).toContain('61,900日圓');
  });

  it('[16.3] 日付はその言語の書き方で、時刻はどの言語でも日本時間で示す', () => {
    const ja = render('RESERVATION_CONFIRMED', 'ja').body;
    expect(ja).toContain('2026年11月20日(金)');
    // 無料で取り消せる期限 2026-11-18T06:00Z ＝ 日本時間の 15:00
    expect(ja).toContain('2026年11月18日 15:00（日本時間）');
    const en = render('RESERVATION_CONFIRMED', 'en').body;
    expect(en).toContain('Fri, November 20, 2026');
    expect(en).toContain('15:00 (Japan time)');
    expect(render('RESERVATION_CONFIRMED', 'ko').body).toContain('15:00(일본 시간)');
    expect(render('RESERVATION_CONFIRMED', 'zh-Hans').body).toContain('15:00（日本时间）');
    expect(render('RESERVATION_CONFIRMED', 'zh-Hant').body).toContain('15:00（日本時間）');
  });

  it('[4.22] 予約完了のメールに、予約番号・客室タイプ・宿泊日・泊数・室数・人数・支払い方法・合計を記載する', () => {
    const body = render('RESERVATION_CONFIRMED', 'ja').body;
    for (const text of [
      'AB12CD34EF',
      'スタンダード キング',
      '2泊',
      '1室',
      '大人2名・子ども1名',
      '事前決済',
      '合計金額（税込）：61,900円',
      '現地でお支払いいただく金額：2,000円',
    ]) {
      expect(body).toContain(text);
    }
    expect(body).not.toContain('幼児0名');
    const earlyBird = render('RESERVATION_CONFIRMED', 'ja', {
      ...SAMPLE_MAIL_PAYLOADS.RESERVATION_CONFIRMED,
      earlyBird: true,
      freeCancellationDeadline: null,
    }).body;
    expect(earlyBird).toContain('返金はありません');
    expect(earlyBird).not.toContain('無料でキャンセルできる期限');
  });
});

describe('テンプレートごとの記載内容', () => {
  it('[1.4] VERIFY_EMAIL：G06 への確認のリンク（トークンつき）と24時間の期限を記載する', () => {
    const mail = render('VERIFY_EMAIL', 'ko', { token: 'a/b+c=d' });
    expect(extractLinks(mail.body)).toContain(`${BASE}/verify-email?token=a%2Fb%2Bc%3Dd`);
    expect(render('VERIFY_EMAIL', 'ja').body).toContain('24時間');
  });

  it('[1.9] PASSWORD_RESET：G08 への再設定のリンクと1時間の期限を記載する', () => {
    const mail = render('PASSWORD_RESET', 'ja');
    expect(extractLinks(mail.body)).toContain(`${BASE}/password-reset?token=reset-token-abc`);
    expect(mail.body).toContain('1時間');
  });

  it('[7.16] RESERVATION_CHANGED：差額（追加の決済）を記載する（TC-CH-059）', () => {
    const body = render('RESERVATION_CHANGED', 'ja').body;
    expect(linesOf(body)).toContain('追加のお支払い（ご登録のカードで決済しました）：11,400円');
    const none = render('RESERVATION_CHANGED', 'ja', {
      ...SAMPLE_MAIL_PAYLOADS.RESERVATION_CHANGED,
      chargedAmount: 0,
    }).body;
    expect(none).toContain('差額はありません');
    const onsite = render('RESERVATION_CHANGED', 'en', {
      ...SAMPLE_MAIL_PAYLOADS.RESERVATION_CHANGED,
      chargedAmount: 0,
      payAtHotelDelta: -28_000,
      cancellationFee: 28_000,
    }).body;
    expect(onsite).toContain('JPY 28,000');
    expect(onsite).toMatch(/decrease/i);
  });

  it('[8.13] RESERVATION_CANCELLED：キャンセル料と返金しない宿泊税を別の行にし、返金額を記載する（DT-M7、TC-CH-186）', () => {
    const lines = linesOf(render('RESERVATION_CANCELLED', 'ja').body);
    expect(lines).toContain('キャンセル料：28,000円');
    expect(lines).toContain('返金しない宿泊税：400円');
    expect(lines).toContain('返金額：56,800円');
    const withoutTax = render('RESERVATION_CANCELLED', 'ja', {
      ...SAMPLE_MAIL_PAYLOADS.RESERVATION_CANCELLED,
      nonRefundableLodgingTax: 0,
      refundAmount: null,
    }).body;
    expect(withoutTax).not.toContain('宿泊税');
    expect(withoutTax).not.toContain('返金額');
  });

  it('[15.4] FEE_CHARGED（早期割のノーショー）：請求額は1泊目のノーショー料で、返金しない2泊目以降の宿泊料金と宿泊税（全泊）を別の行で示す（DT-M45、DT-M48、TC-CH-250）', () => {
    const body = render('FEE_CHARGED', 'ja').body;
    const lines = linesOf(body);
    expect(lines).toContain('ご請求額：24,600円');
    expect(lines).toContain('返金しない2泊目以降の宿泊料金：49,200円');
    expect(lines).toContain('返金しない宿泊税：1,200円');
    expect(body).not.toContain('75,000');
    expect(body).toContain('お支払い済みの金額から差し引きました');

    const card = render('FEE_CHARGED', 'ja', {
      reservationNumber: 'AB12CD34EF',
      reason: 'CANCELLATION',
      amount: 28_000,
      chargedTo: 'REGISTERED_CARD',
      nonRefundableStayAmount: 0,
      nonRefundableLodgingTax: 0,
    });
    expect(card.subject).toContain('キャンセル料');
    expect(linesOf(card.body)).toContain('ご請求額：28,000円');
    expect(card.body).toContain('ご登録のカードに請求しました');
    expect(card.body).not.toContain('返金しない');
  });

  it('[15.5] REFUND_COMPLETED：返金額と返金の方法を記載する', () => {
    const body = render('REFUND_COMPLETED', 'en').body;
    expect(body).toContain('JPY 56,800');
    expect(body).toContain('Registered card');
    expect(
      render('REFUND_COMPLETED', 'ja', { ...SAMPLE_MAIL_PAYLOADS.REFUND_COMPLETED, method: 'CASH' })
        .body,
    ).toContain('現金');
  });

  it('[15.2] PRE_ARRIVAL：チェックイン時刻とアクセスを記載する（TC-MB-254）', () => {
    for (const locale of LOCALES) {
      const body = render('PRE_ARRIVAL', locale).body;
      expect(body).toContain('15:00');
      expect(body).toContain(HOTEL_PROFILE[locale].access);
      expect(body).toContain(HOTEL_PROFILE[locale].address);
    }
    expect(
      render('PRE_ARRIVAL', 'ja', { ...SAMPLE_MAIL_PAYLOADS.PRE_ARRIVAL, earlyCheckinHour: 13 })
        .body,
    ).toContain('アーリーチェックイン：13:00');
  });

  it('[15.8] PAYMENT_REQUEST：未回収の額と振込先（銀行名・支店・口座種別・口座番号・名義）を、会員の言語で記載する（TC-CH-180、TC-MB-330）', () => {
    const ja = linesOf(render('PAYMENT_REQUEST', 'ja').body);
    for (const line of [
      'お支払いいただく金額：28,000円',
      '銀行名：サンプル銀行',
      '支店名：金沢支店',
      '口座の種類：普通',
      '口座番号：1234567',
      '口座名義：サンプルホテル カナザワ',
    ]) {
      expect(ja).toContain(line);
    }
    const en = render('PAYMENT_REQUEST', 'en');
    expect(en.subject).toContain('Request for payment');
    for (const text of ['JPY 28,000', 'サンプル銀行', '金沢支店', 'Ordinary', '1234567']) {
      expect(en.body).toContain(text);
    }
    // 対応表にない口座種別は、そのまま示す
    expect(
      render('PAYMENT_REQUEST', 'en', {
        ...SAMPLE_MAIL_PAYLOADS.PAYMENT_REQUEST,
        bankAccount: { ...SAMPLE_MAIL_PAYLOADS.PAYMENT_REQUEST.bankAccount, accountType: '別段' },
      }).body,
    ).toContain('別段');
  });

  it.each(LOCALES)(
    '[15.7] MARKETING（%s）：送信者の名称と、配信停止の URL（署名つきの値を含む G20 へのリンク）を必ず記載する（TC-MB-266、TC-MB-267）',
    (locale) => {
      const mail = render('MARKETING', locale, {
        subject: 'Winter news',
        body: 'Line 1\nLine 2',
        unsubscribeToken: 'u1.abc_DEF-123',
      });
      expect(mail.subject).toBe('Winter news');
      expect(mail.body).toContain('Line 1\nLine 2');
      expect(mail.body).toMatch(new RegExp(`.+[:：]\\s*${HOTEL_PROFILE[locale].name}`));
      expect(extractLinks(mail.body)).toContain(`${BASE}/unsubscribe?token=u1.abc_DEF-123`);
    },
  );
});

describe('誤った内容（送らずに失敗として数える）', () => {
  it('内容の形が誤っていれば MailRenderError（文言に値を出さない）', () => {
    let caught: unknown;
    try {
      renderMail(
        {
          template: 'PAYMENT_COMPLETED',
          locale: 'ja',
          payload: { reservationNumber: 'secret@example.com', amount: -1, method: 'CASH' },
        },
        { guestWebBaseUrl: BASE },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MailRenderError);
    expect((caught as MailRenderError).code).toBe('MAIL_RENDER_FAILED');
    expect((caught as Error).message).toContain('amount');
    expect((caught as Error).message).not.toContain('secret@example.com');
  });

  it('知らないテンプレート・言語は MailRenderError', () => {
    expect(() =>
      renderMail({ template: 'UNKNOWN', locale: 'ja', payload: {} }, { guestWebBaseUrl: BASE }),
    ).toThrow(MailRenderError);
    expect(() =>
      renderMail(
        { template: 'VERIFY_EMAIL', locale: 'fr', payload: { token: 't' } },
        { guestWebBaseUrl: BASE },
      ),
    ).toThrow(MailRenderError);
  });

  it('定期配信の件名に改行があれば断る（ヘッダーへの差し込みを防ぐ）', () => {
    expect(() =>
      render('MARKETING', 'ja', {
        subject: 'Hello\r\nBcc: x@example.com',
        body: 'b',
        unsubscribeToken: 't',
      }),
    ).toThrow(MailRenderError);
  });
});

/** 言語ごとに、本文にそのままの行として現れるべき記載（金額はその言語の書き方） */
interface LocaleExpectations {
  paymentRequest: string[];
  cancelled: string[];
  feeCharged: string[];
  feeChargedForChange: string[];
  changedDecrease: string[];
  changedIncrease: string;
  refundCompleted: string[];
  paymentCompleted: string[];
  confirmedTotal: string;
  accountTypeLabel: string;
}

const LOCALE_EXPECTATIONS: Record<Locale, LocaleExpectations> = {
  ja: {
    paymentRequest: [
      'お支払いいただく金額：28,000円',
      '銀行名：サンプル銀行',
      '支店名：金沢支店',
      '口座の種類：普通',
      '口座番号：1234567',
      '口座名義：サンプルホテル カナザワ',
    ],
    cancelled: [
      'キャンセル料：28,000円',
      '返金しない宿泊料金：12,300円',
      '返金しない宿泊税：400円',
      '返金額：56,800円',
    ],
    feeCharged: [
      'ご請求額：24,600円',
      '返金しない2泊目以降の宿泊料金：49,200円',
      '返金しない宿泊税：1,200円',
    ],
    feeChargedForChange: [
      'ご予約のキャンセルまたは変更に伴い、キャンセル料を請求しました。',
      'ご請求額：28,000円',
    ],
    changedDecrease: [
      '追加のお支払い（ご登録のカードで決済しました）：11,400円',
      '返金する金額：3,000円',
      '現地でお支払いいただく金額の減額：2,000円',
      'キャンセル料：14,000円',
      '返金しない宿泊税：200円',
    ],
    changedIncrease: '現地でお支払いいただく金額の増額：2,000円',
    refundCompleted: ['返金額：56,800円', '返金の方法：ご登録のカード'],
    paymentCompleted: ['お支払い金額：59,900円', 'お支払い方法：ご登録のカード'],
    confirmedTotal: '合計金額（税込）：61,900円',
    accountTypeLabel: '口座の種類：',
  },
  en: {
    paymentRequest: [
      'Amount due: JPY 28,000',
      'Bank: サンプル銀行',
      'Branch: 金沢支店',
      'Account type: Ordinary',
      'Account number: 1234567',
      'Account holder: サンプルホテル カナザワ',
    ],
    cancelled: [
      'Cancellation fee: JPY 28,000',
      'Non-refundable room charges: JPY 12,300',
      'Non-refundable accommodation tax: JPY 400',
      'Refund amount: JPY 56,800',
    ],
    feeCharged: [
      'Amount charged: JPY 24,600',
      'Non-refundable room charges for the second and later nights: JPY 49,200',
      'Non-refundable accommodation tax: JPY 1,200',
    ],
    feeChargedForChange: [
      'A cancellation fee has been charged in connection with the cancellation or change of your reservation.',
      'Amount charged: JPY 28,000',
    ],
    changedDecrease: [
      'Additional payment (charged to your registered card): JPY 11,400',
      'Amount to be refunded: JPY 3,000',
      'Decrease in the amount payable at the hotel: JPY 2,000',
      'Cancellation fee: JPY 14,000',
      'Non-refundable accommodation tax: JPY 200',
    ],
    changedIncrease: 'Increase in the amount payable at the hotel: JPY 2,000',
    refundCompleted: ['Refund amount: JPY 56,800', 'Refund method: Registered card'],
    paymentCompleted: ['Amount: JPY 59,900', 'Payment method: Registered card'],
    confirmedTotal: 'Total (tax included): JPY 61,900',
    accountTypeLabel: 'Account type: ',
  },
  ko: {
    paymentRequest: [
      '결제하실 금액: 28,000엔',
      '은행명: サンプル銀行',
      '지점명: 金沢支店',
      '계좌 종류: 보통예금',
      '계좌 번호: 1234567',
      '예금주: サンプルホテル カナザワ',
    ],
    cancelled: [
      '취소 수수료: 28,000엔',
      '환불되지 않는 숙박 요금: 12,300엔',
      '환불되지 않는 숙박세: 400엔',
      '환불 금액: 56,800엔',
    ],
    feeCharged: [
      '청구 금액: 24,600엔',
      '환불되지 않는 2박째 이후 숙박 요금: 49,200엔',
      '환불되지 않는 숙박세: 1,200엔',
    ],
    feeChargedForChange: [
      '예약 취소 또는 변경에 따라 취소 수수료를 청구했습니다.',
      '청구 금액: 28,000엔',
    ],
    changedDecrease: [
      '추가 결제(등록된 카드로 결제했습니다): 11,400엔',
      '환불 예정 금액: 3,000엔',
      '현지에서 지불하실 금액 감소: 2,000엔',
      '취소 수수료: 14,000엔',
      '환불되지 않는 숙박세: 200엔',
    ],
    changedIncrease: '현지에서 지불하실 금액 증가: 2,000엔',
    refundCompleted: ['환불 금액: 56,800엔', '환불 방법: 등록된 카드'],
    paymentCompleted: ['결제 금액: 59,900엔', '결제 방법: 등록된 카드'],
    confirmedTotal: '합계 금액(세금 포함): 61,900엔',
    accountTypeLabel: '계좌 종류: ',
  },
  'zh-Hans': {
    paymentRequest: [
      '应付金额：28,000日元',
      '银行名称：サンプル銀行',
      '支行名称：金沢支店',
      '账户类型：普通存款',
      '账号：1234567',
      '账户名：サンプルホテル カナザワ',
    ],
    cancelled: [
      '取消费：28,000日元',
      '不予退还的住宿费：12,300日元',
      '不予退还的住宿税：400日元',
      '退款金额：56,800日元',
    ],
    feeCharged: [
      '收取金额：24,600日元',
      '不予退还的第2晚及以后的住宿费：49,200日元',
      '不予退还的住宿税：1,200日元',
    ],
    feeChargedForChange: ['由于您取消或变更了预订，我们已收取取消费。', '收取金额：28,000日元'],
    changedDecrease: [
      '追加付款（已通过您登记的信用卡扣款）：11,400日元',
      '将退款的金额：3,000日元',
      '需在酒店支付的金额减少：2,000日元',
      '取消费：14,000日元',
      '不予退还的住宿税：200日元',
    ],
    changedIncrease: '需在酒店支付的金额增加：2,000日元',
    refundCompleted: ['退款金额：56,800日元', '退款方式：已登记的信用卡'],
    paymentCompleted: ['付款金额：59,900日元', '付款方式：已登记的信用卡'],
    confirmedTotal: '合计金额（含税）：61,900日元',
    accountTypeLabel: '账户类型：',
  },
  'zh-Hant': {
    paymentRequest: [
      '應付金額：28,000日圓',
      '銀行名稱：サンプル銀行',
      '分行名稱：金沢支店',
      '帳戶類型：普通存款',
      '帳號：1234567',
      '戶名：サンプルホテル カナザワ',
    ],
    cancelled: [
      '取消費：28,000日圓',
      '不予退還的住宿費：12,300日圓',
      '不予退還的住宿稅：400日圓',
      '退款金額：56,800日圓',
    ],
    feeCharged: [
      '收取金額：24,600日圓',
      '不予退還的第2晚及以後的住宿費：49,200日圓',
      '不予退還的住宿稅：1,200日圓',
    ],
    feeChargedForChange: ['由於您取消或變更了預訂，我們已收取取消費。', '收取金額：28,000日圓'],
    changedDecrease: [
      '追加付款（已透過您登記的信用卡扣款）：11,400日圓',
      '將退款的金額：3,000日圓',
      '需在飯店支付的金額減少：2,000日圓',
      '取消費：14,000日圓',
      '不予退還的住宿稅：200日圓',
    ],
    changedIncrease: '需在飯店支付的金額增加：2,000日圓',
    refundCompleted: ['退款金額：56,800日圓', '退款方式：已登記的信用卡'],
    paymentCompleted: ['付款金額：59,900日圓', '付款方式：已登記的信用卡'],
    confirmedTotal: '合計金額（含稅）：61,900日圓',
    accountTypeLabel: '帳戶類型：',
  },
};

describe.each(LOCALES)('%s の文面の金額と記載（要件 15.1・16.2・16.3）', (locale) => {
  const expected = LOCALE_EXPECTATIONS[locale];

  /** 本文の行に、期待する行がすべて（それぞれ1行として）あることを確かめる */
  function expectLines(body: string, lines: readonly string[]): void {
    const actual = linesOf(body);
    for (const line of lines) {
      expect(actual, `「${line}」の行がありません`).toContain(line);
    }
  }

  it('[15.8] PAYMENT_REQUEST：未回収の額と振込先の5項目（銀行名・支店・口座種別・口座番号・名義）', () => {
    expectLines(render('PAYMENT_REQUEST', locale).body, expected.paymentRequest);
  });

  it('[8.13] RESERVATION_CANCELLED：キャンセル料・返金しない宿泊料金・返金しない宿泊税・返金額を別の行に（DT-M7）', () => {
    expectLines(
      render('RESERVATION_CANCELLED', locale, {
        ...SAMPLE_MAIL_PAYLOADS.RESERVATION_CANCELLED,
        nonRefundableStayAmount: 12_300,
      }).body,
      expected.cancelled,
    );
  });

  it('[15.4] FEE_CHARGED：請求額と返金しない額（2泊目以降の宿泊料金・全泊の宿泊税）を別の行に（DT-M45、DT-M48）', () => {
    const body = render('FEE_CHARGED', locale).body;
    expectLines(body, expected.feeCharged);
    expect(body).not.toContain('75,000');
  });

  it('[15.4] FEE_CHARGED（キャンセル料）：キャンセルにも、日程の変更などの予約の変更にも当てはまる文面（DT-M44、TC-CH-249）', () => {
    const body = render('FEE_CHARGED', locale, {
      reservationNumber: 'AB12CD34EF',
      reason: 'CANCELLATION',
      amount: 28_000,
      chargedTo: 'REGISTERED_CARD',
      nonRefundableStayAmount: 0,
      nonRefundableLodgingTax: 0,
    }).body;
    expectLines(body, expected.feeChargedForChange);
  });

  it('[7.16] RESERVATION_CHANGED：差額（追加の決済・返金・現地で支払う額の増減・キャンセル料・返金しない宿泊税）', () => {
    const changed = {
      ...SAMPLE_MAIL_PAYLOADS.RESERVATION_CHANGED,
      chargedAmount: 11_400,
      refundAmount: 3_000,
      payAtHotelDelta: -2_000,
      cancellationFee: 14_000,
      nonRefundableLodgingTax: 200,
    };
    expectLines(render('RESERVATION_CHANGED', locale, changed).body, expected.changedDecrease);
    expectLines(
      render('RESERVATION_CHANGED', locale, { ...changed, payAtHotelDelta: 2_000 }).body,
      [expected.changedIncrease],
    );
  });

  it('[15.5][4.23] REFUND_COMPLETED・PAYMENT_COMPLETED：金額と方法', () => {
    expectLines(render('REFUND_COMPLETED', locale).body, expected.refundCompleted);
    expectLines(render('PAYMENT_COMPLETED', locale).body, expected.paymentCompleted);
  });

  it('[4.22] RESERVATION_CONFIRMED：合計（税込）', () => {
    expectLines(render('RESERVATION_CONFIRMED', locale).body, [expected.confirmedTotal]);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    '口座種別が対応表にない値（%s）なら、そのまま示す（Object の既定のプロパティを訳に使わない）',
    (accountType) => {
      const body = render('PAYMENT_REQUEST', locale, {
        ...SAMPLE_MAIL_PAYLOADS.PAYMENT_REQUEST,
        bankAccount: { ...SAMPLE_MAIL_PAYLOADS.PAYMENT_REQUEST.bankAccount, accountType },
      }).body;
      expectLines(body, [`${expected.accountTypeLabel}${accountType}`]);
      expect(body).not.toMatch(/function|\[object/);
    },
  );
});
