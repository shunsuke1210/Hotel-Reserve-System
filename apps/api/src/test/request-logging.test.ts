import { Body, Controller, Post, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestLogEntry } from '../shared/logging/request-log.js';
import { createTestListenerApp, MemoryRequestLogSink } from './listener-app.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** ログに出してはならない情報を含む要求を受ける URL（テスト用） */
@Controller('test-log')
class LogTestController {
  @Post('members')
  register(@Body() body: Record<string, unknown>): { received: number } {
    return { received: Object.keys(body).length };
  }
}

describe('要求ごとのログ', () => {
  const guestSink = new MemoryRequestLogSink();
  const staffSink = new MemoryRequestLogSink();
  let guest: INestApplication;
  let staff: INestApplication;

  beforeAll(async () => {
    guest = await createTestListenerApp('guest', {
      logSink: guestSink,
      controllers: [LogTestController],
    });
    staff = await createTestListenerApp('staff', { logSink: staffSink });
  });
  afterAll(async () => {
    await guest?.close();
    await staff?.close();
  });
  beforeEach(() => {
    guestSink.entries.length = 0;
    staffSink.entries.length = 0;
  });

  /** 応答の後に書かれるログを待って取り出す */
  async function logged(sink: MemoryRequestLogSink, count = 1): Promise<RequestLogEntry[]> {
    await vi.waitFor(() => expect(sink.entries).toHaveLength(count));
    return sink.entries;
  }

  it('要求 ID・待ち受け口・利用者の種類・結果のコードを、1つの要求につき1行記録する', async () => {
    const res = await request(guest.getHttpServer()).get('/api/guest/health');
    const [entry] = await logged(guestSink);

    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(entry).toEqual({
      requestId: res.headers['x-request-id'],
      listener: 'guest',
      userType: 'ANONYMOUS',
      method: 'GET',
      path: '/api/guest/health',
      status: 200,
      result: 'OK',
      durationMs: expect.any(Number),
    });
    expect(entry?.durationMs).toBeGreaterThanOrEqual(0);
    expect(staffSink.entries).toHaveLength(0);
  });

  it('社内用の待ち受け口の要求は listener を staff として記録し、エラーは ApiError のコードを結果にする', async () => {
    const res = await request(staff.getHttpServer()).get('/api/staff/no-such-page');
    expect(res.status).toBe(404);
    const [entry] = await logged(staffSink);
    expect(entry).toMatchObject({
      requestId: res.headers['x-request-id'],
      listener: 'staff',
      userType: 'ANONYMOUS',
      status: 404,
      result: 'NOT_FOUND',
    });
  });

  it('[2.2] 公開用の待ち受け口に社内用の URL を求めた要求も記録する（結果は NOT_FOUND）', async () => {
    await request(guest.getHttpServer()).get('/api/staff/health');
    const [entry] = await logged(guestSink);
    expect(entry).toMatchObject({ listener: 'guest', status: 404, result: 'NOT_FOUND' });
  });

  it('要求 ID は要求ごとに異なる', async () => {
    const first = await request(guest.getHttpServer()).get('/api/guest/health');
    const second = await request(guest.getHttpServer()).get('/api/guest/health');
    const entries = await logged(guestSink, 2);
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
    expect(entries.map((e) => e.requestId)).toEqual([
      first.headers['x-request-id'],
      second.headers['x-request-id'],
    ]);
  });

  it('前段（リバースプロキシ）が付けた要求 ID を引き継ぐ', async () => {
    const res = await request(guest.getHttpServer())
      .get('/api/guest/health')
      .set('X-Request-Id', '8f14e45fceea167a5a36dedd4bea2543');
    const [entry] = await logged(guestSink);
    expect(res.headers['x-request-id']).toBe('8f14e45fceea167a5a36dedd4bea2543');
    expect(entry?.requestId).toBe('8f14e45fceea167a5a36dedd4bea2543');
  });

  it.each([['taro@example.com'], ['a b'], ['x'.repeat(129)], ['']])(
    '要求 ID に使えない値（%j）が付いていれば、使わずに新しく作る',
    async (incoming) => {
      const res = await request(guest.getHttpServer())
        .get('/api/guest/health')
        .set('X-Request-Id', incoming);
      const [entry] = await logged(guestSink);
      expect(res.headers['x-request-id']).toMatch(UUID);
      expect(entry?.requestId).toBe(res.headers['x-request-id']);
      expect(JSON.stringify(entry)).not.toContain('taro');
    },
  );

  it('個人情報（要求の本文・クエリ文字列・Cookie・認証の情報）をログに出さない', async () => {
    const pii = {
      name: '山田太郎',
      email: 'taro.yamada@example.com',
      phone: '09012345678',
      cardNumber: '4242424242424242',
      password: 'P@ssw0rd-Secret',
    };
    const res = await request(guest.getHttpServer())
      .post('/api/guest/test-log/members')
      .set('X-Requested-With', 'XMLHttpRequest')
      .query({ query: '山田太郎', email: pii.email })
      .set('Cookie', 'sid=session-id-secret')
      .set('Authorization', 'Bearer token-secret')
      .send(pii);
    expect(res.status).toBe(201);

    const [entry] = await logged(guestSink);
    expect(entry).toMatchObject({
      method: 'POST',
      path: '/api/guest/test-log/members',
      result: 'OK',
    });
    expect(Object.keys(entry ?? {}).sort()).toEqual(
      [
        'durationMs',
        'listener',
        'method',
        'path',
        'requestId',
        'result',
        'status',
        'userType',
      ].sort(),
    );

    const text = JSON.stringify(entry);
    for (const secret of [
      ...Object.values(pii),
      encodeURIComponent('山田太郎'),
      'taro.yamada',
      'query=',
      'session-id-secret',
      'token-secret',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
