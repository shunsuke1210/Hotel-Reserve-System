// PrismaModule の単体テスト（データベースなし）。接続そのものは prisma.integration.test.ts で確かめる。
import type { INestApplication } from '@nestjs/common';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createTestListenerApp } from '../../test/listener-app.js';
import { PrismaService } from './prisma.service.js';
import { SharedResource } from './shared-resource.js';

describe('SharedResource（2つの待ち受け口で共有する、プロセスで1つの資源）', () => {
  const setup = () => {
    let created = 0;
    const dispose = vi.fn(async (_value: { id: number }) => undefined);
    const resource = new SharedResource(() => ({ id: ++created }), dispose);
    return { resource, dispose };
  };

  it('最初の acquire で1つだけ作り、以後は同じものを渡す', () => {
    const { resource } = setup();
    const first = resource.acquire();
    expect(resource.acquire()).toBe(first);
    expect(first).toEqual({ id: 1 });
  });

  it('acquire した数だけ release されたときに片付け、その後の acquire では作り直す', async () => {
    const { resource, dispose } = setup();
    const value = resource.acquire();
    resource.acquire();
    await resource.release(value);
    expect(dispose).not.toHaveBeenCalled();
    await resource.release(value);
    expect(dispose).toHaveBeenCalledExactlyOnceWith(value);
    expect(resource.acquire()).toEqual({ id: 2 });
  });

  it('共有していない値（テストで差し替えたもの）の release では何もしない', async () => {
    const { resource, dispose } = setup();
    const value = resource.acquire();
    await resource.release({ id: 99 });
    await resource.release(value);
    await resource.release(value);
    expect(dispose).toHaveBeenCalledOnce();
  });
});

describe('データベースを使わないテストの待ち受け口', () => {
  const apps: INestApplication[] = [];
  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  it('PrismaService を差し替えずに起動・終了でき、使おうとすると理由を示して失敗する', async () => {
    const guest = await createTestListenerApp('guest');
    const staff = await createTestListenerApp('staff');
    apps.push(guest, staff);
    const prisma = guest.get(PrismaService);
    expect(() => prisma.reservation).toThrow(
      /データベースを使いません（PrismaService\.reservation）/,
    );
    expect(() => staff.get(PrismaService).$transaction).toThrow(/integration\.test\.ts/);
  });
});
