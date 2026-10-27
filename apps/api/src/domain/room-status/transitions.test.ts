// 部屋の状態のルール（design.md RoomStatusRules、処理仕様 P-12、設計の補足 L-23、
// brief.md ST-01・ST-01a・ST-01b・ST-01c・ST-03b）。
// テストケースは test-cases/05-operations.md の 2.13（TC-OP-181・183〜213・272〜274）のうち、役割と状態の組み合わせで決まる部分。
// 状態の保存・変更の記録（TC-OP-214）と HTTP の応答（STATUS_TRANSITION_NOT_ALLOWED・422）は 3.7・7.11 の結合テストで確かめる。
// 業務の操作（チェックイン・チェックアウト・9:00 の処理・故障中の設定と修理の完了）による変更は役割で決まらないので、
// ここでは扱わない（3.7 の業務の操作の入口・P-10・P-13・7.12 の担当）。
import {
  ROOM_STATUSES,
  ROOM_STATUSES_BY_GROUP,
  STAFF_ROLES,
  type RoomStatus,
  type RoomStatusGroup,
  type StaffRole,
} from '@hotel/contracts';
import { describe, expect, it } from 'vitest';
import {
  canChangeRoomStatus,
  canChangeRoomStatusManually,
  roomStatusGroupOf,
  roomStatusRules,
} from './transitions.js';

/**
 * 表の列の並び（contracts の ROOM_STATUSES と同じ）。空室の清掃・連泊・その他の4つずつを空白で区切る。
 * 記号：o＝許可、x＝拒否、-＝同じ状態（変更ではないので拒否）
 */
const COLUMNS: readonly RoomStatus[] = [
  'CLEANING_READY',
  'CLEANING',
  'INSPECTION',
  'CLEAN',
  'STAY_DIRTY',
  'STAY_CLEANING',
  'STAY_INSPECTION',
  'STAY_CLEAN',
  'CHECKED_IN',
  'DEPARTURE_PENDING',
  'NO_ARRIVAL',
  'OUT_OF_ORDER',
];

type Matrix = Record<RoomStatus, string>;
type Predicate = (role: StaffRole, from: RoomStatus, to: RoomStatus) => boolean;

/** 役割ごとに、行＝変更前・列＝変更後の許可・拒否を表の形にする */
function matrixOf(predicate: Predicate, role: StaffRole): Matrix {
  const rows = COLUMNS.map((from) => {
    const cells = COLUMNS.map((to) => {
      if (predicate(role, from, to)) return 'o';
      return from === to ? '-' : 'x';
    });
    const row = [cells.slice(0, 4), cells.slice(4, 8), cells.slice(8, 12)]
      .map((group) => group.join(''))
      .join(' ');
    return [from, row] as const;
  });
  return Object.fromEntries(rows) as Matrix;
}

/**
 * 清掃員（P-12 の1・2行目）：空室の清掃グループの中・連泊グループの中の変更（12.2、ST-01・ST-01b）と、
 * 来客なし → 清掃完了（12.3・12.7、ST-03b）だけ。「その他」の中の変更（ST-01c）とグループをまたぐ変更（12.3）は拒否
 */
const CLEANER_MATRIX: Matrix = {
  CLEANING_READY: '-ooo xxxx xxxx',
  CLEANING: 'o-oo xxxx xxxx',
  INSPECTION: 'oo-o xxxx xxxx',
  CLEAN: 'ooo- xxxx xxxx',
  STAY_DIRTY: 'xxxx -ooo xxxx',
  STAY_CLEANING: 'xxxx o-oo xxxx',
  STAY_INSPECTION: 'xxxx oo-o xxxx',
  STAY_CLEAN: 'xxxx ooo- xxxx',
  CHECKED_IN: 'xxxx xxxx -xxx',
  DEPARTURE_PENDING: 'xxxx xxxx x-xx',
  NO_ARRIVAL: 'xxxo xxxx xx-x',
  OUT_OF_ORDER: 'xxxx xxxx xxx-',
};

/**
 * フロント以上（P-12 の1〜3行目と「任意 → OUT_OF_ORDER、OUT_OF_ORDER → CLEAN」の行）：グループをまたぐ変更も
 * 「その他」の中の変更も、どの状態にも変えられる（12.4、ST-01a）
 */
const FRONT_OR_ABOVE_MATRIX: Matrix = {
  CLEANING_READY: '-ooo oooo oooo',
  CLEANING: 'o-oo oooo oooo',
  INSPECTION: 'oo-o oooo oooo',
  CLEAN: 'ooo- oooo oooo',
  STAY_DIRTY: 'oooo -ooo oooo',
  STAY_CLEANING: 'oooo o-oo oooo',
  STAY_INSPECTION: 'oooo oo-o oooo',
  STAY_CLEAN: 'oooo ooo- oooo',
  CHECKED_IN: 'oooo oooo -ooo',
  DEPARTURE_PENDING: 'oooo oooo o-oo',
  NO_ARRIVAL: 'oooo oooo oo-o',
  OUT_OF_ORDER: 'oooo oooo ooo-',
};

/**
 * フロント以上の状態の変更（POST /rooms/{id}/status、C03）：上の表から、故障中への変更と故障中からの変更を除く
 * （L-23。故障中の設定と修理の完了の API（F13）だけで行う）
 */
const FRONT_OR_ABOVE_MANUAL_MATRIX: Matrix = {
  CLEANING_READY: '-ooo oooo ooox',
  CLEANING: 'o-oo oooo ooox',
  INSPECTION: 'oo-o oooo ooox',
  CLEAN: 'ooo- oooo ooox',
  STAY_DIRTY: 'oooo -ooo ooox',
  STAY_CLEANING: 'oooo o-oo ooox',
  STAY_INSPECTION: 'oooo oo-o ooox',
  STAY_CLEAN: 'oooo ooo- ooox',
  CHECKED_IN: 'oooo oooo -oox',
  DEPARTURE_PENDING: 'oooo oooo o-ox',
  NO_ARRIVAL: 'oooo oooo oo-x',
  OUT_OF_ORDER: 'xxxx xxxx xxx-',
};

describe('RoomStatusRules', () => {
  it('表の列の並びが contracts の ROOM_STATUSES と同じ（12の状態）', () => {
    expect(ROOM_STATUSES).toEqual(COLUMNS);
  });

  describe('groupOf：状態のグループ', () => {
    const EXPECTED_GROUPS: [RoomStatus, RoomStatusGroup][] = [
      ['CLEANING_READY', 'VACANT'],
      ['CLEANING', 'VACANT'],
      ['INSPECTION', 'VACANT'],
      ['CLEAN', 'VACANT'],
      ['STAY_DIRTY', 'STAY'],
      ['STAY_CLEANING', 'STAY'],
      ['STAY_INSPECTION', 'STAY'],
      ['STAY_CLEAN', 'STAY'],
      ['CHECKED_IN', 'OTHER'],
      ['DEPARTURE_PENDING', 'OTHER'],
      ['NO_ARRIVAL', 'OTHER'],
      ['OUT_OF_ORDER', 'OTHER'],
    ];

    it.each(EXPECTED_GROUPS)('[12.1] TC-OP-181 %s は %s のグループ', (status, group) => {
      expect(roomStatusGroupOf(status)).toBe(group);
    });

    it('[12.1] contracts の ROOM_STATUSES_BY_GROUP と同じ分け方をする（定義し直さない）', () => {
      for (const [group, statuses] of Object.entries(ROOM_STATUSES_BY_GROUP)) {
        for (const status of statuses) {
          expect(roomStatusGroupOf(status)).toBe(group);
        }
      }
    });

    it('部屋の状態でない値は RangeError', () => {
      expect(() => roomStatusGroupOf('DIRTY' as RoomStatus)).toThrow(RangeError);
    });
  });

  describe('canChange：役割ごとに変えてよい組み合わせ（P-12）', () => {
    it('[12.2][12.3][12.7] 清掃員：空室の清掃グループの中・連泊グループの中と、来客なし → 清掃完了だけ', () => {
      expect(matrixOf(canChangeRoomStatus, 'CLEANER')).toEqual(CLEANER_MATRIX);
    });

    it.each(['FRONT', 'ADMIN'] as const)(
      '[12.4] %s：グループをまたぐ変更も「その他」の中の変更も、すべて許す',
      (role) => {
        expect(matrixOf(canChangeRoomStatus, role)).toEqual(FRONT_OR_ABOVE_MATRIX);
      },
    );

    it.each(['FRONT', 'ADMIN'] as const)(
      '[12.4] %s：任意 → 故障中、故障中 → 清掃完了は許す（故障中の設定・修理の完了。P-12、P-13）',
      (role) => {
        for (const from of ROOM_STATUSES.filter((status) => status !== 'OUT_OF_ORDER')) {
          expect(canChangeRoomStatus(role, from, 'OUT_OF_ORDER')).toBe(true);
        }
        expect(canChangeRoomStatus(role, 'OUT_OF_ORDER', 'CLEAN')).toBe(true);
      },
    );

    it.each(STAFF_ROLES)('%s：同じ状態への変更は変更ではないので許さない', (role) => {
      for (const status of ROOM_STATUSES) {
        expect(canChangeRoomStatus(role, status, status)).toBe(false);
      }
    });

    it('役割・部屋の状態でない値は RangeError', () => {
      expect(() => canChangeRoomStatus('GUEST' as StaffRole, 'CLEAN', 'CLEANING')).toThrow(
        RangeError,
      );
      expect(() => canChangeRoomStatus('FRONT', 'DIRTY' as RoomStatus, 'CLEAN')).toThrow(
        RangeError,
      );
      expect(() => canChangeRoomStatus('FRONT', 'CLEAN', 'DIRTY' as RoomStatus)).toThrow(
        RangeError,
      );
    });
  });

  describe('canChangeManually：状態の変更（POST /rooms/{id}/status、C03）で変えてよい組み合わせ（P-12、L-23）', () => {
    it('[12.2][12.3][12.7] 清掃員：canChange と同じ（清掃員は故障中に関わる変更をもともと許されない）', () => {
      expect(matrixOf(canChangeRoomStatusManually, 'CLEANER')).toEqual(CLEANER_MATRIX);
    });

    it.each(['FRONT', 'ADMIN'] as const)(
      '[12.4] L-23 %s：故障中への変更と故障中からの変更を除き、すべて許す',
      (role) => {
        expect(matrixOf(canChangeRoomStatusManually, role)).toEqual(FRONT_OR_ABOVE_MANUAL_MATRIX);
      },
    );

    // 前提の部屋の状態と役割は test-cases/05-operations.md 2.13 のとおり（特に書かない限り清掃員）
    const CASES: [string, StaffRole, RoomStatus, RoomStatus, boolean][] = [
      ['TC-OP-183 [12.2] 清掃可 → 清掃中', 'CLEANER', 'CLEANING_READY', 'CLEANING', true],
      ['TC-OP-184 [12.2] 清掃中 → 点検待ち', 'CLEANER', 'CLEANING', 'INSPECTION', true],
      ['TC-OP-185 [12.2] 点検待ち → 清掃完了', 'CLEANER', 'INSPECTION', 'CLEAN', true],
      [
        'TC-OP-186 [12.2] 点検の省略：清掃可 → 清掃完了',
        'CLEANER',
        'CLEANING_READY',
        'CLEAN',
        true,
      ],
      ['TC-OP-187 [12.2] 誤操作の訂正：清掃完了 → 清掃中', 'CLEANER', 'CLEAN', 'CLEANING', true],
      [
        'TC-OP-188 [12.2] 清掃有（連泊）→ 清掃中（連泊）',
        'CLEANER',
        'STAY_DIRTY',
        'STAY_CLEANING',
        true,
      ],
      [
        'TC-OP-189 [12.2] 清掃中（連泊）→ 点検待ち（連泊）',
        'CLEANER',
        'STAY_CLEANING',
        'STAY_INSPECTION',
        true,
      ],
      [
        'TC-OP-190 [12.2] 点検待ち（連泊）→ 清掃完了（連泊）',
        'CLEANER',
        'STAY_INSPECTION',
        'STAY_CLEAN',
        true,
      ],
      [
        'TC-OP-191 [12.2] 清掃を断られた部屋：清掃有（連泊）→ 清掃完了（連泊）',
        'CLEANER',
        'STAY_DIRTY',
        'STAY_CLEAN',
        true,
      ],
      [
        'TC-OP-192 [12.2] 誤操作の訂正：清掃完了（連泊）→ 清掃有（連泊）',
        'CLEANER',
        'STAY_CLEAN',
        'STAY_DIRTY',
        true,
      ],
      ['TC-OP-193 [12.3] 清掃完了 → 清掃完了（連泊）', 'CLEANER', 'CLEAN', 'STAY_CLEAN', false],
      ['TC-OP-194 [12.3] 清掃完了（連泊）→ 清掃完了', 'CLEANER', 'STAY_CLEAN', 'CLEAN', false],
      [
        'TC-OP-195 [12.3] チェックアウト待ち → 清掃可',
        'CLEANER',
        'DEPARTURE_PENDING',
        'CLEANING_READY',
        false,
      ],
      ['TC-OP-196 [12.3] 清掃完了 → チェックイン済み', 'CLEANER', 'CLEAN', 'CHECKED_IN', false],
      [
        'TC-OP-197 [12.3] 清掃有（連泊）→ チェックアウト待ち',
        'CLEANER',
        'STAY_DIRTY',
        'DEPARTURE_PENDING',
        false,
      ],
      [
        'TC-OP-198 [12.2][12.3] その他の中：チェックイン済み → チェックアウト待ち',
        'CLEANER',
        'CHECKED_IN',
        'DEPARTURE_PENDING',
        false,
      ],
      [
        'TC-OP-199 [12.3][12.7] 来客なし → 清掃可',
        'CLEANER',
        'NO_ARRIVAL',
        'CLEANING_READY',
        false,
      ],
      ['TC-OP-200 [12.7][12.3] 来客なし → 清掃完了', 'CLEANER', 'NO_ARRIVAL', 'CLEAN', true],
      ['TC-OP-201 [12.3] 故障中 → 清掃完了', 'CLEANER', 'OUT_OF_ORDER', 'CLEAN', false],
      ['TC-OP-202 [12.3] 清掃完了 → 故障中', 'CLEANER', 'CLEAN', 'OUT_OF_ORDER', false],
      [
        'TC-OP-272 [12.2][12.3] その他の中：故障中 → チェックイン済み',
        'CLEANER',
        'OUT_OF_ORDER',
        'CHECKED_IN',
        false,
      ],
      [
        'TC-OP-273 [12.2][12.7] その他の中：来客なし → チェックアウト待ち',
        'CLEANER',
        'NO_ARRIVAL',
        'DEPARTURE_PENDING',
        false,
      ],
      [
        'TC-OP-207 [12.4] フロント：チェックアウト待ち → 清掃可',
        'FRONT',
        'DEPARTURE_PENDING',
        'CLEANING_READY',
        true,
      ],
      [
        'TC-OP-208 [12.4] フロント：清掃可 → チェックアウト待ち',
        'FRONT',
        'CLEANING_READY',
        'DEPARTURE_PENDING',
        true,
      ],
      [
        'TC-OP-209 [12.4] フロント：来客なし → 清掃可',
        'FRONT',
        'NO_ARRIVAL',
        'CLEANING_READY',
        true,
      ],
      [
        'TC-OP-210 [12.4] フロント：清掃完了（連泊）→ チェックイン済み',
        'FRONT',
        'STAY_CLEAN',
        'CHECKED_IN',
        true,
      ],
      ['TC-OP-211 [12.4] 管理者：清掃完了 → 清掃有（連泊）', 'ADMIN', 'CLEAN', 'STAY_DIRTY', true],
      [
        'TC-OP-274 [12.4][12.2] フロント：その他の中：チェックイン済み → チェックアウト待ち',
        'FRONT',
        'CHECKED_IN',
        'DEPARTURE_PENDING',
        true,
      ],
      [
        'TC-OP-212 [12.4] L-23 フロント：清掃完了 → 故障中',
        'FRONT',
        'CLEAN',
        'OUT_OF_ORDER',
        false,
      ],
      [
        'TC-OP-213 [12.4] L-23 フロント：故障中 → 清掃完了',
        'FRONT',
        'OUT_OF_ORDER',
        'CLEAN',
        false,
      ],
    ];

    it.each(CASES)('%s（役割 %s：%s → %s）は %s', (_name, role, from, to, allowed) => {
      expect(canChangeRoomStatusManually(role, from, to)).toBe(allowed);
    });

    /** C03 に出すボタン（変えられる状態。並びは ROOM_STATUSES の順） */
    function targetsOf(role: StaffRole, from: RoomStatus): RoomStatus[] {
      return ROOM_STATUSES.filter((to) => canChangeRoomStatusManually(role, from, to));
    }

    it('[12.2] TC-OP-203 清掃員・清掃完了：清掃可・清掃中・点検待ちだけ', () => {
      expect(targetsOf('CLEANER', 'CLEAN')).toEqual(['CLEANING_READY', 'CLEANING', 'INSPECTION']);
    });

    it('[12.7][12.2] TC-OP-204 清掃員・来客なし：清掃完了だけ', () => {
      expect(targetsOf('CLEANER', 'NO_ARRIVAL')).toEqual(['CLEAN']);
    });

    it('[12.3][12.2] TC-OP-205 清掃員・チェックアウト待ち：変えられる状態はない', () => {
      expect(targetsOf('CLEANER', 'DEPARTURE_PENDING')).toEqual([]);
    });

    it('[12.4] TC-OP-206 L-23 フロント・清掃完了：ほかの11の状態のうち故障中を除く10の状態', () => {
      expect(targetsOf('FRONT', 'CLEAN')).toEqual([
        'CLEANING_READY',
        'CLEANING',
        'INSPECTION',
        'STAY_DIRTY',
        'STAY_CLEANING',
        'STAY_INSPECTION',
        'STAY_CLEAN',
        'CHECKED_IN',
        'DEPARTURE_PENDING',
        'NO_ARRIVAL',
      ]);
    });
  });

  it('design.md の RoomStatusRules の形で使える', () => {
    expect(roomStatusRules.groupOf('NO_ARRIVAL')).toBe('OTHER');
    expect(roomStatusRules.canChange('CLEANER', 'NO_ARRIVAL', 'CLEAN')).toBe(true);
    expect(roomStatusRules.canChange('FRONT', 'CLEAN', 'OUT_OF_ORDER')).toBe(true);
    expect(roomStatusRules.canChangeManually('FRONT', 'CLEAN', 'OUT_OF_ORDER')).toBe(false);
  });
});
