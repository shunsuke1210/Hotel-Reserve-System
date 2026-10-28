import { STAFF_ROLES, type StaffRole } from '@hotel/contracts';
import { describe, expect, it } from 'vitest';
import { hasRoleAtLeast } from './roles.js';

describe('hasRoleAtLeast（役割は「その役割以上」。管理者 ＞ フロント ＞ 清掃員）', () => {
  it.each<[StaffRole, StaffRole, boolean]>([
    ['ADMIN', 'ADMIN', true],
    ['ADMIN', 'FRONT', true],
    ['ADMIN', 'CLEANER', true],
    ['FRONT', 'ADMIN', false],
    ['FRONT', 'FRONT', true],
    ['FRONT', 'CLEANER', true],
    ['CLEANER', 'ADMIN', false],
    ['CLEANER', 'FRONT', false],
    ['CLEANER', 'CLEANER', true],
  ])('[2.2][2.4][2.5] %s は、%s 以上が必要な操作を使える：%s', (role, required, expected) => {
    expect(hasRoleAtLeast(role, required)).toBe(expected);
  });

  it('すべての役割に順位がある', () => {
    for (const role of STAFF_ROLES) {
      expect(hasRoleAtLeast(role, 'CLEANER')).toBe(true);
    }
  });
});
