// 状態の変更（スタッフの手動の変更）を断る理由と文言（design.md Error Handling の STATUS_TRANSITION_NOT_ALLOWED
// 「理由を表示（12.3）」、P-12、設計の補足 L-23、brief.md ST-01c・ST-03b）。
// 許すかどうかは domain/room-status の canChangeManually（2.5）が決め、ここでは断るときの理由だけを決める。
import { ROOM_STATUSES, STAFF_ROLES, type RoomStatus, type StaffRole } from '@hotel/contracts';
import { describe, expect, it } from 'vitest';
import { canChangeRoomStatusManually } from '../../domain/room-status/transitions.js';
import { manualChangeRejection } from './manual-change-rejection.js';

describe('状態の変更を断る理由', () => {
  it.each([
    ['TC-OP-193', 'CLEANER', 'CLEAN', 'STAY_CLEAN', 'CROSS_GROUP'],
    ['TC-OP-194', 'CLEANER', 'STAY_CLEAN', 'CLEAN', 'CROSS_GROUP'],
    ['TC-OP-195', 'CLEANER', 'DEPARTURE_PENDING', 'CLEANING_READY', 'CROSS_GROUP'],
    ['TC-OP-196', 'CLEANER', 'CLEAN', 'CHECKED_IN', 'CROSS_GROUP'],
    ['TC-OP-197', 'CLEANER', 'STAY_DIRTY', 'DEPARTURE_PENDING', 'CROSS_GROUP'],
    ['TC-OP-198', 'CLEANER', 'CHECKED_IN', 'DEPARTURE_PENDING', 'OTHER_GROUP'],
    ['TC-OP-199', 'CLEANER', 'NO_ARRIVAL', 'CLEANING_READY', 'NO_ARRIVAL_ONLY_TO_CLEAN'],
    ['TC-OP-201', 'CLEANER', 'OUT_OF_ORDER', 'CLEAN', 'OUT_OF_ORDER'],
    ['TC-OP-202', 'CLEANER', 'CLEAN', 'OUT_OF_ORDER', 'OUT_OF_ORDER'],
    ['TC-OP-272', 'CLEANER', 'OUT_OF_ORDER', 'CHECKED_IN', 'OUT_OF_ORDER'],
    ['TC-OP-273', 'CLEANER', 'NO_ARRIVAL', 'DEPARTURE_PENDING', 'NO_ARRIVAL_ONLY_TO_CLEAN'],
    ['TC-OP-212', 'FRONT', 'CLEAN', 'OUT_OF_ORDER', 'OUT_OF_ORDER'],
    ['TC-OP-213', 'FRONT', 'OUT_OF_ORDER', 'CLEAN', 'OUT_OF_ORDER'],
    ['L-23', 'ADMIN', 'CHECKED_IN', 'OUT_OF_ORDER', 'OUT_OF_ORDER'],
  ] as const)('[12.3] %s：%s の %s → %s は %s', (_id, role, from, to, reason) => {
    expect(manualChangeRejection(role, from, to)?.reason).toBe(reason);
  });

  it('[12.3] 文言は、断った理由を日本語で説明する（社内用 API。個人情報を含まない）', () => {
    expect(manualChangeRejection('CLEANER', 'CLEAN', 'STAY_CLEAN')?.message).toBe(
      'グループをまたぐ状態の変更は、フロント以上が行います',
    );
    expect(manualChangeRejection('CLEANER', 'CHECKED_IN', 'DEPARTURE_PENDING')?.message).toBe(
      '「その他」のグループ（チェックイン済み・チェックアウト待ち・来客なし・故障中）の中の変更は、フロント以上が行います',
    );
    expect(manualChangeRejection('CLEANER', 'NO_ARRIVAL', 'CLEANING_READY')?.message).toBe(
      '清掃員が「来客なし」から変えられるのは「清掃完了」だけです',
    );
    expect(manualChangeRejection('FRONT', 'CLEAN', 'OUT_OF_ORDER')?.message).toBe(
      '故障中への変更と故障中からの変更は、ここではできません。故障中の設定と修理の完了は、フロント以上が故障中の画面で行います',
    );
  });

  it('[12.2][12.4][12.7] 許される変更は null（canChangeManually と同じ判定）', () => {
    for (const role of STAFF_ROLES) {
      for (const from of ROOM_STATUSES) {
        for (const to of ROOM_STATUSES) {
          if (from === to) continue;
          const allowed = canChangeRoomStatusManually(role, from, to);
          expect(manualChangeRejection(role, from, to) === null, `${role} ${from}→${to}`).toBe(
            allowed,
          );
        }
      }
    }
    expect(manualChangeRejection('CLEANER', 'NO_ARRIVAL', 'CLEAN')).toBeNull();
    expect(manualChangeRejection('FRONT', 'CHECKED_IN', 'DEPARTURE_PENDING')).toBeNull();
  });

  it('同じ状態は変更ではない（呼び出し側が「何もしない」として扱う）ので RangeError', () => {
    expect(() => manualChangeRejection('CLEANER', 'CLEAN', 'CLEAN')).toThrow(RangeError);
  });

  it('役割・状態でない値は RangeError', () => {
    expect(() => manualChangeRejection('GUEST' as StaffRole, 'CLEAN', 'CLEANING')).toThrow(
      RangeError,
    );
    expect(() => manualChangeRejection('CLEANER', 'DIRTY' as RoomStatus, 'CLEANING')).toThrow(
      RangeError,
    );
  });
});
