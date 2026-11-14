import { useT } from '../../i18n'
import { useThemeStore, useUserStore } from '../../stores'
import styles from './Footer.module.css'

const year = new Date().getFullYear()

export default function Footer() {
  const { t } = useT()
  const theme = useThemeStore((s) => s.currentThemeName)
  const tenantName = useUserStore((s) => s.tenant?.name)
  // Signed-in users see their organization's name; guests see the previewed theme's brand
  const brand = tenantName ?? (theme === 'marketplace' ? t('common.marketplace') : t('common.clinic'))

  return (
    <footer className={styles.footer}>
      <div className={styles.content}>
        <span>{t('footer.copyright', { year, brand, rightsReserved: t('common.allRightsReserved') })}</span>
      </div>
    </footer>
  )
}
