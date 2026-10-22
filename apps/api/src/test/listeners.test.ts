import type { AddressInfo } from 'node:net';
import { ApiErrorSchema } from '@hotel/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LISTENERS, startApis } from '../listeners.js';
import { FixedBusinessClock } from '../shared/clock/business-clock.js';
import { createTestListenerApp } from './listener-app.js';

describe('公開用と社内用の2つの待ち受け口', () => {
  let guest: INestApplication;
  let staff: INestApplication;

  beforeAll(async () => {
    guest = await createTestListenerApp('guest');
    staff = await createTestListenerApp('staff');
  });
  afterAll(async () => {
    await guest?.close();
    await staff?.close();
  });

  it('[2.2] 公開用の待ち受け口は /api/guest/health で稼働確認に応答する', async () => {
    const res = await request(guest.getHttpServer()).get('/api/guest/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('[2.2] 社内用の待ち受け口は /api/staff/health で稼働確認に応答する', async () => {
    const res = await request(staff.getHttpServer()).get('/api/staff/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('[2.2] 公開用の待ち受け口には社内用の稼働確認の URL がなく、NOT_FOUND（ApiError の形）を返す', async () => {
    const res = await request(guest.getHttpServer()).get('/api/staff/health');
    expect(res.status).toBe(404);
    expect(ApiErrorSchema.parse(res.body)).toEqual(res.body);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('[2.2] 社内用の待ち受け口には公開用の稼働確認の URL がなく、NOT_FOUND を返す', async () => {
    const res = await request(staff.getHttpServer()).get('/api/guest/health');
    expect(res.status).toBe(404);
    expect(ApiErrorSchema.parse(res.body).code).toBe('NOT_FOUND');
  });

  it('[2.2] 公開用の待ち受け口では、社内用の URL への状態を変える要求も NOT_FOUND になる', async () => {
    const res = await request(guest.getHttpServer())
      .post('/api/staff/rooms/101/status')
      .send({ to: 'CLEAN' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('決まった接頭辞（/api/guest・/api/staff）のない URL は NOT_FOUND を返す', async () => {
    for (const app of [guest, staff]) {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
  });
});

describe('時計の差し替え', () => {
  it('[3.6] テストで時計を任意の時刻に固定でき、API はその時刻を日本時間で扱う', async () => {
    const clock = new FixedBusinessClock('2026-10-22T16:00:00Z');
    const app = await createTestListenerApp('guest', { clock });
    try {
      const first = await request(app.getHttpServer()).get('/api/guest/health');
      expect(first.body.time).toBe('2026-10-23T01:00:00.000+09:00');

      clock.advance(60 * 1000);
      const second = await request(app.getHttpServer()).get('/api/guest/health');
      expect(second.body.time).toBe('2026-10-23T01:01:00.000+09:00');
    } finally {
      await app.close();
    }
  });

  it('社内用の待ち受け口の時計も差し替えられる', async () => {
    const clock = new FixedBusinessClock('2026-03-31T15:00:00Z');
    const app = await createTestListenerApp('staff', { clock });
    try {
      const res = await request(app.getHttpServer()).get('/api/staff/health');
      expect(res.body.time).toBe('2026-04-01T00:00:00.000+09:00');
    } finally {
      await app.close();
    }
  });
});

describe('API の起動（startApis）', () => {
  it('既定のポートは、公開用が 3001、社内用が 3002', () => {
    expect(LISTENERS.guest.port).toBe(3001);
    expect(LISTENERS.staff.port).toBe(3002);
    expect(LISTENERS.guest.prefix).toBe('api/guest');
    expect(LISTENERS.staff.prefix).toBe('api/staff');
  });

  it('[2.2] 1つのプロセスで公開用と社内用の2つの待ち受け口を立て、それぞれが自分の URL にだけ応答する', async () => {
    const apis = await startApis({ guest: 0, staff: 0 }, { logger: false });
    try {
      const guestPort = (apis.guest.getHttpServer().address() as AddressInfo).port;
      const staffPort = (apis.staff.getHttpServer().address() as AddressInfo).port;
      expect(guestPort).toBeGreaterThan(0);
      expect(staffPort).toBeGreaterThan(0);
      expect(guestPort).not.toBe(staffPort);

      const guestHealth = await fetch(`http://127.0.0.1:${guestPort}/api/guest/health`);
      expect(guestHealth.status).toBe(200);
      const staffHealth = await fetch(`http://127.0.0.1:${staffPort}/api/staff/health`);
      expect(staffHealth.status).toBe(200);

      const staffOnGuest = await fetch(`http://127.0.0.1:${guestPort}/api/staff/health`);
      expect(staffOnGuest.status).toBe(404);
      expect(ApiErrorSchema.parse(await staffOnGuest.json()).code).toBe('NOT_FOUND');
      const guestOnStaff = await fetch(`http://127.0.0.1:${staffPort}/api/guest/health`);
      expect(guestOnStaff.status).toBe(404);
    } finally {
      await apis.close();
    }
  });
});
