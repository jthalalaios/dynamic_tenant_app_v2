import { Suspense, useEffect } from 'react'
import { Outlet, ScrollRestoration, useLocation, useMatches } from 'react-router'
import { Toast } from 'primereact/toast'
import { ConfirmDialog } from 'primereact/confirmdialog'
import { ProgressSpinner } from 'primereact/progressspinner'
import Navbar from './components/shared/navbar/Navbar'
import Footer from './components/shared/Footer'
import { toastRef } from './hooks/useNotify'
import { useT } from './i18n'
import { mergedMeta } from './router/meta'
import { splitTextAnimations } from './utils/InitAnimations'
import { useAccessStore, useChatStore, useIsAuthenticated, usePresenceStore, useUserStore } from './stores'
import { selectIsDoctorTenant, selectMustVerifyEmail } from './stores/user'

/**
 * Root layout (the port of App.vue): navbar, the routed page, footer, toasts and
 * confirmations, plus the app-wide presence heartbeat and live chat lifecycle.
 */
export default function App() {
  const { t, locale } = useT()
  const location = useLocation()
  const matches = useMatches()
  const signedIn = useIsAuthenticated()
  const isDoctorTenant = useUserStore(selectIsDoctorTenant)
  const mustVerifyEmail = useUserStore(selectMustVerifyEmail)
  const can = useAccessStore((s) => s.can)
  const meta = mergedMeta(matches)
  const isHome = meta.name === 'home'

  // Clinic staff who can go online get their presence restored (and its heartbeat) after sign-in or reload
  const tracksPresence = signedIn && isDoctorTenant && can('presence.toggle')
  useEffect(() => {
    const presence = usePresenceStore.getState()
    if (tracksPresence) presence.refresh().catch(() => {})
    else presence.reset()
  }, [tracksPresence])

  // Live chat runs app-wide (navbar unread badge, live events) for members who may use it,
  // and is torn down on sign-out or when the permission is revoked
  const usesChat = signedIn && !mustVerifyEmail && can('chat.view')
  useEffect(() => {
    const chat = useChatStore.getState()
    if (usesChat) chat.start().catch(() => {})
    else chat.stop()
  }, [usesChat])

  useEffect(() => splitTextAnimations(), [])

  // Document title per route (router.afterEach)
  useEffect(() => {
    const appName = t('common.appName')
    document.title = meta.title ? `${t(meta.title)} · ${appName}` : appName
  }, [location.pathname, meta.title, locale, t])

  return (
    <>
      <Navbar forceFixed={isHome} />
      <Suspense
        fallback={
          <div className="page-loading" aria-busy="true">
            <ProgressSpinner style={{ width: '2.5rem', height: '2.5rem' }} strokeWidth="4" />
          </div>
        }
      >
        <Outlet />
      </Suspense>
      <Footer />
      <Toast ref={toastRef} position="top-right" />
      <ConfirmDialog />
      <ScrollRestoration />
    </>
  )
}
