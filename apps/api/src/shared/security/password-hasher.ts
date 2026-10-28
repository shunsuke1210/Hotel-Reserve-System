// パスワードのハッシュ化（Argon2id。design.md Security Considerations、research.md ADR-04）。
// 会員（4.2・4.3・4.4）とスタッフ（4.1、初期データ）のパスワードは、必ずこのクラスでハッシュ化・照合する。
// パスワードとハッシュはログに出さない。
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { argon2id, hash as argon2Hash, verify as argon2Verify } from 'argon2';
import { randomBytes } from 'node:crypto';

/** RFC 9106 の推奨の2つ目（メモリ 64 MiB・3回・並列4）。ハッシュの文字列に含まれるので、後で変えても古いハッシュを照合できる */
const HASH_OPTIONS = {
  type: argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

@Injectable()
export class PasswordHasher implements OnModuleInit {
  private readonly logger = new Logger(PasswordHasher.name);
  /**
   * ハッシュがない（存在しない ID・停止中のスタッフ・退会した会員）ときに照合に使うハッシュ。
   * 応答の時間で ID の有無が分からないように、起動時に作っておく（最初のログインでハッシュを作る時間がかからないように）。
   */
  private dummyHash: Promise<string> | undefined;

  /** 起動時にダミーのハッシュを作る。作れなくても起動は止めず、次に使うときに作り直す */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureDummyHash();
    } catch {
      this.logger.warn('照合用のダミーのハッシュを作れませんでした。次のログインで作り直します');
    }
  }

  hash(password: string): Promise<string> {
    return argon2Hash(password, HASH_OPTIONS);
  }

  /**
   * パスワードがハッシュと合うか。
   * ハッシュがないときもダミーのハッシュで同じだけ計算してから false を返す
   * （存在しない ID と誤ったパスワードを、応答の時間で区別させない）。
   */
  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    if (!hash) {
      await argon2Verify(await this.ensureDummyHash(), password);
      return false;
    }
    return argon2Verify(hash, password);
  }

  /** ダミーのハッシュ（なければ作る）。作るのに失敗したら覚えずに、次に呼ばれたときに作り直す */
  private ensureDummyHash(): Promise<string> {
    if (!this.dummyHash) {
      const creating = this.hash(randomBytes(32).toString('base64url'));
      this.dummyHash = creating;
      creating.catch(() => {
        if (this.dummyHash === creating) this.dummyHash = undefined;
      });
    }
    return this.dummyHash;
  }
}
