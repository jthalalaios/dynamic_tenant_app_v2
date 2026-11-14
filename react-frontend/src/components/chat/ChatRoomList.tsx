import { useState } from 'react'
import { Button } from 'primereact/button'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputText } from 'primereact/inputtext'
import { Skeleton } from 'primereact/skeleton'
import { useChatTime } from '../../hooks/useChatTime'
import { useT } from '../../i18n'
import { useUserStore } from '../../stores'
import type { RealtimeStatus } from '../../services/realtime'
import type { ChatMember, ChatRoom } from '../../types/models'
import { cx } from '../../utils/cx'
import styles from './ChatRoomList.module.css'

interface ChatRoomListProps {
  rooms: ChatRoom[]
  activeId: number | null
  canManage: boolean
  loading: boolean
  status: RealtimeStatus
  onSelect: (id: number) => void
  onCreate: () => void
  className?: string
}

const STATUS_CLASS: Record<RealtimeStatus, string | undefined> = {
  idle: undefined,
  unavailable: undefined,
  connected: styles.statusConnected,
  connecting: styles.statusPending,
  reconnecting: styles.statusPending
}

export default function ChatRoomList({ rooms, activeId, canManage, loading, status, onSelect, onCreate, className }: ChatRoomListProps) {
  const { t } = useT()
  const time = useChatTime()
  const myId = useUserStore((s) => s.user?.id)
  const [search, setSearch] = useState('')

  const term = search.trim().toLowerCase()
  const filtered = term ? rooms.filter((r) => r.name.toLowerCase().includes(term) || r.description?.toLowerCase().includes(term)) : rooms

  /** "Doctor, Receptionist" for role rooms */
  const audienceLabel = (room: ChatRoom) => t('chat.audience.rolesHint', { roles: (room.roles ?? []).map((r) => r.name).join(', ') })

  const authorLabel = (author: ChatMember | null) => {
    if (!author) return t('chat.formerMember')
    return author.id === myId ? t('chat.you') : author.name.split(' ')[0]
  }

  return (
    <aside className={cx(styles.list, className)} aria-label={t('chat.rooms')}>
      <header className={styles.head}>
        <h2>{t('chat.rooms')}</h2>
        {canManage && (
          <Button icon="pi pi-plus" rounded text size="small" aria-label={t('chat.newRoom')} tooltip={t('chat.newRoom')} tooltipOptions={{ position: 'left' }} onClick={onCreate} />
        )}
      </header>

      <IconField iconPosition="left" className={styles.search}>
        <InputIcon className="pi pi-search" />
        <InputText value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('chat.searchRooms')} className="p-inputtext-sm p-fluid-field" />
      </IconField>

      <nav className={styles.items}>
        {loading
          ? [1, 2, 3, 4].map((n) => <Skeleton key={n} height="3.6rem" borderRadius="14px" />)
          : filtered.map((room) => (
              <button
                key={room.id}
                type="button"
                className={cx(styles.room, room.id === activeId && styles.roomActive, (room.unread_count ?? 0) > 0 && styles.roomUnread)}
                aria-current={room.id === activeId ? 'page' : undefined}
                onClick={() => onSelect(room.id)}
              >
                <span className={cx(styles.icon, room.audience !== 'everyone' && styles.iconRestricted)}>
                  <i className={`pi pi-${room.icon}`} aria-hidden="true"></i>
                </span>
                <span className={styles.main}>
                  <span className={styles.top}>
                    <span className={styles.name}>{room.name}</span>
                    {room.audience === 'admins' && <i className={`pi pi-shield ${styles.badgeIcon}`} title={t('chat.audience.adminsHint')} aria-hidden="true"></i>}
                    {room.audience === 'roles' && <i className={`pi pi-users ${styles.badgeIcon}`} title={audienceLabel(room)} aria-hidden="true"></i>}
                    {room.is_locked && <i className={`pi pi-lock ${styles.lock}`} title={t('chat.lockedHint')} aria-hidden="true"></i>}
                    {room.last_message && <span className={styles.time}>{time.stamp(room.last_message.created_at)}</span>}
                  </span>
                  <span className={styles.bottom}>
                    <span className={styles.preview}>
                      {room.last_message ? (
                        <>
                          <strong>{authorLabel(room.last_message.user)}:</strong> {room.last_message.body}
                        </>
                      ) : (
                        room.description || t('chat.empty')
                      )}
                    </span>
                    {!!room.unread_count && (
                      <span className={styles.badge} aria-label={t('chat.unreadCount', { count: room.unread_count })}>
                        {room.unread_count > 99 ? '99+' : room.unread_count}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            ))}
        {!loading && !filtered.length && <p className={`${styles.empty} muted`}>{t('chat.noRooms')}</p>}
      </nav>

      <footer className={cx(styles.status, STATUS_CLASS[status])} role="status">
        <span className={styles.statusDot} aria-hidden="true"></span>
        {t(`chat.status.${status}`)}
      </footer>
    </aside>
  )
}
