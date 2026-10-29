// 初期データの値（design.md「初期データ（seed）」、tasks.md 1.5）。投入の処理は seed.ts。
//
// 値のもと：
//   - 客室タイプ・室数・配置する階：brief.md FC-02・FC-04（架空の設定）
//   - 基本料金・朝食・割増・割引・時間外・宿泊税：brief.md 6.2〜6.4、RS-17、design.md の RateVersionValues
//   - 祝日：内閣府「国民の祝日」の一覧（holidays.ts と data/holidays.csv）
// 部屋の配置（各階のタイプの室数と並び）・タイプのコード・説明文・宿泊約款の文章・振込先・料金の版1の有効の開始は、
// 仕様で決まっていないので、ここで決めた（説明はそれぞれの定数のコメント）。
import type { RoomStatus } from '@hotel/contracts';

/** 客室タイプのコード（room_types.code。初期データの投入で、既にあるタイプかどうかを見分けるのにも使う） */
export const ROOM_TYPE_CODES = [
  'STANDARD_KING',
  'STANDARD_TWIN',
  'DELUXE_KING',
  'DELUXE_TWIN',
  'PREMIUM_KING',
  'SUITE',
  'KANAZAWA_SUITE',
] as const;
export type RoomTypeCode = (typeof ROOM_TYPE_CODES)[number];

export interface SeedRoomType {
  code: RoomTypeCode;
  nameJa: string;
  areaSqm: number;
  bedDescriptionJa: string;
  /** 定員（大人） */
  capacityAdults: number;
  /** 基準人数（補助ベッドを除いた、通常のベッドで寝られる人数。人数割の判定に使う） */
  standardOccupancy: number;
  /** 室数（brief.md FC-04。部屋の配置の検算に使う） */
  roomCount: number;
  /** 料金の版1の基本料金（税抜・大人1人1泊） */
  basePriceExcl: number;
  /** 説明（仮の文章。4言語の翻訳文は seed.ts の投入のときに作る） */
  descriptionJa: string;
}

/** 客室タイプ（brief.md FC-04 の表の順。display_order はこの順に 1 から） */
export const ROOM_TYPES: readonly SeedRoomType[] = [
  {
    code: 'STANDARD_KING',
    nameJa: 'スタンダード キング',
    areaSqm: 32,
    bedDescriptionJa: 'キング＋ソファーベッド',
    capacityAdults: 3,
    standardOccupancy: 2,
    roomCount: 100,
    basePriceExcl: 15_000,
    descriptionJa:
      '32㎡の客室に、キングサイズのベッド1台とソファーベッドを備えています。大人3名まで宿泊できます。',
  },
  {
    code: 'STANDARD_TWIN',
    nameJa: 'スタンダード ツイン',
    areaSqm: 32,
    bedDescriptionJa: 'シングル2＋ソファーベッド',
    capacityAdults: 3,
    standardOccupancy: 2,
    roomCount: 90,
    basePriceExcl: 15_000,
    descriptionJa:
      '32㎡の客室に、シングルベッド2台とソファーベッドを備えています。大人3名まで宿泊できます。',
  },
  {
    code: 'DELUXE_KING',
    nameJa: 'デラックス キング',
    areaSqm: 38,
    bedDescriptionJa: 'キング',
    capacityAdults: 2,
    standardOccupancy: 2,
    roomCount: 20,
    basePriceExcl: 18_000,
    descriptionJa:
      '38㎡のゆとりのある客室に、キングサイズのベッド1台を備えています。大人2名まで宿泊できます。',
  },
  {
    code: 'DELUXE_TWIN',
    nameJa: 'デラックス ツイン',
    areaSqm: 38,
    bedDescriptionJa: 'シングル2＋ソファーベッド',
    capacityAdults: 3,
    standardOccupancy: 2,
    roomCount: 20,
    basePriceExcl: 18_000,
    descriptionJa:
      '38㎡のゆとりのある客室に、シングルベッド2台とソファーベッドを備えています。大人3名まで宿泊できます。',
  },
  {
    code: 'PREMIUM_KING',
    nameJa: 'プレミアム キング',
    areaSqm: 46,
    bedDescriptionJa: 'キング＋ソファーベッド',
    capacityAdults: 3,
    standardOccupancy: 2,
    roomCount: 16,
    basePriceExcl: 23_000,
    descriptionJa:
      '13階の46㎡の客室に、キングサイズのベッド1台とソファーベッドを備えています。大人3名まで宿泊できます。',
  },
  {
    code: 'SUITE',
    nameJa: 'スイート',
    areaSqm: 64,
    bedDescriptionJa: 'キング＋リビング',
    capacityAdults: 4,
    standardOccupancy: 2,
    roomCount: 6,
    basePriceExcl: 40_000,
    descriptionJa:
      '13階の64㎡のスイートで、キングサイズのベッド1台の寝室とリビングがあります。大人4名まで宿泊できます。',
  },
  {
    code: 'KANAZAWA_SUITE',
    nameJa: '金沢スイート',
    areaSqm: 96,
    bedDescriptionJa: 'キング＋リビング',
    capacityAdults: 4,
    standardOccupancy: 2,
    roomCount: 1,
    basePriceExcl: 70_000,
    descriptionJa:
      '13階の96㎡の特別なスイートで、キングサイズのベッド1台の寝室と広いリビングがあります。大人4名まで宿泊できます。',
  },
];

/**
 * 各階の部屋の並び（部屋番号の小さい順に、タイプと室数）。部屋番号は「階×100＋1からの通し番号」。
 *
 * design.md の範囲（4〜12F は各階25〜26室で、スタンダード キング11〜12室・スタンダード ツイン10室・
 * デラックス キング／ツイン各2〜3室。13F はプレミアム キング16室・スイート6室・金沢スイート1室）の中で、
 * テストケース（.kiro/specs/…/test-cases）の部屋番号の前提に多く合うように決めた：
 *   - 各階はスタンダード キングから始める（501〜503・601・602・605・701・903・904・1001・1201 などがスタンダード キング）
 *   - デラックス キングが3室の階は 5F・6F（TC-OP-014・TC-OP-015）
 *   - スタンダード キングが12室の階は 4F（design.md の例「401〜426」。7F・9F は11室：TC-OP-008）
 */
export const FLOOR_LAYOUT: Readonly<Record<number, readonly (readonly [RoomTypeCode, number])[]>> =
  {
    4: [
      ['STANDARD_KING', 12],
      ['STANDARD_TWIN', 10],
      ['DELUXE_KING', 2],
      ['DELUXE_TWIN', 2],
    ],
    5: [
      ['STANDARD_KING', 11],
      ['STANDARD_TWIN', 10],
      ['DELUXE_KING', 3],
      ['DELUXE_TWIN', 2],
    ],
    6: [
      ['STANDARD_KING', 11],
      ['STANDARD_TWIN', 10],
      ['DELUXE_KING', 3],
      ['DELUXE_TWIN', 2],
    ],
    7: [
      ['STANDARD_KING', 11],
      ['STANDARD_TWIN', 10],
      ['DELUXE_KING', 2],
      ['DELUXE_TWIN', 3],
    ],
    8: [
      ['STANDARD_KING', 11],
      ['STANDARD_TWIN', 10],
      ['DELUXE_KING', 2],
      ['DELUXE_TWIN', 3],
    ],
    9: [
      ['STANDARD_KING', 11],
      ['STANDARD_TWIN', 10],
      ['DELUXE_KING', 2],
      ['DELUXE_TWIN', 2],
    ],
    10: [
      ['STANDARD_KING', 11],
      ['STANDARD_TWIN', 10],
      ['DELUXE_KING', 2],
      ['DELUXE_TWIN', 2],
    ],
    11: [
      ['STANDARD_KING', 11],
      ['STANDARD_TWIN', 10],
      ['DELUXE_KING', 2],
      ['DELUXE_TWIN', 2],
    ],
    12: [
      ['STANDARD_KING', 11],
      ['STANDARD_TWIN', 10],
      ['DELUXE_KING', 2],
      ['DELUXE_TWIN', 2],
    ],
    13: [
      ['PREMIUM_KING', 16],
      ['SUITE', 6],
      ['KANAZAWA_SUITE', 1],
    ],
  };

/** バリアフリーの部屋（スタンダード ツインの1室。4F のスタンダード ツインの最初の部屋にした） */
export const ACCESSIBLE_ROOM_NUMBER = 413;

/** 部屋の最初の状態（すぐに販売・チェックインできる「清掃完了」） */
export const INITIAL_ROOM_STATUS: RoomStatus = 'CLEAN';

/** 総客室数（brief.md FC-02） */
export const TOTAL_ROOM_COUNT = 253;

export interface SeedRoom {
  roomNumber: number;
  floor: number;
  roomTypeCode: RoomTypeCode;
  isAccessible: boolean;
}

/** FLOOR_LAYOUT から部屋の一覧を作る。室数が brief.md と合わなければ例外を投げる（配置の書き誤りを投入の前に止める） */
export function buildRooms(): SeedRoom[] {
  const rooms: SeedRoom[] = [];
  for (const [floorKey, blocks] of Object.entries(FLOOR_LAYOUT)) {
    const floor = Number(floorKey);
    let sequence = 0;
    for (const [roomTypeCode, count] of blocks) {
      for (let i = 0; i < count; i++) {
        sequence += 1;
        const roomNumber = floor * 100 + sequence;
        rooms.push({
          roomNumber,
          floor,
          roomTypeCode,
          isAccessible: roomNumber === ACCESSIBLE_ROOM_NUMBER,
        });
      }
    }
    if (sequence > 99)
      throw new Error(`${floor}F の部屋が100室以上あり、部屋番号が次の階と重なります`);
  }

  const problems: string[] = [];
  if (rooms.length !== TOTAL_ROOM_COUNT) {
    problems.push(`部屋の数が ${rooms.length} 室（${TOTAL_ROOM_COUNT} 室のはず）`);
  }
  for (const type of ROOM_TYPES) {
    const count = rooms.filter((room) => room.roomTypeCode === type.code).length;
    if (count !== type.roomCount) {
      problems.push(`${type.nameJa}が ${count} 室（${type.roomCount} 室のはず）`);
    }
  }
  const accessible = rooms.filter((room) => room.isAccessible);
  if (accessible.length !== 1 || accessible[0]?.roomTypeCode !== 'STANDARD_TWIN') {
    problems.push('バリアフリーの部屋が、スタンダード ツインの1室になっていない');
  }
  if (problems.length > 0) {
    throw new Error(`部屋の配置（FLOOR_LAYOUT）に誤りがあります：${problems.join('、')}`);
  }
  return rooms;
}

/**
 * 料金の版の値（rate_versions の列）。JSON の列の形は design.md の RateVersionValues と同じ
 * （headcountTiers・stayTiers・lodgingTaxBrackets）。率はベーシスポイント（1% ＝ 100）、金額は円。
 */
export interface SeedRateVersion {
  /** 有効の開始（新しい予約は effective_from ≦ 現在 のうち最も新しい版を使う。L-12） */
  effectiveFrom: Date;
  weekendSurchargeBp: number;
  headcountTiers: { minPersons: number; discountBp: number }[];
  stayTiers: { minNights: number; discountBp: number }[];
  earlyBirdBp: number;
  rateFloorBp: number;
  consumptionTaxBp: number;
  breakfastPriceExcl: number;
  offHoursPricePerHourIncl: number;
  lodgingTaxBrackets: { minExclTax: number; taxPerPersonNight: number }[];
}

/**
 * 料金の版1（design.md「初期データ」）。有効の開始は 2026-01-01 0:00（日本時間）にした
 * （テストケースで予約を確定する最も早い時刻 2026-08-01 より前で、運用を始める前の切りのよい日時）。
 */
export const RATE_VERSION_1: SeedRateVersion = {
  effectiveFrom: new Date('2026-01-01T00:00:00+09:00'),
  // 曜日割増（金・土・祝前日の夜）+20%（PR-11）
  weekendSurchargeBp: 2000,
  // 人数割（判定人数）：1名 0%、2〜3名 5%、4〜9名 10%、10名以上 15%（PR-13）
  headcountTiers: [
    { minPersons: 2, discountBp: 500 },
    { minPersons: 4, discountBp: 1000 },
    { minPersons: 10, discountBp: 1500 },
  ],
  // 連泊割：2〜4泊 10%、5泊以上 20%（PR-14）
  stayTiers: [
    { minNights: 2, discountBp: 1000 },
    { minNights: 5, discountBp: 2000 },
  ],
  // 早期割 10%（PR-15）
  earlyBirdBp: 1000,
  // 合算した率の下限 −50%（PR-06）
  rateFloorBp: -5000,
  // 消費税 10%（TX-01）
  consumptionTaxBp: 1000,
  // 朝食（大人1人1泊・税抜）3,500円
  breakfastPriceExcl: 3500,
  // アーリーチェックイン・レイトチェックアウト（1室1時間・税込み）1,000円（RS-17）
  offHoursPricePerHourIncl: 1000,
  // 金沢市の宿泊税（1人1泊の税抜の素泊まり料金で判定）：5,000円未満 0円、20,000円未満 200円、それ以上 500円（TX-02）
  lodgingTaxBrackets: [
    { minExclTax: 0, taxPerPersonNight: 0 },
    { minExclTax: 5000, taxPerPersonNight: 200 },
    { minExclTax: 20000, taxPerPersonNight: 500 },
  ],
};

/** 宿泊約款の版1（仮の文章。brief.md RS-16 のとおり、キャンセル規定と団体の扱いを含める） */
export const TERMS_VERSION_1 = {
  version: 1,
  // 料金の版1と同じ日時から公開する
  publishedAt: new Date('2026-01-01T00:00:00+09:00'),
  bodyJa: [
    '宿泊約款（仮）',
    '',
    'この約款は、システムの開発のための仮の文章です。運用を始める前に、ホテルが定める正式な約款に差し替えます。',
    '',
    '第1条（チェックイン・チェックアウト）',
    'チェックインは15:00から、最終のチェックインは25:00（翌日の1:00）まで、チェックアウトは12:00までとします。',
    '',
    '第2条（料金の支払い）',
    '料金は、予約のときの事前決済か、ご到着のときの現地払いのどちらかでお支払いいただきます。現地払いの場合は、会員登録のときに登録したクレジットカードをカード保証とし、キャンセル料はそのカードに請求します。',
    '',
    '第3条（キャンセル料：個人のご予約）',
    'ご到着日のチェックインの時刻（15:00）の48時間前までのキャンセルは無料です。それを過ぎてからのキャンセルは、1泊分（1泊目の宿泊料金の、全室・全員分）を申し受けます。',
    '',
    '第4条（キャンセル料：団体のご予約）',
    '予約の期間中に一度でも5室以上となったご予約は団体とし、その後に室数が減っても団体として扱います。団体のご予約のキャンセル料は、宿泊料金の総額に対して、ご到着日の30日前の0:00から20%、7日前の0:00から50%、前日の0:00から100%とします。',
    '',
    '第5条（早期割）',
    '早期割を適用した宿泊料金は、キャンセルしても返金しません。',
    '',
    '第6条（ご連絡のない不泊）',
    'ご連絡なく、ご到着日の25:00（翌日の1:00）までにチェックインされなかった場合は、1泊分を申し受け、2泊目以降のご予約を取り消します。早期割を適用したご予約は返金しません。',
    '',
    '第7条（キャンセル料の計算）',
    'キャンセル料は、宿泊料金（消費税を含みます）をもとに計算し、朝食などのオプションの料金と宿泊税は含めません。',
    '',
    '第8条（宿泊税）',
    '金沢市の宿泊税を、宿泊料金とは別に申し受けます。',
  ].join('\n'),
} as const;

/**
 * ホテル全体の設定（hotel_settings）。振込先は、未回収の支払いのお願いのメール（PAYMENT_REQUEST）と、
 * 未回収の額がある会員の退会の画面で示す（8.23、15.8、DT-M19）。値は架空のもの。
 */
export const HOTEL_SETTINGS: readonly { key: string; value: string }[] = [
  { key: 'bank_transfer.bank_name', value: 'サンプル銀行' },
  { key: 'bank_transfer.branch_name', value: '金沢支店' },
  { key: 'bank_transfer.account_type', value: '普通' },
  { key: 'bank_transfer.account_number', value: '1234567' },
  { key: 'bank_transfer.account_holder', value: 'サンプルホテル カナザワ' },
];
