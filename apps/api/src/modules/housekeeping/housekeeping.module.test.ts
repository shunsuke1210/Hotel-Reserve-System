// 部屋の状態の変更のモジュールの読み込み（データベースは使わない）。
// 社内用の待ち受け口だけに載せること（清掃員・フロントの操作と定時処理。公開用の待ち受け口には載せない：ADR-03）と、
// URL を持たないこと（清掃状況の一覧と状態の変更の API は 7.11）。
import { describe, expect, it } from 'vitest';
import { createTestListenerApp } from '../../test/listener-app.js';
import { HousekeepingModule } from './housekeeping.module.js';
import { RoomStatusService } from './room-status.service.js';

describe('HousekeepingModule', () => {
  it('[12.2] 社内用の待ち受け口で RoomStatusService を使える', async () => {
    const app = await createTestListenerApp('staff');
    try {
      expect(app.get(RoomStatusService)).toBeInstanceOf(RoomStatusService);
    } finally {
      await app.close();
    }
  });

  it('公開用の待ち受け口には載せない（宿泊客の操作は部屋の状態を変えない）', async () => {
    const app = await createTestListenerApp('guest');
    try {
      expect(() => app.get(RoomStatusService)).toThrow();
    } finally {
      await app.close();
    }
  });

  it('URL を持たない（社内用 API の /rooms/status-board・/rooms/{id}/status は 7.11 で加える）', () => {
    const controllers: unknown = Reflect.getMetadata('controllers', HousekeepingModule);
    expect(controllers ?? []).toEqual([]);
  });
});
