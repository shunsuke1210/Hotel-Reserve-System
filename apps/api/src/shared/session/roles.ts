// 役割の順位（design.md 社内用 API の表「役割の欄は『その役割以上』を表す（管理者 ＞ フロント ＞ 清掃員）」、要件 2.2）。
import type { StaffRole } from '@hotel/contracts';

const ROLE_RANK: Readonly<Record<StaffRole, number>> = {
  CLEANER: 1,
  FRONT: 2,
  ADMIN: 3,
};

/** role の役割で、required 以上が必要な操作を使えるか */
export function hasRoleAtLeast(role: StaffRole, required: StaffRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}
