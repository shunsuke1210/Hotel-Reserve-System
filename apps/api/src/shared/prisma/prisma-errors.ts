// データベースのエラーの見分け方。
//
// 一意制約の違反は、二重割り当ての防止（room_nights。9.1）・決済待ちは1件（4.18）・お知らせの重複のまとめ（10.9）などで、
// 同時の操作に負けたことを表す。サービスはこれを見分けて、やり直し（L-17）や業務エラーへの変換を行う。
//
// Prisma 7（ドライバーアダプター）のエラーは PrismaClientKnownRequestError で、元の PostgreSQL のエラーが
// meta.driverAdapterError.cause に入る（Prisma の操作は P2002、生の SQL は P2010）。node-postgres を直接使った場合のエラー
// （code・constraint を持つ）も見分ける。

/** PostgreSQL の unique_violation */
const UNIQUE_VIOLATION = '23505';

/**
 * 一意制約の違反かどうか。
 * @param constraint 制約（インデックス）の名前。指定すれば、その制約の違反のときだけ true（例：'room_nights_room_id_stay_date_key'）
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const violation = uniqueViolation(error);
  if (violation === undefined) return false;
  return constraint === undefined || violation.constraint === constraint;
}

interface UniqueViolation {
  /** 違反した制約（インデックス）の名前。分からなければ undefined */
  constraint: string | undefined;
}

function uniqueViolation(error: unknown): UniqueViolation | undefined {
  if (!isRecord(error)) return undefined;

  // Prisma（ドライバーアダプター）のエラー
  const meta = error.meta;
  const adapterError = isRecord(meta) ? meta.driverAdapterError : undefined;
  const cause = isRecord(adapterError) ? adapterError.cause : undefined;
  if (isRecord(cause)) {
    const isUnique =
      cause.originalCode === UNIQUE_VIOLATION || cause.kind === 'UniqueConstraintViolation';
    if (!isUnique) return undefined;
    const constraintInfo = cause.constraint;
    const index = isRecord(constraintInfo) ? constraintInfo.index : undefined;
    return {
      constraint: typeof index === 'string' ? index : constraintFromMessage(cause.originalMessage),
    };
  }

  // node-postgres のエラー
  if (error.code === UNIQUE_VIOLATION) {
    return {
      constraint:
        typeof error.constraint === 'string'
          ? error.constraint
          : constraintFromMessage(error.message),
    };
  }
  return undefined;
}

/** 'duplicate key value violates unique constraint "name"' から name を取り出す */
function constraintFromMessage(message: unknown): string | undefined {
  if (typeof message !== 'string') return undefined;
  return /unique constraint "([^"]+)"/.exec(message)?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
