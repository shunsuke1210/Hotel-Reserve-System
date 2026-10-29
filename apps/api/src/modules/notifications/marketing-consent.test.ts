// 定期配信の同意の現在の状態（marketing_consents は追記だけで、最新の行が現在の状態。要件 15.6、1.5〜1.7）。
import { describe, expect, it } from 'vitest';
import { isConsentActive, type ConsentRecord } from './marketing-consent.js';

function record(consented: boolean, recordedAt: string, createdAt = recordedAt): ConsentRecord {
  return { consented, recordedAt: new Date(recordedAt), createdAt: new Date(createdAt) };
}

describe('isConsentActive（定期配信を送ってよいか）', () => {
  it('[15.6] 一度も同意していなければ送らない（TC-MB-262）', () => {
    expect(isConsentActive([])).toBe(false);
  });

  it('[15.6] 最新の行が同意なら送り、取り消しなら送らない（TC-MB-261・263・264）', () => {
    const consented = record(true, '2026-11-12T15:00:00+09:00');
    const revoked = record(false, '2026-11-13T09:00:00+09:00');
    const again = record(true, '2026-11-14T09:00:00+09:00');
    expect(isConsentActive([consented])).toBe(true);
    expect(isConsentActive([consented, revoked])).toBe(false);
    expect(isConsentActive([consented, revoked, again])).toBe(true);
    // 並び順に左右されない
    expect(isConsentActive([revoked, consented])).toBe(false);
    expect(isConsentActive([again, consented, revoked])).toBe(true);
  });

  it('記録の時刻が同じなら後から追加した行、それも同じなら取り消しを優先する（送ってはいけない側に倒す）', () => {
    const at = '2026-11-13T09:00:00+09:00';
    expect(
      isConsentActive([
        record(false, at, '2026-11-13T09:00:00+09:00'),
        record(true, at, '2026-11-13T09:00:01+09:00'),
      ]),
    ).toBe(true);
    expect(isConsentActive([record(true, at), record(false, at)])).toBe(false);
    expect(isConsentActive([record(false, at), record(true, at)])).toBe(false);
  });
});
