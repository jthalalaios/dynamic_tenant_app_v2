import { useMemo } from 'react'
import { Dropdown } from 'primereact/dropdown'
import { useT } from '../../i18n'
import { listTimezones, timezoneOffsetLabel } from '../../helpers/timezone'
import { usePreferencesStore } from '../../stores'
import { usePreferenceActions } from '../../hooks/usePreferenceActions'
import { cx } from '../../utils/cx'
import styles from './TimezoneSelector.module.css'

export default function TimezoneSelector({ compact = false }: { compact?: boolean }) {
  const { t } = useT()
  const timezone = usePreferencesStore((s) => s.timezone)
  const { changeTimezone } = usePreferenceActions()

  const options = useMemo(() => {
    const now = new Date()
    return listTimezones().map((tz) => ({ value: tz, label: `${tz.replace(/_/g, ' ')} (${timezoneOffsetLabel(tz, now)})` }))
  }, [])

  return (
    <Dropdown
      value={timezone}
      options={options}
      optionLabel="label"
      optionValue="value"
      filter
      filterPlaceholder={t('common.search')}
      ariaLabel={t('common.timezone')}
      virtualScrollerOptions={{ itemSize: 38 }}
      className={cx(styles.select, compact && styles.compact, compact && 'p-inputtext-sm')}
      onChange={(event) => {
        const tz = event.value as string
        if (tz && tz !== usePreferencesStore.getState().timezone) void changeTimezone(tz)
      }}
    />
  )
}
