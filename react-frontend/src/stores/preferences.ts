import { create } from 'zustand'
import { detectLocale, intlLocale, isSupportedLocale, loadLocale, type LocaleCode } from '../helpers/language'
import { detectTimezone, isValidTimezone, type FormatOptions } from '../helpers/timezone'
import { storage } from '../helpers/storage'

const TZ_KEY = 'timezone'

interface PreferencesState {
  locale: LocaleCode
  timezone: string
  setLocale: (code: LocaleCode) => Promise<void>
  setTimezone: (tz: string) => void
  /** Adopt the preferences the API resolved for the session */
  applyServer: (prefs: { timezone: string; locale: string }) => Promise<void>
}

const storedTz = storage.get(TZ_KEY)

/**
 * Locale + timezone the UI renders with and sends to the API on every request.
 * Persisted locally for guests; for signed-in users the server-side preference wins.
 */
export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  locale: detectLocale(),
  timezone: isValidTimezone(storedTz) ? storedTz : detectTimezone(),

  setLocale: async (code) => {
    await loadLocale(code)
    set({ locale: code })
  },

  setTimezone: (tz) => {
    if (!isValidTimezone(tz)) return
    set({ timezone: tz })
    storage.set(TZ_KEY, tz)
  },

  applyServer: async (prefs) => {
    get().setTimezone(prefs.timezone)
    if (isSupportedLocale(prefs.locale) && prefs.locale !== get().locale) {
      await get().setLocale(prefs.locale)
    }
  }
}))

/** BCP-47 tag for Intl formatters */
export const selectIntl = (s: PreferencesState) => intlLocale(s.locale)

/** Ready-made options for helpers/timezone formatters */
export function formatOptionsOf(s: Pick<PreferencesState, 'locale' | 'timezone'>): FormatOptions {
  return { timezone: s.timezone, locale: intlLocale(s.locale) }
}
