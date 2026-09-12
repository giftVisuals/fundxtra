import type { AdminRole, Permission } from './types/admin';

/**
 * Role -> permission expansion.
 *
 * Routes declare the permission they need (`requirePermission('finance:adjust')`)
 * rather than comparing role strings, so adding a role never means auditing
 * every handler again.
 */
const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  SUPER_ADMIN: [
    'admins:manage',
    'settings:manage',
    'finance:manage',
    'finance:adjust',
    'tasks:manage',
    'submissions:review',
    'users:view',
    'users:manage',
    'withdrawals:view',
    'withdrawals:process',
    'rewards:manage',
    'announcements:manage',
    'audit:view',
  ],
  ADMIN: [
    'tasks:manage',
    'submissions:review',
    'users:view',
    'users:manage',
    'withdrawals:view',
    'withdrawals:process',
    'rewards:manage',
    'announcements:manage',
    'audit:view',
  ],
  MODERATOR: ['submissions:review', 'users:view', 'withdrawals:view'],
};

export const ALL_PERMISSIONS: readonly Permission[] = ROLE_PERMISSIONS.SUPER_ADMIN;

/** Permissions that only a SUPER_ADMIN may ever hold, even as an extra grant. */
export const SUPER_ADMIN_ONLY_PERMISSIONS: readonly Permission[] = [
  'admins:manage',
  'settings:manage',
  'finance:manage',
];

export function permissionsForRole(role: AdminRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/**
 * Effective permissions for an admin. Extra grants are filtered so a
 * non-super-admin cannot be handed a super-admin-only capability.
 */
export function effectivePermissions(
  role: AdminRole,
  extraPermissions: readonly Permission[] = [],
): Permission[] {
  const base = new Set<Permission>(permissionsForRole(role));
  if (role !== 'SUPER_ADMIN') {
    for (const permission of extraPermissions) {
      if (!SUPER_ADMIN_ONLY_PERMISSIONS.includes(permission)) base.add(permission);
    }
  }
  return [...base];
}

export function hasPermission(
  role: AdminRole,
  extraPermissions: readonly Permission[],
  required: Permission,
): boolean {
  return effectivePermissions(role, extraPermissions).includes(required);
}

/** A role may only assign roles strictly below its own. */
export function canAssignRole(actorRole: AdminRole, targetRole: AdminRole): boolean {
  const rank: Record<AdminRole, number> = { MODERATOR: 1, ADMIN: 2, SUPER_ADMIN: 3 };
  return rank[actorRole] === 3 && rank[targetRole] <= 3 && actorRole === 'SUPER_ADMIN';
}

export const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: 'Super admin',
  ADMIN: 'Admin',
  MODERATOR: 'Moderator',
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  'admins:manage': 'Manage admins',
  'settings:manage': 'Manage system settings',
  'finance:manage': 'Manage financial settings',
  'finance:adjust': 'Adjust user balances',
  'tasks:manage': 'Manage tasks',
  'submissions:review': 'Review task submissions',
  'users:view': 'View users',
  'users:manage': 'Manage users',
  'withdrawals:view': 'View withdrawals',
  'withdrawals:process': 'Process withdrawals',
  'rewards:manage': 'Manage rewards',
  'announcements:manage': 'Manage announcements',
  'audit:view': 'View audit log',
};
