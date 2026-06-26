/**
 * accessControlManager.ts — v62.0.0 "The Security Vault"
 * Role-based access control with permission inheritance and audit logging.
 */

export type Permission = "read" | "write" | "execute" | "admin" | "delete";
export interface Role { roleId: string; name: string; permissions: Permission[]; inheritsFrom: string[]; }
export interface AccessDecision { decisionId: string; userId: string; resource: string; permission: Permission; granted: boolean; reason: string; }

const roles = new Map<string, Role>();
const userRoles = new Map<string, string[]>();
const decisions: AccessDecision[] = [];
let rCounter = 0, dCounter = 0;

export function defineRole(name: string, permissions: Permission[], inheritsFrom: string[] = []): Role {
  const role: Role = { roleId: `role-${++rCounter}`, name, permissions, inheritsFrom };
  roles.set(role.roleId, role);
  return role;
}

export function assignRole(userId: string, roleId: string): void {
  if (!userRoles.has(userId)) userRoles.set(userId, []);
  userRoles.get(userId)!.push(roleId);
}

function getEffectivePermissions(roleId: string, visited = new Set<string>()): Permission[] {
  if (visited.has(roleId)) return [];
  visited.add(roleId);
  const role = roles.get(roleId);
  if (!role) return [];
  const inherited = role.inheritsFrom.flatMap(id => getEffectivePermissions(id, visited));
  return [...new Set([...role.permissions, ...inherited])];
}

export function checkAccess(userId: string, resource: string, permission: Permission): AccessDecision {
  const userRoleIds = userRoles.get(userId) ?? [];
  const allPerms = userRoleIds.flatMap(rid => getEffectivePermissions(rid));
  const granted = allPerms.includes(permission);
  const decision: AccessDecision = { decisionId: `dec-${++dCounter}`, userId, resource, permission, granted, reason: granted ? "permission_granted" : "insufficient_permissions" };
  decisions.push(decision);
  return decision;
}

export function _resetAccessControlManagerForTest(): void { roles.clear(); userRoles.clear(); decisions.length = 0; rCounter = 0; dCounter = 0; }
