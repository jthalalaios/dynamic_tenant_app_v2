import { randomBytes, randomInt } from 'node:crypto'

/**
 * "Front desk" → "front-desk", "Γιατροί" → "giatroi" (Laravel's Str::slug, ASCII transliteration).
 */
const GREEK: Record<string, string> = {
  α: 'a', ά: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', έ: 'e', ζ: 'z', η: 'i', ή: 'i', θ: 'th',
  ι: 'i', ί: 'i', ϊ: 'i', ΐ: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', ό: 'o',
  π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', ύ: 'y', ϋ: 'y', ΰ: 'y', φ: 'f', χ: 'ch',
  ψ: 'ps', ω: 'o', ώ: 'o'
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[Ͱ-Ͽἀ-῿]/g, (ch) => GREEK[ch] ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/@/g, '-at-')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Cryptographically random alphanumeric string (Str::random) */
export function randomString(length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHANUMERIC[randomInt(ALPHANUMERIC.length)]
  return out
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex')
}

/** "Rita Reception" → "RR" */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
