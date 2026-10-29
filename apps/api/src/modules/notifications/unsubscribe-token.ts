// 配信停止のリンクに入れる署名つきの値（要件 15.7・1.7、design.md POST /marketing/unsubscribe { token }、L-51）。
//
// 形：u1.{会員 ID（ハイフンなしの16進32文字）}.{発行の時刻（UNIX 秒の36進）}.{署名（HMAC-SHA256、base64url）}
// - 署名は、最後の「.」より前の文字列そのもの（用途の名前を前に付ける）に対して作る。どの1文字を書き換えても
//   署名が合わなくなる（TC-MB-093）。比べるときは、作り直した署名の文字列と時間が一定の比較で比べる
// - 期限は設けない（確かめた結果の issuedAt を返すので、使う側が必要なら期限を決められる）。特定電子メール法の
//   「受信を拒否する方法」として、古い配信メールのリンクからも停止できるようにするため。鍵を変えると、
//   それまでのリンクはすべて無効になる
// - 値はログに出さない。会員 ID は個人情報ではないが、値を持つ人はその会員の配信を止められる
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { MIN_UNSUBSCRIBE_TOKEN_SECRET_LENGTH } from '../../shared/config/app-config.js';
import { MailSettings } from './mail-settings.js';

const VERSION = 'u1';
/** 署名の用途（ほかの用途の署名と取り違えないように、署名する文字列の前に付ける） */
const PURPOSE = 'hotel-marketing-unsubscribe';
/** 受け付ける値の最大の長さ（これより長い値は確かめずに無効にする） */
const MAX_TOKEN_LENGTH = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^u1\.([0-9a-f]{32})\.([0-9a-z]{1,11})\.([A-Za-z0-9_-]{43})$/;

export interface UnsubscribeTokenClaims {
  memberId: string;
  /** 発行の時刻（秒の単位） */
  issuedAt: Date;
}

function signature(secret: string, body: string): string {
  return createHmac('sha256', secret).update(`${PURPOSE}:${body}`, 'utf8').digest('base64url');
}

function assertSecret(secret: string): void {
  if (secret.length < MIN_UNSUBSCRIBE_TOKEN_SECRET_LENGTH) {
    throw new RangeError(
      `配信停止のリンクの署名の鍵は ${MIN_UNSUBSCRIBE_TOKEN_SECRET_LENGTH} 文字以上にしてください`,
    );
  }
}

/** 署名つきの値を作る */
export function signUnsubscribeToken(secret: string, claims: UnsubscribeTokenClaims): string {
  assertSecret(secret);
  const memberId = claims.memberId.toLowerCase();
  if (!UUID.test(memberId)) throw new RangeError('会員 ID が UUID の形ではありません');
  const seconds = Math.floor(claims.issuedAt.getTime() / 1000);
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new RangeError('発行の時刻が正しくありません');
  }
  const body = `${VERSION}.${memberId.replaceAll('-', '')}.${seconds.toString(36)}`;
  return `${body}.${signature(secret, body)}`;
}

/** 署名つきの値を確かめる。正しければ中身、そうでなければ null（例外は投げない） */
export function verifyUnsubscribeToken(
  secret: string,
  token: unknown,
): UnsubscribeTokenClaims | null {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  const match = TOKEN.exec(token);
  if (!match) return null;
  const [, hex = '', issued = '', given = ''] = match;
  const body = token.slice(0, token.lastIndexOf('.'));
  const expected = signature(secret, body);
  if (!timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(given, 'utf8'))) return null;
  const seconds = parseInt(issued, 36);
  if (!Number.isSafeInteger(seconds)) return null;
  return {
    memberId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    issuedAt: new Date(seconds * 1000),
  };
}

/** 設定の鍵で、配信停止のリンクの値を作る・確かめる（POST /marketing/unsubscribe は verify を使う） */
@Injectable()
export class UnsubscribeTokens {
  constructor(private readonly settings: MailSettings) {}

  issue(memberId: string, issuedAt: Date): string {
    return signUnsubscribeToken(this.settings.unsubscribeTokenSecret, { memberId, issuedAt });
  }

  verify(token: unknown): UnsubscribeTokenClaims | null {
    return verifyUnsubscribeToken(this.settings.unsubscribeTokenSecret, token);
  }
}
