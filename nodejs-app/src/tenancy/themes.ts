import { config } from '../config/index.ts'
import { TENANT_TYPES, isTenantType, type TenantType } from '../domain/enums.ts'
import type { Ctx } from '../support/context.ts'

/**
 * Which themes (tenant types) this backend serves and which one the current
 * request's frontend is bound to.
 *
 * - Multi frontend: no X-App-Theme header, every enabled theme is accepted.
 * - Standalone frontend: sends X-App-Theme, so auth endpoints only act on
 *   accounts of that theme and tokens of another theme are refused.
 */
export function enabledThemes(): TenantType[] {
  const configured = config.tenancy.themes.enabled
  if (configured.length === 0) return [...TENANT_TYPES]
  return TENANT_TYPES.filter((type) => configured.includes(type))
}

export function isThemeEnabled(type: unknown): type is TenantType {
  return isTenantType(type) && enabledThemes().includes(type)
}

/** Themes the current request may act on: the requested one, or every enabled one */
export function allowedThemes(ctx: Ctx): TenantType[] {
  return ctx.theme !== null ? [ctx.theme] : enabledThemes()
}

export function themeAllowed(ctx: Ctx, type: unknown): boolean {
  return isTenantType(type) && allowedThemes(ctx).includes(type)
}

/** Base URL of the frontend that serves accounts of the given theme */
export function frontendUrl(type: string | null | undefined): string {
  const url = type ? config.tenancy.themes.frontendUrls[type] : ''
  return (url || config.app.frontendUrl).replace(/\/+$/, '')
}
