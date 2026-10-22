// PrismaService を全モジュールに提供する。
//
// 公開用と社内用の2つの待ち受け口は別々の DI コンテナなので（tasks.md Implementation Notes 1.3）、
// useClass にすると待ち受け口ごとに接続プールができる。そこで、PrismaService はプロセスで1つだけ作って共有する。
// 設定（loadConfig）は、最初に PrismaService を作るときに1回だけ読む。
// 2つの待ち受け口の両方を閉じたときに接続を閉じる（片方だけを閉じても、もう一方は使い続けられる）。
//
// テストでは overrideProvider(PrismaService) で、テスト用のデータベースの PrismaService に差し替える
// （src/test/listener-app.ts の createTestListenerApp。差し替えたものは、ここでは閉じない）。
import { Global, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { loadConfig } from '../config/app-config.js';
import { PrismaService } from './prisma.service.js';
import { SharedResource } from './shared-resource.js';

const processWidePrisma = new SharedResource(
  () => new PrismaService(loadConfig().databaseUrl),
  (prisma) => prisma.$disconnect(),
);

/** 待ち受け口を閉じるときに、共有している PrismaService を返す（最後の1つで接続を閉じる） */
@Injectable()
class PrismaLease implements OnApplicationShutdown {
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationShutdown(): Promise<void> {
    await processWidePrisma.release(this.prisma);
  }
}

@Global()
@Module({
  providers: [
    { provide: PrismaService, useFactory: () => processWidePrisma.acquire() },
    PrismaLease,
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
