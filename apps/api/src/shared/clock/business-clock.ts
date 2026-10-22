// 日本時間に固定した時計（design.md File Structure Plan の shared/clock、research.md ADR-10）。
// 「今」が必要な処理は、Date.now() や new Date() を直接使わず、必ずこの時計から時刻を得る。
// テストでは FixedBusinessClock に差し替えて、境界の時刻（25:00、9:00、前日10:00 など）を再現する。
// 営業日（1:00 が日の境目）などの暦のルールは domain/calendar の BusinessCalendar が受け持つ。
import { TZDate } from '@date-fns/tz';

/** 業務で使う時間帯。サーバーの時間帯の設定に左右されない */
export const BUSINESS_TIME_ZONE = 'Asia/Tokyo';

/**
 * 業務の時計。NestJS では、このクラスを依存の注入のトークンとして使う。
 */
export abstract class BusinessClock {
  /** 現在の時刻（瞬間） */
  abstract now(): Date;

  /**
   * 現在の時刻を日本時間の日時として返す。
   * getHours() や getDate() などが日本時間の値を返し、date-fns の関数も日本時間で計算する。
   */
  nowInJapan(): TZDate {
    return new TZDate(this.now().getTime(), BUSINESS_TIME_ZONE);
  }
}

/** 実際の時計 */
export class SystemBusinessClock extends BusinessClock {
  override now(): Date {
    return new Date();
  }
}

/** テスト用に、任意の時刻に固定できる時計（自然には進まない） */
export class FixedBusinessClock extends BusinessClock {
  private epochMs: number;

  /** @param instant 固定する時刻（Date、ISO 8601 の文字列、または UNIX 時間のミリ秒） */
  constructor(instant: Date | string | number) {
    super();
    this.epochMs = toEpochMs(instant);
  }

  override now(): Date {
    return new Date(this.epochMs);
  }

  /** 時刻を指定した時刻に変える */
  set(instant: Date | string | number): void {
    this.epochMs = toEpochMs(instant);
  }

  /** 時刻を指定したミリ秒だけ進める（負なら戻す） */
  advance(ms: number): void {
    this.epochMs = toEpochMs(this.epochMs + ms);
  }
}

function toEpochMs(instant: Date | string | number): number {
  const ms = new Date(instant).getTime();
  if (Number.isNaN(ms)) {
    throw new RangeError(`時刻として解釈できません: ${String(instant)}`);
  }
  return ms;
}
