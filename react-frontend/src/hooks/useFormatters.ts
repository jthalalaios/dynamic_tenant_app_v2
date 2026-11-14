import { useMemo } from 'react'
import { usePreferencesStore, formatOptionsOf } from '../stores/preferences'
import { intlLocale } from '../helpers/language'
import { formatDate, formatDateTime, formatTime } from '../helpers/timezone'
import { formatMoney } from '../helpers/money'

/** Locale- and timezone-aware formatters bound to the user's preferences */
export function useFormatters() {
  const locale = usePreferencesStore((s) => s.locale)
  const timezone = usePreferencesStore((s) => s.timezone)

  return useMemo(() => {
    const options = formatOptionsOf({ locale, timezone })
    const intl = intlLocale(locale)

    return {
      dateTime: (value: string | null | undefined) => formatDateTime(value, options),
      date: (value: string | null | undefined) => formatDate(value, options),
      time: (value: string | null | undefined) => formatTime(value, options),
      money: (cents: number, currency: string) => formatMoney(cents, currency, intl),
      number: (value: number) => new Intl.NumberFormat(intl).format(value)
    }
  }, [locale, timezone])
}
