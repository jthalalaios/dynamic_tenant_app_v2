import { DateTime, IANAZone } from 'luxon'

/**
 * Timezone helpers. The database stores UTC; the API speaks ISO-8601 in the
 * viewer's timezone (offset included) and reads offset-less input as the viewer's
 * local wall time.
 */

let zones: Set<string> | null = null

/** Every IANA identifier the runtime knows, plus UTC (PHP's DateTimeZone::listIdentifiers()) */
function knownZones(): Set<string> {
  zones ??= new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])
  return zones
}

export function isValidTimezone(timezone: unknown): timezone is string {
  return typeof timezone === 'string' && timezone !== '' && knownZones().has(timezone) && IANAZone.isValidZone(timezone)
}

export function now(): Date {
  return new Date()
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

export function subMinutes(date: Date, minutes: number): Date {
  return addMinutes(date, -minutes)
}

/** "2026-11-03T09:00:00+02:00": seconds precision, offset always numeric (also for UTC) */
export function toIso(date: Date | null | undefined, timezone: string): string | null {
  if (!date) return null
  return DateTime.fromJSDate(date, { zone: timezone }).toFormat("yyyy-MM-dd'T'HH:mm:ssZZ")
}

/**
 * Parse a client supplied date. Values without an explicit offset are read as the
 * given zone's wall time; the result is an absolute instant (stored as UTC).
 * Returns null for unparseable input.
 */
export function parseInZone(value: string, timezone: string): Date | null {
  const input = value.trim()
  const candidates = [
    DateTime.fromISO(input, { zone: timezone, setZone: false }),
    DateTime.fromSQL(input, { zone: timezone, setZone: false }),
    DateTime.fromRFC2822(input, { zone: timezone, setZone: false })
  ]
  const valid = candidates.find((d) => d.isValid)
  return valid ? valid.toJSDate() : null
}

/** Start and end of the calendar day containing `at`, in the given zone, as instants */
export function dayRange(timezone: string, at: Date = new Date()): [Date, Date] {
  const local = DateTime.fromJSDate(at, { zone: timezone })
  return [local.startOf('day').toJSDate(), local.endOf('day').toJSDate()]
}

/** A `YYYY-MM-DD` calendar day in the given zone, as its [start, end] instants; null when invalid */
export function dayRangeOf(day: string, timezone: string): [Date, Date] | null {
  const local = DateTime.fromFormat(day, 'yyyy-MM-dd', { zone: timezone })
  if (!local.isValid || local.toFormat('yyyy-MM-dd') !== day) return null
  return [local.startOf('day').toJSDate(), local.endOf('day').toJSDate()]
}

/** Start of the day `days - 1` days ago in the zone (inclusive window of `days` days) */
export function startOfWindow(timezone: string, days: number): Date {
  return DateTime.now().setZone(timezone).minus({ days: days - 1 }).startOf('day').toJSDate()
}

/** "2026-11-03 14:05" in the zone (chat mute messages) */
export function formatShort(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date, { zone: timezone }).toFormat('yyyy-MM-dd HH:mm')
}

/** `YYYYMMDD`-like stamp in UTC, e.g. "261103" for order numbers */
export function utcStamp(date: Date, format: string): string {
  return DateTime.fromJSDate(date, { zone: 'UTC' }).toFormat(format)
}

/** The calendar date (`YYYY-MM-DD`) of an instant (default: now) in the given zone */
export function todayIn(timezone: string, at: Date = new Date()): string {
  return DateTime.fromJSDate(at, { zone: timezone }).toFormat('yyyy-MM-dd')
}
