// お知らせのメッセージ（F03 のダイアログに出す本文。要件 10.8・10.10・10.11・10.14、design-screens.md F03）。
// スタッフ向けなので日本語だけ。作った時点の内容を notices.message に保存する（後で予約などが変わっても書き換えない）。
// 宿泊客の氏名・連絡先などの個人情報は入れない（客室タイプ・日付・予約番号・部屋番号・時刻だけ）。
import { parseDate } from '../../domain/calendar/business-date.js';
import type { CheckinTime, CheckoutTime } from '../../domain/turnover/turnover-gap.js';

/** 連泊できない在庫なし（FRAGMENTED_INVENTORY。例：「スタンダード キング 11/3〜11/5：各夜に空室はありますが、…」） */
export function fragmentedInventoryMessage(input: {
  roomTypeName: string;
  arrivalDate: string;
  departureDate: string;
}): string {
  return `${input.roomTypeName} ${monthDay(input.arrivalDate)}〜${monthDay(input.departureDate)}：各夜に空室はありますが、連泊できる部屋がありません`;
}

/** 離れた部屋（SPLIT_FLOORS。予約番号・室数・部屋番号） */
export function splitFloorsMessage(input: {
  reservationNumber: string;
  roomNumbers: readonly number[];
}): string {
  const rooms = [...input.roomNumbers].sort((a, b) => a - b);
  return `予約 ${input.reservationNumber}：${rooms.length}室が同じ階に収まらず、離れた階の部屋になっています（${rooms.join('・')}号室）`;
}

/** 清掃時間の不足（TURNOVER_GAP。部屋・日付・両方の時刻。要件 10.11） */
export function turnoverGapMessage(input: {
  roomNumber: number;
  date: string;
  checkout: CheckoutTime;
  checkin: CheckinTime;
  gapMinutes: number;
}): string {
  const checkout = `前の客の${input.checkout.late ? 'レイトチェックアウト' : 'チェックアウト'} ${clockTime(input.checkout.minutes)}`;
  const checkin = `次の客の${input.checkin.early ? 'アーリーチェックイン' : 'チェックイン'} ${clockTime(input.checkin.minutes)}`;
  const prefix = `${input.roomNumber}号室 ${monthDay(input.date)}：`;
  if (input.gapMinutes > 0) {
    return `${prefix}${checkout} から${checkin} まで${duration(input.gapMinutes)}しかありません`;
  }
  if (input.gapMinutes === 0) {
    return `${prefix}${checkout} と${checkin} が同じ時刻で、清掃の時間がありません`;
  }
  return `${prefix}${checkout} が${checkin} より後です（時刻が逆転しています）`;
}

/** YYYY-MM-DD → 「11/3」（F03 の例の形） */
function monthDay(date: string): string {
  const { month, day } = parseDate(date);
  return `${month}/${day}`;
}

/** 0:00 からの分 → 「14:00」 */
function clockTime(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** 分 → 「1時間」「1時間59分」「59分」 */
function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}分`;
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
}
