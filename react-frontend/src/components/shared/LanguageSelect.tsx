import { useRef, useState } from 'react'
import { useT } from '../../i18n'
import { SUPPORTED_LOCALES, type LocaleCode } from '../../helpers/language'
import { usePreferencesStore } from '../../stores'
import { usePreferenceActions } from '../../hooks/usePreferenceActions'
import { useClickOutside } from '../../hooks/useClickOutside'
import { cx } from '../../utils/cx'
import styles from './LanguageSelect.module.css'

export default function LanguageSelect() {
  const { t } = useT()
  const locale = usePreferencesStore((s) => s.locale)
  const { changeLocale } = usePreferenceActions()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useClickOutside(containerRef, () => setOpen(false))

  async function select(code: LocaleCode) {
    setOpen(false)
    await changeLocale(code)
  }

  return (
    <div className={styles.select} ref={containerRef}>
      <button
        className={styles.trigger}
        onClick={() => setOpen(!open)}
        aria-label={t('common.language')}
        title={t('common.language')}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <i className="pi pi-globe"></i>
      </button>

      {open && (
        <div className={`${styles.menu} fade-in-down`} role="menu">
          {SUPPORTED_LOCALES.map((lang) => (
            <button
              key={lang.code}
              className={cx(styles.option, locale === lang.code && styles.active)}
              role="menuitemradio"
              aria-checked={locale === lang.code}
              onClick={() => void select(lang.code)}
            >
              <span className={styles.flag} aria-hidden="true">
                {lang.flag}
              </span>
              <span>{lang.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
