// データベースの接続（Prisma Client）。PostgreSQL へは node-postgres のドライバーアダプター（@prisma/adapter-pg）で接続する。
// 接続はプールで、最初の問い合わせのときに張る（起動の時点では接続しない）。
//
// 業務のサービスは PrismaService を注入して使う。予約に関する変更など、まとめて行う処理は runInTransaction（transaction.ts）で行う。
//
// 注意：Prisma Client のコンストラクターは Proxy を返すので、インスタンスに instanceof PrismaService は成り立たない
// （DI のトークンとしては使える）。同じ接続かどうかは === で比べる。
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

export class PrismaService extends PrismaClient {
  /** @param databaseUrl 接続文字列（API はアプリ用の利用者。loadConfig().databaseUrl） */
  constructor(databaseUrl: string) {
    super({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  }
}
