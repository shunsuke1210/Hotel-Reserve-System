// 結合テスト用の、スタッフと会員の行を作る補助。パスワードのハッシュは呼び出し側が PasswordHasher で作って渡す
// （Argon2id の計算には時間がかかるので、テストのファイルごとに1回だけ作って使い回す）。
import type { Locale, StaffRole } from '@hotel/contracts';
import type { PrismaService } from '../../shared/prisma/prisma.service.js';

export interface StaffInput {
  staffNumber: string;
  role: StaffRole;
  passwordHash: string;
  name?: string;
  /** 省略時は true（停止していない） */
  isActive?: boolean;
}

/** スタッフの行を作り、ID を返す */
export async function insertStaff(prisma: PrismaService, input: StaffInput): Promise<string> {
  const row = await prisma.staff.create({
    data: {
      staffNumber: input.staffNumber,
      name: input.name ?? `スタッフ ${input.staffNumber}`,
      role: input.role,
      passwordHash: input.passwordHash,
      isActive: input.isActive ?? true,
    },
    select: { id: true },
  });
  return row.id;
}

export interface MemberInput {
  email: string;
  /** 数字だけの電話番号 */
  phone: string;
  /** 退会した会員は null */
  passwordHash: string | null;
  /** 省略時は ACTIVE */
  status?: 'PENDING' | 'ACTIVE' | 'WITHDRAWN';
  /** 省略時は ja */
  preferredLocale?: Locale;
  familyName?: string;
  givenName?: string;
}

/** 会員の行を作り、ID を返す（氏名・住所などは仮の値） */
export async function insertMember(prisma: PrismaService, input: MemberInput): Promise<string> {
  const status = input.status ?? 'ACTIVE';
  const row = await prisma.member.create({
    data: {
      status,
      email: input.email,
      phone: input.phone,
      passwordHash: input.passwordHash,
      familyName: input.familyName ?? '山田',
      givenName: input.givenName ?? '花子',
      postalCode: '9200000',
      address: '石川県金沢市広岡1-1',
      country: 'JP',
      isForeignNonResident: false,
      birthDate: new Date('1990-05-01T00:00:00Z'),
      preferredLocale: input.preferredLocale ?? 'ja',
      emailVerifiedAt: status === 'PENDING' ? null : new Date('2026-01-01T00:00:00Z'),
      withdrawnAt: status === 'WITHDRAWN' ? new Date('2026-06-01T00:00:00Z') : null,
    },
    select: { id: true },
  });
  return row.id;
}
