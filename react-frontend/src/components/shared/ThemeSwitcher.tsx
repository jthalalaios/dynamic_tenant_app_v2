import { useShallow } from 'zustand/react/shallow'
import { useT } from '../../i18n'
import { useThemeStore } from '../../stores'
import { selectAvailableThemes, selectCanSwitch } from '../../stores/theme'
import type { TenantType } from '../../types/models'
import styles from './ThemeSwitcher.module.css'

// Multi mode: guests preview any enabled theme; signed-in users and standalone apps get a fixed one
export default function ThemeSwitcher() {
  const { t } = useT()
  const canSwitch = useThemeStore(selectCanSwitch)
  const available = useThemeStore(useShallow(selectAvailableThemes))
  const current = useThemeStore((s) => s.currentThemeName)

  if (!canSwitch) return null

  return (
    <label className={styles.switcher}>
      <span className={styles.label}>{t('common.theme')}</span>
      <select value={current} onChange={(event) => useThemeStore.getState().setTheme(event.target.value as TenantType)}>
        {available.map((theme) => (
          <option key={theme.name} value={theme.name}>
            {t(`themes.${theme.name}`)}
          </option>
        ))}
      </select>
    </label>
  )
}
