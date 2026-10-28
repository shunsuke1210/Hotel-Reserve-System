// 操作履歴の1行の組み立て（buildAuditLogRow）を、データベースなしで確かめる（tasks.md 3.3）。
// 記録してよいのは、操作した人・時刻・操作の名前・対象の ID・項目の名前・関係する行の ID・部屋の状態の変化だけ
// （要件 18.1, 18.3、設計の補足 DT-M34・L-42・L-49）。個人情報の値は、形の検査で入らないようにする。
import { ROOM_STATUSES } from '@hotel/contracts';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  buildAuditLogRow,
  staffActor,
  systemActor,
  type AuditActor,
  type AuditEntry,
} from './audit-entry.js';

const AT = new Date('2026-11-10T10:00:00+09:00');
const STAFF_ID = '5f0c6a43-1d2e-4c51-9f0a-3b7d2c8e4a10';
const RESERVATION_A = '0b8f3f0e-6a59-4b8e-9d3b-2f6c1e7a9d01';
const RESERVATION_B = '7c2d9e41-3b8a-4f60-8e15-9a4b6c3d2e02';
const ROOM_501 = 'a1b2c3d4-0000-4000-8000-000000000501';
const ROOM_502 = 'a1b2c3d4-0000-4000-8000-000000000502';
const RUN_ID = 'f0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f';

const S101: AuditActor = staffActor({ staffId: STAFF_ID, staffNumber: 'S101' });

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    action: 'SPECIAL_SURCHARGE_UPDATE',
    target: { type: 'special_surcharge_period', id: RESERVATION_A },
    ...overrides,
  };
}

/** 検査で断られることと、例外の文言に渡した値が出ないこと（文言はサーバーのログに出る） */
function expectRejectedWithoutValue(build: () => unknown, value: string): void {
  let error: unknown;
  try {
    build();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(RangeError);
  expect((error as Error).message).not.toContain(value);
}

describe('buildAuditLogRow（操作履歴の1行）', () => {
  it('[18.1] スタッフの操作は、staff_id とスタッフ番号（actor_label）・日時・操作の名前・対象を記録する', () => {
    expect(
      buildAuditLogRow(
        S101,
        entry({
          detail: { fields: ['rateBp'] },
        }),
        AT,
      ),
    ).toEqual({
      staffId: STAFF_ID,
      actorLabel: 'S101',
      action: 'SPECIAL_SURCHARGE_UPDATE',
      targetType: 'special_surcharge_period',
      targetId: RESERVATION_A,
      detail: { fields: ['rateBp'] },
      at: AT,
    });
  });

  it('[18.1] 定時処理は staff_id が空で「システム」（SYSTEM:処理の名前）として記録し、その回の job_runs の ID を detail に入れる', () => {
    const row = buildAuditLogRow(
      systemActor({ job: 'no-show', runId: RUN_ID }),
      entry({ action: 'NO_SHOW', target: { type: 'reservation', id: RESERVATION_A } }),
      AT,
    );
    expect(row).toMatchObject({
      staffId: null,
      actorLabel: 'SYSTEM:no-show',
      action: 'NO_SHOW',
      targetType: 'reservation',
      targetId: RESERVATION_A,
      detail: { jobRunId: RUN_ID },
    });
  });

  it('[18.1] 同時に変わる部屋の状態は、1行の detail に入れる（L-42・TC-MB-400 の形）', () => {
    const row = buildAuditLogRow(
      S101,
      entry({
        action: 'CHECK_IN',
        target: { type: 'reservation', id: RESERVATION_A },
        detail: {
          roomStatusChanges: [
            { roomId: ROOM_501, from: 'CLEAN', to: 'CHECKED_IN' },
            { roomId: ROOM_502, from: 'CLEAN', to: 'CHECKED_IN' },
          ],
        },
      }),
      AT,
    );
    expect(row.detail).toEqual({
      roomStatusChanges: [
        { roomId: ROOM_501, from: 'CLEAN', to: 'CHECKED_IN' },
        { roomId: ROOM_502, from: 'CLEAN', to: 'CHECKED_IN' },
      ],
    });
  });

  it('[18.1] 部屋の入れ替えは、操作した側の予約を対象にし、もう一方の予約の ID を detail に入れられる（L-49・TC-MB-376 の形）', () => {
    const row = buildAuditLogRow(
      S101,
      entry({
        action: 'ROOM_SWAP',
        target: { type: 'reservation', id: RESERVATION_A },
        detail: {
          refs: { otherReservationId: RESERVATION_B },
          roomStatusChanges: [],
        },
      }),
      AT,
    );
    expect(row).toMatchObject({
      action: 'ROOM_SWAP',
      targetType: 'reservation',
      targetId: RESERVATION_A,
      // 空の項目は書かない
      detail: { refs: { otherReservationId: RESERVATION_B } },
    });
    expect(row.detail).not.toHaveProperty('roomStatusChanges');
  });

  it('[18.3] 項目の名前は重複を除いて順に記録し、関係する行の ID は1つでも複数でも記録できる。UUID は小文字にそろえる', () => {
    const row = buildAuditLogRow(
      S101,
      entry({
        action: 'ROSTER_UPDATE',
        target: { type: 'reservation', id: RESERVATION_A.toUpperCase() },
        detail: {
          fields: ['familyName', 'givenName', 'familyName', 'passportNumber', 'companion.contact'],
          refs: { rosterEntryIds: [ROOM_501, ROOM_502.toUpperCase()] },
        },
      }),
      AT,
    );
    expect(row.targetId).toBe(RESERVATION_A);
    expect(row.detail).toEqual({
      fields: ['familyName', 'givenName', 'passportNumber', 'companion.contact'],
      refs: { rosterEntryIds: [ROOM_501, ROOM_502] },
    });
  });

  it('[18.3] detail がなければ空のオブジェクトを記録する', () => {
    expect(buildAuditLogRow(S101, entry(), AT).detail).toEqual({});
  });

  it('[18.1] 9:00 の処理の「清掃有（連泊）→ 清掃有（連泊）」のように、同じ状態への変化も記録できる', () => {
    const row = buildAuditLogRow(
      systemActor({ job: 'morning-status', runId: RUN_ID }),
      entry({
        action: 'ROOM_STATUS_CHANGE',
        target: { type: 'room', id: ROOM_501 },
        detail: { roomStatusChanges: [{ roomId: ROOM_501, from: 'STAY_DIRTY', to: 'STAY_DIRTY' }] },
      }),
      AT,
    );
    expect(row.detail.roomStatusChanges).toEqual([
      { roomId: ROOM_501, from: 'STAY_DIRTY', to: 'STAY_DIRTY' },
    ]);
  });

  it('[18.1] 操作の名前と対象の種類は、決めた一覧の値だけ（例に挙げた CHECK_IN・ROOM_MOVE を含む）', () => {
    expect(AUDIT_ACTIONS).toEqual(expect.arrayContaining(['CHECK_IN', 'ROOM_MOVE', 'NO_SHOW']));
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    for (const action of AUDIT_ACTIONS) expect(action).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
    expect(new Set(AUDIT_TARGET_TYPES).size).toBe(AUDIT_TARGET_TYPES.length);

    expect(() =>
      buildAuditLogRow(S101, entry({ action: 'DROP_TABLE' as AuditEntry['action'] }), AT),
    ).toThrow(RangeError);
    expect(() =>
      buildAuditLogRow(
        S101,
        entry({ target: { type: 'staff_note' as AuditTargetType, id: RESERVATION_A } }),
        AT,
      ),
    ).toThrow(RangeError);
  });

  describe('[18.3] 個人情報の値は、どの欄にも入らない（TC-MB-386・387 の入力の値）', () => {
    // TC-MB-386・387 で入力する個人情報の値
    const personalValues = [
      '佐藤 一郎',
      '山田',
      '石川県金沢市広岡1-1',
      '09022223333',
      'a@example.com',
      'E12345678',
      'Beijing 100000',
      '8613800000000',
      'sato ichiro',
    ];

    it.each(personalValues)('対象の ID に「%s」を渡すと断る', (value) => {
      expectRejectedWithoutValue(
        () => buildAuditLogRow(S101, entry({ target: { type: 'reservation', id: value } }), AT),
        value,
      );
    });

    it.each(personalValues)('項目の名前に「%s」を渡すと断る', (value) => {
      expectRejectedWithoutValue(
        () => buildAuditLogRow(S101, entry({ detail: { fields: ['familyName', value] } }), AT),
        value,
      );
    });

    it.each(personalValues)('関係する行の ID に「%s」を渡すと断る', (value) => {
      expectRejectedWithoutValue(
        () => buildAuditLogRow(S101, entry({ detail: { refs: { memberId: value } } }), AT),
        value,
      );
      expectRejectedWithoutValue(
        () =>
          buildAuditLogRow(
            S101,
            entry({ detail: { refs: { rosterEntryIds: [RESERVATION_B, value] } } }),
            AT,
          ),
        value,
      );
    });

    it('関係する行の ID の名前は「…Id」「…Ids」だけ（値を名前にして書き込めない）', () => {
      for (const key of [
        'familyName',
        'E12345678',
        'tel09022223333Id',
        '佐藤Id',
        'otherreservation',
      ]) {
        expectRejectedWithoutValue(
          () => buildAuditLogRow(S101, entry({ detail: { refs: { [key]: RESERVATION_B } } }), AT),
          key,
        );
      }
    });

    it('決めた欄（fields・refs・roomStatusChanges）以外を detail に入れると断る（要求の本文をそのまま渡せない）', () => {
      const body = { familyName: '佐藤', givenName: '一郎', passportNumber: 'E12345678' };
      expectRejectedWithoutValue(
        () => buildAuditLogRow(S101, entry({ detail: body as AuditEntry['detail'] }), AT),
        'E12345678',
      );
      expectRejectedWithoutValue(
        () =>
          buildAuditLogRow(
            S101,
            entry({
              detail: {
                roomStatusChanges: [
                  {
                    roomId: ROOM_501,
                    from: 'CLEAN',
                    to: 'CHECKED_IN',
                    guest: '佐藤 一郎',
                  } as never,
                ],
              },
            }),
            AT,
          ),
        '佐藤 一郎',
      );
    });

    it('部屋の状態は ROOM_STATUSES の値だけ', () => {
      expect(ROOM_STATUSES).toContain('CLEAN');
      expectRejectedWithoutValue(
        () =>
          buildAuditLogRow(
            S101,
            entry({
              detail: {
                roomStatusChanges: [{ roomId: ROOM_501, from: 'CLEAN', to: '佐藤 一郎' as never }],
              },
            }),
            AT,
          ),
        '佐藤 一郎',
      );
      expectRejectedWithoutValue(
        () =>
          buildAuditLogRow(
            S101,
            entry({
              detail: {
                roomStatusChanges: [{ roomId: 'E12345678', from: 'CLEAN', to: 'CHECKED_IN' }],
              },
            }),
            AT,
          ),
        'E12345678',
      );
    });
  });

  it('[18.1] 操作した人・時刻が正しくなければ断る', () => {
    expect(() =>
      buildAuditLogRow(staffActor({ staffId: 'S101', staffNumber: 'S101' }), entry(), AT),
    ).toThrow(RangeError);
    expect(() =>
      buildAuditLogRow(staffActor({ staffId: STAFF_ID, staffNumber: '' }), entry(), AT),
    ).toThrow(RangeError);
    expect(() => buildAuditLogRow(systemActor({ job: '', runId: RUN_ID }), entry(), AT)).toThrow(
      RangeError,
    );
    expect(() =>
      buildAuditLogRow(systemActor({ job: 'no-show', runId: 'run-1' }), entry(), AT),
    ).toThrow(RangeError);
    expect(() => buildAuditLogRow(S101, entry(), new Date(Number.NaN))).toThrow(RangeError);
  });
});

type AuditTargetType = AuditEntry['target']['type'];
