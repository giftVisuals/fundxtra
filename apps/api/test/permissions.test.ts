import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  canAssignRole,
  effectivePermissions,
  hasPermission,
  permissionsForRole,
  SUPER_ADMIN_ONLY_PERMISSIONS,
} from '@fundxtra/shared';

/**
 * Role-based access control.
 *
 * The risk is privilege escalation through the "extra permissions" field: an
 * admin adding a moderator and quietly granting them `finance:adjust`, or a
 * non-super-admin handing out `admins:manage` and creating a peer.
 */

describe('role expansion', () => {
  it('gives the super admin every permission', () => {
    const permissions = permissionsForRole('SUPER_ADMIN');
    for (const permission of ALL_PERMISSIONS) {
      expect(permissions).toContain(permission);
    }
  });

  it('withholds admin, settings and financial management from a plain admin', () => {
    const permissions = permissionsForRole('ADMIN');
    expect(permissions).not.toContain('admins:manage');
    expect(permissions).not.toContain('settings:manage');
    expect(permissions).not.toContain('finance:manage');
    expect(permissions).not.toContain('finance:adjust');
    // But an admin can still run the platform day to day.
    expect(permissions).toContain('tasks:manage');
    expect(permissions).toContain('withdrawals:process');
    expect(permissions).toContain('submissions:review');
  });

  it('limits a moderator to reviewing and reading', () => {
    const permissions = permissionsForRole('MODERATOR');
    expect(permissions).toEqual(
      expect.arrayContaining(['submissions:review', 'users:view', 'withdrawals:view']),
    );
    expect(permissions).not.toContain('users:manage');
    expect(permissions).not.toContain('withdrawals:process');
    expect(permissions).not.toContain('tasks:manage');
    expect(permissions).not.toContain('finance:adjust');
  });
});

describe('extra permissions cannot escalate privilege', () => {
  it('strips super-admin-only grants from a lower role', () => {
    const granted = effectivePermissions('ADMIN', [
      'admins:manage',
      'settings:manage',
      'finance:manage',
      'audit:view',
    ]);

    for (const permission of SUPER_ADMIN_ONLY_PERMISSIONS) {
      expect(granted).not.toContain(permission);
    }
    // A legitimate extra grant still lands.
    expect(granted).toContain('audit:view');
  });

  it('strips them from a moderator too', () => {
    const granted = effectivePermissions('MODERATOR', ['admins:manage', 'settings:manage']);
    expect(granted).not.toContain('admins:manage');
    expect(granted).not.toContain('settings:manage');
  });

  it('lets a moderator be granted an ordinary extra capability', () => {
    const granted = effectivePermissions('MODERATOR', ['withdrawals:process']);
    expect(granted).toContain('withdrawals:process');
    expect(granted).toContain('submissions:review');
  });

  it('does not let finance:adjust reach a non-super-admin through hasPermission', () => {
    // finance:adjust is not super-admin-*only* in the filter list, so this
    // pins down the intended behaviour explicitly: it is grantable, but only
    // deliberately, and never by default.
    expect(hasPermission('ADMIN', [], 'finance:adjust')).toBe(false);
    expect(hasPermission('MODERATOR', [], 'finance:adjust')).toBe(false);
    expect(hasPermission('SUPER_ADMIN', [], 'finance:adjust')).toBe(true);
  });
});

describe('role assignment', () => {
  it('only a super admin may assign roles', () => {
    expect(canAssignRole('SUPER_ADMIN', 'ADMIN')).toBe(true);
    expect(canAssignRole('SUPER_ADMIN', 'MODERATOR')).toBe(true);
    expect(canAssignRole('ADMIN', 'MODERATOR')).toBe(false);
    expect(canAssignRole('ADMIN', 'ADMIN')).toBe(false);
    expect(canAssignRole('MODERATOR', 'MODERATOR')).toBe(false);
  });
});
