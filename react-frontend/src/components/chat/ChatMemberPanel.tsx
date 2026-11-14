import { useRef, useState, type MouseEvent } from 'react'
import { Button } from 'primereact/button'
import { Menu } from 'primereact/menu'
import type { MenuItem } from 'primereact/menuitem'
import ChatAvatar from './ChatAvatar'
import { useChatTime } from '../../hooks/useChatTime'
import { useRealtimeStatus } from '../../services/realtime'
import { useT } from '../../i18n'
import { useAccessStore, useChatStore, useUserStore } from '../../stores'
import { liveMutes as selectLiveMutes, useChatModeration } from '../../stores/chat'
import type { ChatMember, ChatMute, ChatRoom } from '../../types/models'
import { cx } from '../../utils/cx'
import styles from './ChatMemberPanel.module.css'

interface ChatMemberPanelProps {
  room: ChatRoom
  onClose: () => void
  onMute: (member: ChatMember, scope: 'room' | 'everywhere') => void
  onUnmute: (mute: ChatMute) => void
  className?: string
}

const EMPTY: ChatMember[] = []

export default function ChatMemberPanel({ room, onClose, onMute, onUnmute, className }: ChatMemberPanelProps) {
  const { t } = useT()
  const time = useChatTime()
  const me = useUserStore((s) => s.user?.id ?? null)
  const isAdmin = useAccessStore((s) => s.isAdmin)
  const can = useAccessStore((s) => s.can)
  const members = useChatStore((s) => s.membersByRoom[room.id] ?? EMPTY)
  const onlineMembers = useChatStore((s) => s.online[room.id] ?? EMPTY)
  const rooms = useChatStore((s) => s.rooms)
  const mutes = useChatStore((s) => s.mutes)
  const now = useChatStore((s) => s.now)
  /** Without a live connection we cannot tell who is online, so everyone is listed together */
  const presenceKnown = useRealtimeStatus((s) => s.status === 'connected')
  const { canModerate, muteOf } = useChatModeration()

  const menu = useRef<Menu>(null)
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])

  const liveMutes = selectLiveMutes(mutes, now)
  const isModerator = isAdmin || can('chat.mute')

  // Only the members who may enter this room (its audience)
  const all = [...members].sort((a, b) => Number(b.is_admin) - Number(a.is_admin) || a.name.localeCompare(b.name))
  const onlineIds = new Set(onlineMembers.map((m) => m.id))
  const groups = presenceKnown
    ? [
        { key: 'online', label: t('chat.online'), members: all.filter((m) => onlineIds.has(m.id)) },
        { key: 'offline', label: t('chat.offline'), members: all.filter((m) => !onlineIds.has(m.id)) }
      ].filter((g) => g.members.length)
    : [{ key: 'all', label: t('chat.members'), members: all }]

  const muteLabel = (mute: ChatMute) => (mute.expires_at ? t('chat.mutedUntil', { time: time.full(mute.expires_at) }) : t('chat.mutedForever'))

  function scopeLabel(mute: ChatMute): string {
    if (mute.room_id === null) return t('chat.everywhere')
    const scoped = rooms.find((r) => r.id === mute.room_id)
    return scoped ? `#${scoped.name}` : '—'
  }

  function openMenu(event: MouseEvent, member: ChatMember): void {
    const covering = liveMutes.filter((m) => m.user?.id === member.id && (m.room_id === null || m.room_id === room.id))
    setMenuItems([
      {
        label: member.name,
        items: [
          { label: t('chat.muteInRoom'), icon: 'pi pi-volume-off', command: () => onMute(member, 'room') },
          { label: t('chat.muteEverywhere'), icon: 'pi pi-ban', command: () => onMute(member, 'everywhere') },
          ...covering.map((m) => ({ label: `${t('chat.unmute')} (${scopeLabel(m)})`, icon: 'pi pi-volume-up', command: () => onUnmute(m) }))
        ]
      }
    ])
    menu.current?.toggle(event)
  }

  return (
    <aside className={cx(styles.members, className)} aria-label={t('chat.members')}>
      <header className={styles.head}>
        <h2>{t('chat.members')}</h2>
        <Button icon="pi pi-times" text rounded size="small" className={styles.close} aria-label={t('chat.hideMembers')} onClick={onClose} />
      </header>

      <div className={styles.scroll}>
        {groups.map((group) => (
          <section key={group.key} className={styles.group}>
            <h3>
              {group.label} — {group.members.length}
            </h3>
            <ul>
              {group.members.map((member) => {
                const mute = muteOf(member.id, room.id)
                return (
                  <li key={member.id} className={cx(styles.member, group.key === 'offline' && styles.away)}>
                    <ChatAvatar member={member} size="sm" online={presenceKnown ? group.key === 'online' : undefined} />
                    <span className={styles.name}>
                      {member.name} {member.id === me && <small className="muted">({t('chat.you')})</small>}
                    </span>
                    {member.is_admin && <i className={`pi pi-shield ${styles.admin}`} title={t('chat.admin')} aria-hidden="true"></i>}
                    {mute && <i className={`pi pi-volume-off ${styles.muted}`} title={muteLabel(mute)} aria-hidden="true"></i>}
                    {canModerate(member) && (
                      <Button
                        icon="pi pi-ellipsis-v"
                        text
                        rounded
                        size="small"
                        className={styles.menu}
                        aria-label={t('chat.memberActions', { name: member.name })}
                        aria-haspopup="true"
                        onClick={(event) => openMenu(event, member)}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        {isModerator && (
          <section className={cx(styles.group, styles.mod)}>
            <h3>
              <i className="pi pi-volume-off" aria-hidden="true"></i> {t('chat.mutedMembers')} — {liveMutes.length}
            </h3>
            {!liveMutes.length ? (
              <p className={`muted ${styles.small}`}>{t('chat.noMutes')}</p>
            ) : (
              <ul>
                {liveMutes.map((mute) => (
                  <li key={mute.id} className={styles.mute}>
                    <ChatAvatar member={mute.user} size="sm" />
                    <span className={styles.muteBody}>
                      <strong>{mute.user?.name ?? t('chat.formerMember')}</strong>
                      <small className="muted">
                        {scopeLabel(mute)} · {muteLabel(mute)}
                      </small>
                      {mute.reason && <small className={styles.reason}>“{mute.reason}”</small>}
                    </span>
                    {canModerate(mute.user) && (
                      <Button
                        icon="pi pi-volume-up"
                        text
                        rounded
                        size="small"
                        tooltip={t('chat.unmute')}
                        tooltipOptions={{ position: 'left' }}
                        aria-label={`${t('chat.unmute')}: ${mute.user?.name ?? ''}`}
                        onClick={() => onUnmute(mute)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <Menu ref={menu} model={menuItems} popup />
    </aside>
  )
}
