// メールに載せるホテルの情報（送信者の名称・所在地・アクセス）と時刻（design.md P-15、要件 15.2・15.7、brief.md FC-03）。
//
// 架空のシナリオ（brief.md BG-01）の仮の値。名称は振込先の名義（hotel_settings の bank_transfer.account_holder）に
// 合わせた。本番で使う前に、実際の名称・所在地・アクセスに置き換える（管理者の設定（後のフェーズ）で変えられるようにするなら、
// hotel_settings と translations に移す）。訳文はモデルが作ったもの（母語話者の確認を勧める）。
import type { Locale } from '@hotel/contracts';
import { CHECK_IN_HOUR, OPERATING_DAY_START_HOUR } from '../../domain/calendar/business-date.js';

export interface HotelProfileText {
  /** 送信者の名称（特定電子メール法の表示。15.7） */
  readonly name: string;
  /** 所在地 */
  readonly address: string;
  /** アクセス（到着前の案内。15.2） */
  readonly access: string;
}

export const HOTEL_PROFILE: Readonly<Record<Locale, HotelProfileText>> = {
  ja: {
    name: 'サンプルホテル カナザワ',
    address: '〒920-0000 石川県金沢市サンプル町1-1',
    access: 'JR金沢駅 西口から徒歩約3分',
  },
  en: {
    name: 'Sample Hotel Kanazawa',
    address: '1-1 Sample-machi, Kanazawa, Ishikawa 920-0000, Japan',
    access: 'About a 3-minute walk from the West Exit of JR Kanazawa Station',
  },
  ko: {
    name: 'Sample Hotel Kanazawa',
    address: '〒920-0000 이시카와현 가나자와시 샘플초 1-1',
    access: 'JR 가나자와역 서쪽 출구에서 도보 약 3분',
  },
  'zh-Hans': {
    name: 'Sample Hotel Kanazawa',
    address: '〒920-0000 石川县金泽市样本町1-1',
    access: '从JR金泽站西口步行约3分钟',
  },
  'zh-Hant': {
    name: 'Sample Hotel Kanazawa',
    address: '〒920-0000 石川縣金澤市樣本町1-1',
    access: '從JR金澤站西口步行約3分鐘',
  },
};

/** チェックイン・最終チェックイン（25:00 ＝ 翌日 1:00）・チェックアウトの時刻（brief.md FC-03） */
export const HOTEL_HOURS = {
  checkIn: CHECK_IN_HOUR,
  lastCheckIn: 24 + OPERATING_DAY_START_HOUR,
  checkOut: 12,
} as const;
