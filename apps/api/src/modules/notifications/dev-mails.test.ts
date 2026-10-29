// 開発用のメールの一覧（GET /api/staff/dev/mails）が、開発環境だけに存在することを、データベースなしで確かめる
// （tasks.md 3.4、design.md「模擬のメール」、TC-MB-207）。一覧の中身は dev-mails.integration.test.ts で確かめる。
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { GuestAppModule } from '../../guest-app.module.js';
import { listenerRootModule } from '../../listeners.js';
import { createTestListenerApp } from '../../test/listener-app.js';
import { StaffAppModule } from '../../staff-app.module.js';
import { DevMailsModule } from './dev-mails.module.js';

describe('開発用のメールの一覧は開発環境だけに存在する', () => {
  const apps: INestApplication[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it.each(['development', 'test'] as const)(
    '[15.1] %s では社内用の待ち受け口に GET /dev/mails があり、ログインしていなければ UNAUTHENTICATED',
    async (appEnv) => {
      const app = await createTestListenerApp('staff', { appEnv });
      apps.push(app);
      const res = await request(app.getHttpServer()).get('/api/staff/dev/mails');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    },
  );

  it('[15.1] 開発環境以外（production）の設定で StaffApp を起動すると、GET /dev/mails は存在しない（404。TC-MB-207）', async () => {
    const app = await createTestListenerApp('staff', { appEnv: 'production' });
    apps.push(app);
    const res = await request(app.getHttpServer()).get('/api/staff/dev/mails');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    // ほかの URL は動いている
    expect((await request(app.getHttpServer()).get('/api/staff/health')).status).toBe(200);
  });

  it('[15.1] 公開用の待ち受け口には、開発環境でもメールの一覧がない', async () => {
    const app = await createTestListenerApp('guest', { appEnv: 'development' });
    apps.push(app);
    for (const path of ['/api/guest/dev/mails', '/api/staff/dev/mails']) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(404);
    }
  });

  it('待ち受け口の最上位のモジュール：production では開発用のモジュールを読み込まない', () => {
    expect(listenerRootModule('staff', 'production')).toBe(StaffAppModule);
    expect(listenerRootModule('staff', 'development')).toEqual({
      module: StaffAppModule,
      imports: [DevMailsModule],
    });
    expect(listenerRootModule('staff', 'test')).toEqual({
      module: StaffAppModule,
      imports: [DevMailsModule],
    });
    expect(listenerRootModule('guest', 'development')).toBe(GuestAppModule);
  });
});
