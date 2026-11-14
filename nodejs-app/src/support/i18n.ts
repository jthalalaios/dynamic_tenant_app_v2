import el from '../lang/el.ts'
import en from '../lang/en.ts'
import { config } from '../config/index.ts'

/**
 * Translator with Laravel's semantics: dotted keys (`messages.not_found`),
 * `:placeholder` replacements (also `:Placeholder` / `:PLACEHOLDER`), and a
 * fallback to the first configured locale, then to the key itself.
 */
type Dictionary = { [key: string]: string | string[] | Dictionary }

const DICTIONARIES: Record<string, Dictionary> = { en, el }

export type Replacements = Record<string, string | number>

function lookup(locale: string, key: string): string | string[] | Dictionary | undefined {
  let node: string | string[] | Dictionary | undefined = DICTIONARIES[locale]
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string' || Array.isArray(node)) return undefined
    node = node[part]
  }
  return node
}

function fallbackLocale(): string {
  return config.tenancy.locales[0] ?? 'en'
}

export function supportedLocale(locale: unknown): locale is string {
  return typeof locale === 'string' && config.tenancy.locales.includes(locale)
}

export function hasTranslation(key: string, locale: string): boolean {
  return lookup(locale, key) !== undefined || lookup(fallbackLocale(), key) !== undefined
}

export function replacePlaceholders(line: string, replace: Replacements = {}): string {
  // Longest names first, so `:name` never eats the start of `:name_full`
  const keys = Object.keys(replace).sort((a, b) => b.length - a.length)
  let out = line
  for (const key of keys) {
    const value = String(replace[key])
    out = out
      .replaceAll(`:${key.toUpperCase()}`, value.toUpperCase())
      .replaceAll(`:${key.charAt(0).toUpperCase()}${key.slice(1)}`, value.charAt(0).toUpperCase() + value.slice(1))
      .replaceAll(`:${key}`, value)
  }
  return out
}

/** A translated line; the key itself when no locale defines it */
export function trans(locale: string, key: string, replace: Replacements = {}): string {
  const value = lookup(locale, key) ?? lookup(fallbackLocale(), key)
  return typeof value === 'string' ? replacePlaceholders(value, replace) : key
}

/** A translated list of lines (e.g. email highlights); empty when undefined */
export function transList(locale: string, key: string): string[] {
  const value = lookup(locale, key) ?? lookup(fallbackLocale(), key)
  return Array.isArray(value) ? value.map(String) : []
}

/** Singular / plural pick for `[one, other]` pairs (English and Greek share the rule) */
export function transChoice(locale: string, key: string, count: number, replace: Replacements = {}): string {
  const value = lookup(locale, key) ?? lookup(fallbackLocale(), key)
  if (!Array.isArray(value)) return trans(locale, key, { count, ...replace })
  const line = count === 1 ? value[0] : value[1] ?? value[0]
  return replacePlaceholders(line, { count, ...replace })
}

/**
 * The best supported locale for an Accept-Language header, like Symfony's
 * getPreferredLanguage(): quality order, region tags fall back to their language
 * ("el-GR" → "el"), and the first supported locale when nothing matches.
 */
export function preferredLocale(header: string | undefined, supported: string[] = config.tenancy.locales): string {
  const fallback = supported[0] ?? 'en'
  if (!header) return fallback

  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      const quality = q ? Number.parseFloat(q.slice(2)) : 1
      return { tag: tag.trim().toLowerCase().replace('_', '-'), quality: Number.isFinite(quality) ? quality : 0, index }
    })
    .filter((entry) => entry.tag !== '' && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)

  const lowered = supported.map((s) => s.toLowerCase())
  for (const { tag } of ranked) {
    if (tag === '*') return fallback
    const exact = lowered.indexOf(tag)
    if (exact !== -1) return supported[exact]
    const base = lowered.indexOf(tag.split('-')[0])
    if (base !== -1) return supported[base]
  }

  return fallback
}

/**
 * "1 day", "1 hour 30 minutes" (at most two parts), like CarbonInterval::forHumans(['parts' => 2])
 */
export function humanizeMinutes(locale: string, minutes: number): string {
  const units: [key: string, size: number][] = [
    ['durations.week', 10080],
    ['durations.day', 1440],
    ['durations.hour', 60],
    ['durations.minute', 1]
  ]
  const parts: string[] = []
  let rest = Math.max(0, Math.round(minutes))

  for (const [key, size] of units) {
    if (parts.length === 2) break
    const amount = Math.floor(rest / size)
    if (amount > 0) {
      parts.push(transChoice(locale, key, amount))
      rest -= amount * size
    }
  }

  return parts.length ? parts.join(' ') : transChoice(locale, 'durations.minute', 0)
}
