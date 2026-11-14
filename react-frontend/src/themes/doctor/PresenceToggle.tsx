import { useT } from '../../i18n'
import { usePresenceStore } from '../../stores'
import { selectOnline, selectSince } from '../../stores/presence'
import { useNotify } from '../../hooks/useNotify'
import { useFormatters } from '../../hooks/useFormatters'
import { cx } from '../../utils/cx'
import styles from './PresenceToggle.module.css'

export default function PresenceToggle({ compact = false }: { compact?: boolean }) {
  const { t } = useT()
  const online = usePresenceStore(selectOnline)
  const since = usePresenceStore(selectSince)
  const busy = usePresenceStore((s) => s.busy)
  const notify = useNotify()
  const fmt = useFormatters()

  async function toggle() {
    const presence = usePresenceStore.getState()
    try {
      if (selectOnline(presence)) {
        await presence.goOffline()
        notify.info(t('presence.wentOffline'))
      } else {
        await presence.goOnline()
        notify.success(t('presence.wentOnline'))
      }
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <button
      type="button"
      className={cx(styles.toggle, online && styles.online, compact && styles.compact)}
      disabled={busy}
      aria-pressed={online}
      title={online ? t('presence.goOffline') : t('presence.goOnline')}
      onClick={toggle}
    >
      <span className={styles.dot} aria-hidden="true"></span>
      <span>{online ? t('presence.online') : t('presence.offline')}</span>
      {!compact && online && since && <span className={styles.since}>{t('presence.since', { time: fmt.time(since) })}</span>}
    </button>
  )
}
