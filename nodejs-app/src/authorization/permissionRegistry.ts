import { permissionDefinitions, roleDefinitions, type RoleDefinition } from '../config/permissions.ts'
import { permissionScopes, type TenantType } from '../domain/enums.ts'

/**
 * Read-only view over src/config/permissions.ts.
 */
export interface PermissionDefinition {
  name: string
  group: string
  scope: string
  description: string
}

export function allPermissions(): PermissionDefinition[] {
  const definitions: PermissionDefinition[] = []

  for (const [scope, groups] of Object.entries(permissionDefinitions)) {
    for (const [group, permissions] of Object.entries(groups)) {
      for (const [name, description] of Object.entries(permissions)) {
        definitions.push({ name, group, scope, description })
      }
    }
  }

  return definitions
}

export function permissionNames(): string[] {
  return allPermissions().map((p) => p.name)
}

export function permissionExists(name: string): boolean {
  return permissionNames().includes(name)
}

/** Every permission a tenant of this type may grant */
export function permissionNamesFor(type: TenantType): string[] {
  const scopes = permissionScopes(type)
  return allPermissions()
    .filter((p) => scopes.includes(p.scope))
    .map((p) => p.name)
}

/** System roles seeded for each new tenant of the given type */
export function defaultRoles(type: TenantType): Record<string, RoleDefinition> {
  return roleDefinitions[type] ?? {}
}
