// セッションの ID（Cookie の値）。暗号論的な乱数で作り、推測できないようにする（research.md ADR-04）。
// データベース（sessions.id）には ID の SHA-256 だけを保存する（データベースの内容が漏れても、そのままでは使えない）。
// ID はログに出さない。
import { createHash, randomBytes } from 'node:crypto';

/** 乱数のバイト数（256ビット） */
const TOKEN_BYTES = 32;
/** 32バイトを base64url（詰め物なし）にした43文字 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Cookie の値がセッションの ID の形か（形の違う値でデータベースを引かない） */
export function isWellFormedSessionToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/** データベースに保存する値（sessions.id）：ID の SHA-256（16進数の64文字） */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
