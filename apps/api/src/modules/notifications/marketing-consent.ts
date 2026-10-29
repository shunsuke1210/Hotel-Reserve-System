// 定期配信の同意の現在の状態（design.md marketing_consents：追記だけで、最新の行が現在の状態。要件 1.5〜1.7、15.6）。
// 会員の情報の画面（G18 の同意の表示）でも同じ規則を使う。
import type { Prisma } from '../../shared/prisma/generated/client.js';
import type { TransactionClient } from '../../shared/prisma/transaction.js';

export interface ConsentRecord {
  consented: boolean;
  recordedAt: Date;
  createdAt: Date;
}

/**
 * 最新の行の並べ方：記録の時刻 → 追加した時刻の新しい順。どちらも同じなら取り消し（false）を先にする
 * （同じ時刻に同意と取り消しがあれば、送ってはいけない側に倒す）
 */
export const LATEST_CONSENT_ORDER = [
  { recordedAt: 'desc' },
  { createdAt: 'desc' },
  { consented: 'asc' },
] as const satisfies Prisma.MarketingConsentOrderByWithRelationInput[];

/** 同意が最新で true か（行がなければ、同意していない） */
export function isConsentActive(records: readonly ConsentRecord[]): boolean {
  let latest: ConsentRecord | undefined;
  for (const record of records) {
    if (latest === undefined || compareLatestFirst(record, latest) < 0) latest = record;
  }
  return latest?.consented === true;
}

/** a が b より先（新しい）なら負 */
function compareLatestFirst(a: ConsentRecord, b: ConsentRecord): number {
  return (
    b.recordedAt.getTime() - a.recordedAt.getTime() ||
    b.createdAt.getTime() - a.createdAt.getTime() ||
    Number(a.consented) - Number(b.consented)
  );
}

/** 定期配信を送ってよいかを確かめるのに要る会員の値 */
const MARKETING_RECIPIENT_SELECT = {
  status: true,
  marketingConsents: { select: { consented: true, recordedAt: true, createdAt: true } },
} as const;

/**
 * その会員に定期配信を送ってよいか：会員がいて、有効（ACTIVE）で、同意が最新で true（15.6、brief.md NT-03a）。
 * 作るとき（MailService.enqueueMarketing）と送るとき（定時処理 outbox）の両方で使う
 * （作った後に取り消した・退会した・削除された会員には送らない）。
 */
export async function canReceiveMarketing(
  db: Pick<TransactionClient, 'member'>,
  memberId: string | null,
): Promise<boolean> {
  if (memberId === null) return false;
  const member = await db.member.findUnique({
    where: { id: memberId },
    select: MARKETING_RECIPIENT_SELECT,
  });
  return member !== null && member.status === 'ACTIVE' && isConsentActive(member.marketingConsents);
}
