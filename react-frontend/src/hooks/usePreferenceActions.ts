import { useCallback } from 'react'
import { authApi } from '../api'
import type { LocaleCode } from '../helpers/language'
import { isAuthenticated, useAuthStore, usePreferencesStore } from '../stores'
import { useNotify } from './useNotify'

/**
 * Change locale/timezone: applied locally right away and, for signed-in
 * users, saved to their profile so every device follows.
 */
export function usePreferenceActions() {
  const notify = useNotify()

  const persist = useCallback(
    async (payload: { locale?: LocaleCode; timezone?: string }): Promise<void> => {
      if (!isAuthenticated()) return
      try {
        await useAuthStore.getState().applySession(await authApi.updateProfile(payload))
      } catch (err) {
        notify.error(err)
      }
    },
    [notify]
  )

  const changeLocale = useCallback(
    async (code: LocaleCode): Promise<void> => {
      await usePreferencesStore.getState().setLocale(code)
      await persist({ locale: code })
    },
    [persist]
  )

  const changeTimezone = useCallback(
    async (tz: string): Promise<void> => {
      usePreferencesStore.getState().setTimezone(tz)
      await persist({ timezone: tz })
    },
    [persist]
  )

  return { changeLocale, changeTimezone }
}
