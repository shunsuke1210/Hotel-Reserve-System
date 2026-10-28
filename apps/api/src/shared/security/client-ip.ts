// 要求の送り元の IP アドレス（回数制限のキーに使う。ログには出さない）。
// Express の req.ip を使う。リバースプロキシ（nginx）の後ろで動かすときは、Express の trust proxy の設定で
// X-Forwarded-For を信頼するプロキシを指定する（設定しなければ、プロキシの IP アドレスになる）。
import type { Request } from 'express';

export function clientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
