// 早期割の率（要件 6.12、design.md P-01 手順1）。
//
// 早期割の対象かどうか（予約した日が、到着日の暦の上で3か月前の同じ日までか）は、夜の控えを作るときに
// domain/calendar の isEarlyBirdBooking で判定し、NightSnapshot.earlyBirdEligible（後から加えた人は
// AddedGuest.earlyBirdEligible）として渡す。料金の計算では判定し直さない。
import type { BasisPoints } from '@hotel/contracts';
import type { RateVersionValues } from './types.js';

/** 早期割の対象なら、その版の早期割の率（bp）。対象でなければ 0 */
export function earlyBirdDiscountBp(
  eligible: boolean,
  rateVersion: Pick<RateVersionValues, 'earlyBirdBp'>,
): BasisPoints {
  return eligible ? rateVersion.earlyBirdBp : 0;
}
