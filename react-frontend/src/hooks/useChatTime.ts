import { useMemo } from 'react'
import { useT } from '../i18n'
import { formatOptionsOf, usePreferencesStore } from '../stores/preferences'
import { formatDateTime } from '../helpers/timezone'

const DAY_MS = 86_400_000

/** Chat time labels in the viewer's timezone and language: "14:05", "Yesterday", "Mon 3 Nov" */
export function useChatTime() {
  const { t } = useT()
  const locale = usePreferencesStore((s) => s.locale)
  const timezone = usePreferencesStore((s) => s.timezone)

  return useMemo(() => {
    const options = formatOptionsOf({ locale, timezone })

    /** Calendar day (`YYYY-MM-DD`) of an instant in the viewer's zone */
    const dayKey = (value: string | number | Date): string =>
      new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))

    const isToday = (iso: string) => dayKey(iso) === dayKey(Date.now())
    const isYesterday = (iso: string) => dayKey(iso) === dayKey(Date.now() - DAY_MS)

    const clock = (iso: string): string => formatDateTime(iso, options, { dateStyle: undefined, timeStyle: 'short' })

    /** Separator between days in a conversation */
    const dayLabel = (iso: string): string => {
      if (isToday(iso)) return t('chat.today')
      if (isYesterday(iso)) return t('chat.yesterday')
      return formatDateTime(iso, options, { dateStyle: undefined, timeStyle: undefined, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    }

    /** Compact stamp for the room list: time today, else the date */
    const stamp = (iso: string): string => {
      if (isToday(iso)) return clock(iso)
      if (isYesterday(iso)) return t('chat.yesterday')
      return formatDateTime(iso, options, { dateStyle: undefined, timeStyle: undefined, day: 'numeric', month: 'short' })
    }

    /** Full date and time, for tooltips and mute expiries */
    const full = (iso: string): string => formatDateTime(iso, options, { dateStyle: 'medium', timeStyle: 'short' })

    return { dayKey, dayLabel, clock, stamp, full }
  }, [t, locale, timezone])
}
