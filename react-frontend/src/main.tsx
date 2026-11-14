import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { PrimeReactProvider } from 'primereact/api'
import 'primeicons/primeicons.css'
import './styles.css'
import './themes/theme-base.css'
import './themes/doctor.css'
import './themes/marketplace.css'
import { appApi, configureHttp } from './api'
import { fixedTheme } from './config/edition'
import { router } from './router'
import { mergedMeta } from './router/meta'
import { configureRealtime, realtimeSocketId } from './services/realtime'
import { useAuthStore, usePreferencesStore, useThemeStore } from './stores'

async function bootstrap(): Promise<void> {
  const auth = useAuthStore.getState()
  const preferences = usePreferencesStore.getState()

  // The HTTP layer reads live state through hooks instead of importing stores
  configureHttp({
    getToken: () => useAuthStore.getState().token,
    getLocale: () => usePreferencesStore.getState().locale,
    getTimezone: () => usePreferencesStore.getState().timezone,
    getTheme: () => fixedTheme,
    getSocketId: () => realtimeSocketId(),
    onEmailUnverified: () => {
      // The session is stale (verification state changed elsewhere); resync, then show the notice
      void useAuthStore.getState().refreshSession().catch(() => {})
      if (router.state.location.pathname !== '/verify-email') void router.navigate('/verify-email', { replace: true })
    },
    onUnauthorized: () => {
      if (!useAuthStore.getState().token) return
      useAuthStore.getState().clearSession()
      const { location, matches } = router.state
      if (mergedMeta(matches).requiresAuth) {
        const redirect = `${location.pathname}${location.search}${location.hash}`
        void router.navigate(`/signin?${new URLSearchParams({ redirect })}`, { replace: true })
      }
    }
  })

  // The websocket handshake carries the same token and standalone theme
  configureRealtime({
    getToken: () => useAuthStore.getState().token,
    getTheme: () => fixedTheme
  })

  const themes = useThemeStore.getState()
  themes.init()
  // Multi mode: only offer the themes the API serves (TENANCY_THEMES); never blocks boot
  appApi.config().then((config) => useThemeStore.getState().setEnabled(config.themes)).catch(() => {})
  await preferences.setLocale(preferences.locale)

  // Restore the stored session before the first route renders (the guard reads it)
  await auth.bootstrap()

  createRoot(document.getElementById('app')!).render(
    <StrictMode>
      <PrimeReactProvider value={{ ripple: true }}>
        <RouterProvider router={router} />
      </PrimeReactProvider>
    </StrictMode>
  )
}

void bootstrap()
