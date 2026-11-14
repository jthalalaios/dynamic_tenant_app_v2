import { mailThemes } from '../config/branding.ts'
import { config } from '../config/index.ts'
import type { Tenant } from '../db/schema.ts'
import { frontendUrl } from '../tenancy/themes.ts'
import { hasTranslation, trans, transList, type Replacements } from '../support/i18n.ts'

/**
 * Visual identity of one email: which theme it is drawn in and for which organisation.
 * Picked from the recipient's tenant type, so a clinic account gets clinic emails.
 */
export interface MailBrand {
  /** Key in mailThemes: a TenantType value or "default" */
  theme: string
  organization: string
  glyph: string
  colors: Record<string, string>
  frontendUrl: string
  color(name: string): string
}

export function brandFor(tenant: Tenant | null): MailBrand {
  const type = tenant?.type ?? null
  const theme = type !== null && mailThemes[type] ? type : 'default'
  const definition = mailThemes[theme] ?? mailThemes.default
  const colors: Record<string, string> = { ...definition.colors }

  return {
    theme,
    organization: tenant?.name || config.app.name,
    glyph: definition.glyph ?? '✦',
    colors,
    frontendUrl: frontendUrl(type),
    color: (name) => colors[name] ?? '#000000'
  }
}

/**
 * Wording of one email template for one theme, from src/lang/{locale}.ts:
 *
 *   mail.{template}.{theme}.{key}  →  falls back to  mail.{template}.default.{key}
 *   mail.common.{key}              →  shared lines (greeting, footer...)
 *
 * so a theme only overrides the lines it words differently.
 */
export class MailCopy {
  private readonly template: string
  private readonly theme: string
  private readonly locale: string
  private readonly replace: Replacements

  constructor(template: string, theme: string, locale: string, replace: Replacements = {}) {
    this.template = template
    this.theme = theme
    this.locale = locale
    this.replace = replace
  }

  private resolve(key: string): string {
    const themed = `mail.${this.template}.${this.theme}.${key}`
    return hasTranslation(themed, this.locale) ? themed : `mail.${this.template}.default.${key}`
  }

  get(key: string, replace: Replacements = {}): string {
    return trans(this.locale, this.resolve(key), { ...this.replace, ...replace })
  }

  /** A list of lines (e.g. feature highlights); empty when the theme defines none */
  items(key: string): string[] {
    return transList(this.locale, this.resolve(key))
  }

  common(key: string, replace: Replacements = {}): string {
    return trans(this.locale, `mail.common.${key}`, { ...this.replace, ...replace })
  }
}
