import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

/**
 * Environment loading.
 *
 * `.env` (next to package.json) fills in variables the process does not already
 * have, so values passed by Docker Compose always win over the file, exactly like
 * Laravel's env() precedence.
 */
const envFile = new URL('../../.env', import.meta.url)

if (process.env.NODE_TEST_CONTEXT === undefined && existsSync(envFile)) {
  const parsed = parseEnv(readFileSync(envFile, 'utf8'))
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}

export function env(key: string, fallback = ''): string {
  const value = process.env[key]
  return value === undefined || value === '' ? fallback : value
}

/** "true" / "1" / "yes" / "on" → true; "false" / "0" / "no" / "off" → false; else the fallback */
export function envBool(key: string, fallback: boolean): boolean {
  const value = process.env[key]?.trim().toLowerCase()
  if (value === undefined || value === '') return fallback
  if (['true', '1', 'yes', 'on', '(true)'].includes(value)) return true
  if (['false', '0', 'no', 'off', '(false)'].includes(value)) return false
  return fallback
}

export function envInt(key: string, fallback: number): number {
  const value = Number.parseInt(process.env[key] ?? '', 10)
  return Number.isFinite(value) ? value : fallback
}

/** Comma separated list, trimmed, empty entries dropped */
export function envList(key: string, fallback = ''): string[] {
  return env(key, fallback)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}
