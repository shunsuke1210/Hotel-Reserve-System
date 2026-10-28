// サーバー側のセッション（research.md ADR-04、design.md Security Considerations・Data Models の sessions）。
//
// - ログインに成功したら start：要求に付いていた同じ種類のセッションを消し、新しい ID のセッションを作る（ID を作り直す）
// - 要求ごとに resolve：Cookie のセッションを確かめ、有効なら最後の操作の時刻と期限を延ばす（会員7日・スタッフ12時間。
//   期限ちょうどの時刻で無効：DT-M1）。利用者の確認（会員の状態・スタッフの停止）は呼び出し側（認証の確認）が渡す
// - ログアウトは end、退会・スタッフの停止（L-9・L-28）は endAllFor（トランザクションの中でも呼べる）
//
// データベースには ID の SHA-256 だけを保存し、ID（Cookie の値）はログに出さない。
import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BusinessClock } from '../clock/business-clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { TransactionClient } from '../prisma/transaction.js';
import { clearSessionCookie, readSessionToken, writeSessionCookie } from './session-cookie.js';
import { SESSION_POLICIES, type SessionRealm } from './session-policy.js';
import { generateSessionToken, hashSessionToken } from './session-token.js';

/** セッションを読み書きするデータベースの接続（トランザクションの中のクライアントも渡せる） */
export type SessionDatabase = PrismaService | TransactionClient;

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: BusinessClock,
  ) {}

  /**
   * ログインの成功時に呼ぶ。要求に付いていた同じ種類のセッションを消し、新しい ID のセッションを作って Cookie を設定する。
   */
  async start(req: Request, res: Response, realm: SessionRealm, subjectId: string): Promise<void> {
    const previous = readSessionToken(req, realm);
    if (previous) {
      await this.prisma.session.deleteMany({ where: { id: hashSessionToken(previous), realm } });
    }
    const token = await this.create(realm, subjectId);
    writeSessionCookie(res, realm, token);
  }

  /**
   * セッションを作り、Cookie に入れる ID を返す（Cookie は設定しない）。
   * ログインの API は start を使う。テストでログイン済みの状態を作るとき（src/test/auth/sessions.ts）にも使う。
   */
  async create(realm: SessionRealm, subjectId: string): Promise<string> {
    const token = generateSessionToken();
    const now = this.clock.now();
    await this.prisma.session.create({
      data: {
        id: hashSessionToken(token),
        realm,
        subjectId,
        lastSeenAt: now,
        expiresAt: this.expiryFrom(realm, now),
      },
    });
    return token;
  }

  /**
   * 要求の Cookie のセッションを確かめる。
   * 有効で、loadSubject がセッションの利用者を返したら、最後の操作の時刻と期限を延ばし、Cookie を設定し直して、利用者を返す。
   * - Cookie がない、ほかの種類のセッション、存在しない：undefined
   * - 期限切れ：セッションを消して undefined
   * - loadSubject が undefined を返した（退会した会員・停止中のスタッフなど）：セッションを消して undefined
   * - 確かめている間に、同時のログアウト・停止・退会でセッションが消された：undefined（Cookie は設定し直さない）
   */
  async resolve<T>(
    req: Request,
    res: Response,
    realm: SessionRealm,
    loadSubject: (subjectId: string) => Promise<T | undefined>,
  ): Promise<T | undefined> {
    const token = readSessionToken(req, realm);
    if (!token) return undefined;
    const id = hashSessionToken(token);
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session || session.realm !== realm) return undefined;

    const now = this.clock.now();
    if (now.getTime() >= session.expiresAt.getTime()) {
      await this.prisma.session.deleteMany({ where: { id } });
      return undefined;
    }
    const subject = await loadSubject(session.subjectId);
    if (subject === undefined) {
      await this.prisma.session.deleteMany({ where: { id } });
      return undefined;
    }

    const { count } = await this.prisma.session.updateMany({
      where: { id, realm },
      data: { lastSeenAt: now, expiresAt: this.expiryFrom(realm, now) },
    });
    if (count === 0) {
      // 確かめている間に、同時のログアウト・停止・退会でセッションが消された
      return undefined;
    }
    writeSessionCookie(res, realm, token);
    return subject;
  }

  /** ログアウト：要求の Cookie のセッションを消し、Cookie も消す */
  async end(req: Request, res: Response, realm: SessionRealm): Promise<void> {
    const token = readSessionToken(req, realm);
    if (token) {
      await this.prisma.session.deleteMany({ where: { id: hashSessionToken(token), realm } });
    }
    clearSessionCookie(res, realm);
  }

  /**
   * 利用者のセッションをすべて消し、消した数を返す（退会：要件 1.11、スタッフの停止：L-9・L-28）。
   * @param db 停止・退会と同じトランザクションで消すときは、そのトランザクションのクライアントを渡す
   */
  async endAllFor(
    realm: SessionRealm,
    subjectId: string,
    db: SessionDatabase = this.prisma,
  ): Promise<number> {
    const { count } = await db.session.deleteMany({ where: { realm, subjectId } });
    return count;
  }

  /** 期限の切れたセッション（期限ちょうどを含む）をまとめて消し、消した数を返す（定時処理から呼ぶ） */
  async deleteExpired(): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({
      where: { expiresAt: { lte: this.clock.now() } },
    });
    return count;
  }

  private expiryFrom(realm: SessionRealm, lastSeenAt: Date): Date {
    return new Date(lastSeenAt.getTime() + SESSION_POLICIES[realm].idleTimeoutMs);
  }
}
