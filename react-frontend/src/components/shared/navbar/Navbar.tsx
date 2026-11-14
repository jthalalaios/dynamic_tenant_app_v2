import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { Tag } from 'primereact/tag'
import LanguageSelect from '../LanguageSelect'
import ThemeSwitcher from '../ThemeSwitcher'
import PresenceToggle from '../../../themes/doctor/PresenceToggle'
import { buildNavigation } from '../../../config/navigation'
import { useT } from '../../../i18n'
import { useAccessStore, useAuthStore, useChatStore, useIsAuthenticated, usePreferencesStore, useThemeStore, useUserStore } from '../../../stores'
import { selectTotalUnread } from '../../../stores/chat'
import { selectDisplayName, selectIsDoctorTenant, selectMustVerifyEmail, selectTenantType, selectUserInitials } from '../../../stores/user'
import { useClickOutside } from '../../../hooks/useClickOutside'
import { cx } from '../../../utils/cx'
import styles from './Navbar.module.css'

export default function Navbar({ forceFixed = false }: { forceFixed?: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useT()
  const signedIn = useIsAuthenticated()
  const tenantType = useUserStore(selectTenantType)
  const tenantName = useUserStore((s) => s.tenant?.name)
  const email = useUserStore((s) => s.user?.email)
  const displayName = useUserStore(selectDisplayName)
  const userInitials = useUserStore(selectUserInitials)
  const isDoctorTenant = useUserStore(selectIsDoctorTenant)
  const mustVerifyEmail = useUserStore(selectMustVerifyEmail)
  const can = useAccessStore((s) => s.can)
  const isAdmin = useAccessStore((s) => s.isAdmin)
  const roles = useAccessStore((s) => s.roles)
  const timezone = usePreferencesStore((s) => s.timezone)
  const theme = useThemeStore((s) => s.currentThemeName)
  const totalUnread = useChatStore(selectTotalUnread)

  const [navOpen, setNavOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const adminRef = useRef<HTMLLIElement>(null)
  const accountRef = useRef<HTMLDivElement>(null)
  const authRef = useRef<HTMLDivElement>(null)

  // Different menus per tenant type, and per role: entries are filtered by permission
  const navigation = signedIn && tenantType && !mustVerifyEmail ? buildNavigation(tenantType, can) : { main: [], admin: null }
  const brandLabel = tenantName ?? (theme === 'marketplace' ? t('common.market') : t('common.clinic'))
  const showPresence = signedIn && isDoctorTenant && can('presence.toggle')
  const isAdminRouteActive = location.pathname.startsWith('/admin')

  useClickOutside(adminRef, () => setAdminOpen(false))
  useClickOutside(accountRef, () => setAccountOpen(false))
  useClickOutside(authRef, () => setAuthOpen(false))

  // Close every menu after navigating
  useEffect(() => {
    setNavOpen(false)
    setAdminOpen(false)
    setAccountOpen(false)
    setAuthOpen(false)
  }, [location.pathname, location.search, location.hash])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  async function handleLogout() {
    setAccountOpen(false)
    await useAuthStore.getState().logout()
    await navigate('/signin')
  }

  return (
    <header className={cx(styles.header, (scrolled || forceFixed) && styles.fixed)}>
      <div className={styles.inner}>
        <div className={styles.brandArea}>
          <Link to="/" className={styles.brand}>
            {brandLabel}
          </Link>
        </div>

        <button className={styles.burger} onClick={() => setNavOpen(!navOpen)} aria-label={t('common.menu')} aria-expanded={navOpen}>
          <span></span>
          <span></span>
          <span></span>
        </button>

        <nav className={cx(styles.nav, navOpen && styles.open)} aria-label={t('common.menu')}>
          <ul className={styles.navList}>
            {!signedIn && (
              <li>
                <Link to="/">{t('common.home')}</Link>
              </li>
            )}
            {navigation.main.map((item) => (
              <li key={item.key}>
                <NavLink to={item.to} end className={({ isActive }) => cx(isActive && styles.isActive)}>
                  <i className={item.icon} aria-hidden="true"></i>
                  {t(item.label)}
                  {item.key === 'chat' && totalUnread > 0 && (
                    <span className={styles.badge} aria-label={t('chat.unreadCount', { count: totalUnread })}>
                      {totalUnread > 99 ? '99+' : totalUnread}
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
            {navigation.admin && (
              <li className={styles.hasSub} ref={adminRef}>
                <button className={cx(isAdminRouteActive && styles.isActive)} aria-haspopup="true" aria-expanded={adminOpen} onClick={() => setAdminOpen(!adminOpen)}>
                  <i className={navigation.admin.icon} aria-hidden="true"></i>
                  {t(navigation.admin.label)}
                  <i className={cx('pi pi-angle-down', styles.caret)} aria-hidden="true"></i>
                </button>
                {adminOpen && (
                  <ul className={`${styles.sub} fade-in-down`}>
                    {navigation.admin.items.map((s) => (
                      <li key={s.key}>
                        <NavLink to={s.to} className={({ isActive }) => cx(isActive && styles.isActive)}>
                          <i className={s.icon} aria-hidden="true"></i>
                          {t(s.label)}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )}
          </ul>
        </nav>

        <div className={styles.actions}>
          {showPresence && <PresenceToggle compact />}
          <ThemeSwitcher />
          <LanguageSelect />

          {signedIn ? (
            <div className={styles.accountMenu} ref={accountRef}>
              <button className={cx(styles.iconBtn, styles.accountBtn)} onClick={() => setAccountOpen(!accountOpen)} aria-label={t('common.accountMenu')} aria-expanded={accountOpen}>
                <span className={styles.avatar} aria-hidden="true">
                  {userInitials}
                </span>
              </button>

              {accountOpen && (
                <div className={`${styles.dropdown} ${styles.accountDropdown} fade-in-down`} onClick={(event) => event.stopPropagation()}>
                  <div className={styles.summary}>
                    <strong>{displayName}</strong>
                    <span className={styles.muted}>{email}</span>
                    <div className={styles.roleTags}>
                      {isAdmin && <Tag value={t('roles.admin')} severity="contrast" rounded />}
                      {roles
                        .filter((r) => r !== 'admin')
                        .map((role) => (
                          <Tag key={role} value={role} severity="secondary" rounded />
                        ))}
                    </div>
                    <span className={cx(styles.muted, styles.small)}>
                      <i className="pi pi-clock" aria-hidden="true"></i> {timezone}
                    </span>
                  </div>
                  <ul>
                    <li>
                      <Link to="/settings">{t('common.settings')}</Link>
                    </li>
                    <li>
                      <button className={styles.dropdownAction} onClick={() => void handleLogout()}>
                        {t('common.logout')}
                      </button>
                    </li>
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className={styles.authPerson} ref={authRef}>
              <button className={styles.iconBtn} onClick={() => setAuthOpen(!authOpen)} aria-haspopup="true" aria-expanded={authOpen} aria-label={t('common.accountMenu')}>
                <i className="pi pi-user" style={{ fontSize: '1.15rem' }}></i>
              </button>

              {authOpen && (
                <div className={`${styles.dropdown} fade-in-down`} onClick={(event) => event.stopPropagation()}>
                  <ul>
                    <li>
                      <Link to="/register">{t('common.signUp')}</Link>
                    </li>
                    <li>
                      <Link to="/signin">{t('common.signIn')}</Link>
                    </li>
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
