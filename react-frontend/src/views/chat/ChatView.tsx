import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from 'primereact/button'
import { Skeleton } from 'primereact/skeleton'
import ChatAvatar from '../../components/chat/ChatAvatar'
import ChatComposer from '../../components/chat/ChatComposer'
import ChatMemberPanel from '../../components/chat/ChatMemberPanel'
import ChatMessageList from '../../components/chat/ChatMessageList'
import ChatMuteDialog from '../../components/chat/ChatMuteDialog'
import ChatRoomDialog from '../../components/chat/ChatRoomDialog'
import ChatRoomList from '../../components/chat/ChatRoomList'
import type { ChatMutePayload } from '../../api'
import { confirmDanger } from '../../hooks/confirmDanger'
import { useNotify } from '../../hooks/useNotify'
import { useT } from '../../i18n'
import { useRealtimeStatus } from '../../services/realtime'
import { useAccessStore, useChatStore, useUserStore } from '../../stores'
import { selectActiveRoom, selectDefaultRoom, typingNames } from '../../stores/chat'
import type { ChatMember, ChatMessage, ChatMute, ChatRoom } from '../../types/models'
import { cx } from '../../utils/cx'
import styles from './ChatView.module.css'

const NO_MESSAGES: ChatMessage[] = []
const NO_MEMBERS: ChatMember[] = []

export default function ChatView() {
  const { t } = useT()
  const [params, setParams] = useSearchParams()
  const notify = useNotify()
  const can = useAccessStore((s) => s.can)
  const isAdmin = useAccessStore((s) => s.isAdmin)
  const tenantName = useUserStore((s) => s.tenant?.name)
  const status = useRealtimeStatus((s) => s.status)

  const rooms = useChatStore((s) => s.rooms)
  const ready = useChatStore((s) => s.ready)
  const activeRoomId = useChatStore((s) => s.activeRoomId)
  const room = useChatStore(selectActiveRoom)
  const messages = useChatStore((s) => (room ? (s.messages[room.id] ?? NO_MESSAGES) : NO_MESSAGES))
  const hasMore = useChatStore((s) => (room ? (s.hasMore[room.id] ?? false) : false))
  const loadingHistory = useChatStore((s) => s.loadingHistory)
  const typing = useChatStore((s) => s.typing)
  const onlineHere = useChatStore((s) => (room ? (s.online[room.id] ?? NO_MEMBERS) : NO_MEMBERS))

  const [failed, setFailed] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [locking, setLocking] = useState(false)
  const [showMembers, setShowMembers] = useState(() => window.matchMedia('(min-width: 1180px)').matches)
  /** Phones show one pane at a time */
  const [mobilePane, setMobilePane] = useState<'rooms' | 'conversation'>('conversation')

  const [muteDialog, setMuteDialog] = useState<{ open: boolean; member: ChatMember | null; scope: 'room' | 'everywhere'; busy: boolean }>({
    open: false,
    member: null,
    scope: 'room',
    busy: false
  })
  const [roomDialog, setRoomDialog] = useState<{ open: boolean; room: ChatRoom | null }>({ open: false, room: null })

  const roleNames = (room?.roles ?? []).map((r) => r.name).join(', ')

  /** The room in the URL (?room=3), else the default room */
  const requestedRaw = Number(params.get('room'))
  const requestedRoomId = Number.isInteger(requestedRaw) && requestedRaw > 0 ? requestedRaw : null

  async function ensureStarted(): Promise<void> {
    try {
      await useChatStore.getState().start()
      setFailed(false)
    } catch {
      setFailed(!useChatStore.getState().ready)
    }
  }

  async function retry(): Promise<void> {
    setRetrying(true)
    await ensureStarted()
    setRetrying(false)
  }

  function setRoomParam(id: number): void {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set('room', String(id))
        return next
      },
      { replace: true }
    )
  }

  function selectRoom(id: number): void {
    setMobilePane('conversation')
    if (requestedRoomId !== id) setRoomParam(id)
  }

  // Open whatever the URL asks for once rooms are known; fall back to the default room
  const roomIds = rooms.map((r) => r.id).join(',')
  useEffect(() => {
    if (!ready) return
    const chat = useChatStore.getState()
    const target = chat.rooms.find((r) => r.id === requestedRoomId) ?? selectDefaultRoom(chat)
    if (!target) return
    if (target.id !== requestedRoomId) {
      setRoomParam(target.id)
      return
    }
    chat.openRoom(target.id).catch((err) => notify.error(err))
    // setRoomParam is recreated each render but only uses the stable setParams
  }, [ready, requestedRoomId, roomIds, notify])

  // Start the chat if the app-wide boot has not (or failed); leaving the page
  // leaves the room's presence channel ("online here" means "has it open")
  useEffect(() => {
    if (!useChatStore.getState().ready) void ensureStarted()
    return () => useChatStore.getState().closeRoom()
  }, [])

  async function loadOlder(): Promise<void> {
    if (!room) return
    try {
      await useChatStore.getState().loadOlder(room.id)
    } catch (err) {
      notify.error(err)
    }
  }

  function confirmDelete(message: ChatMessage): void {
    confirmDanger({
      header: t('chat.deleteMessage'),
      message: t('chat.confirmDeleteMessage'),
      rejectLabel: t('common.cancel'),
      acceptLabel: t('common.delete'),
      accept: async () => {
        try {
          await useChatStore.getState().deleteMessage(message)
          notify.success(t('chat.messageDeleted'))
        } catch (err) {
          notify.error(err)
        }
      }
    })
  }

  function openMute(member: ChatMember, scope: 'room' | 'everywhere'): void {
    setMuteDialog({ open: true, member, scope, busy: false })
  }

  async function mute(payload: ChatMutePayload): Promise<void> {
    setMuteDialog((d) => ({ ...d, busy: true }))
    try {
      const created = await useChatStore.getState().mute(payload)
      notify.success(t('chat.mutedToast', { name: created.user?.name ?? '' }))
      setMuteDialog((d) => ({ ...d, open: false }))
    } catch (err) {
      notify.error(err)
    } finally {
      setMuteDialog((d) => ({ ...d, busy: false }))
    }
  }

  async function unmute(target: ChatMute): Promise<void> {
    try {
      await useChatStore.getState().unmute(target)
      notify.success(t('chat.unmutedToast', { name: target.user?.name ?? '' }))
    } catch (err) {
      notify.error(err)
    }
  }

  async function toggleLock(): Promise<void> {
    if (!room) return
    setLocking(true)
    try {
      const updated = await useChatStore.getState().updateRoom(room.id, { is_locked: !room.is_locked })
      notify.success(updated.is_locked ? t('chat.roomLocked') : t('chat.roomUnlocked'))
    } catch (err) {
      notify.error(err)
    } finally {
      setLocking(false)
    }
  }

  function confirmDeleteRoom(target: ChatRoom): void {
    confirmDanger({
      header: t('chat.deleteRoom'),
      message: t('chat.confirmDeleteRoom', { name: target.name }),
      rejectLabel: t('common.cancel'),
      acceptLabel: t('common.delete'),
      accept: async () => {
        try {
          await useChatStore.getState().deleteRoom(target)
          setRoomDialog((d) => ({ ...d, open: false }))
          notify.success(t('chat.roomDeleted'))
        } catch (err) {
          notify.error(err)
        }
      }
    })
  }

  return (
    <main className={`page ${styles.page}`}>
      <header className={styles.hero}>
        <div>
          <p className="eyebrow">{tenantName}</p>
          <h1>{t('chat.title')}</h1>
          <p className={`muted ${styles.subtitle}`}>{t('chat.subtitle')}</p>
        </div>
      </header>

      {failed ? (
        <div className={cx(styles.shell, styles.shellError)}>
          <i className="pi pi-exclamation-circle" aria-hidden="true"></i>
          <p>{t('chat.loadFailed')}</p>
          <Button label={t('chat.retry')} icon="pi pi-refresh" loading={retrying} onClick={() => void retry()} />
        </div>
      ) : (
        <div className={cx(styles.shell, mobilePane === 'rooms' ? styles.paneRooms : styles.paneConversation, showMembers && styles.withMembers)}>
          <ChatRoomList
            className={styles.rooms}
            rooms={rooms}
            activeId={activeRoomId}
            canManage={can('chat.manage')}
            loading={!ready}
            status={status}
            onSelect={selectRoom}
            onCreate={() => setRoomDialog({ open: true, room: null })}
          />

          {room ? (
            <section className={styles.main} aria-label={room.name}>
              <header className={styles.head}>
                <Button icon="pi pi-arrow-left" text rounded className={styles.back} aria-label={t('chat.backToRooms')} onClick={() => setMobilePane('rooms')} />
                <span className={styles.headIcon}>
                  <i className={`pi pi-${room.icon}`} aria-hidden="true"></i>
                </span>
                <div className={styles.title}>
                  <h2>
                    {room.name}
                    {room.is_locked && (
                      <span className={styles.lockedTag}>
                        <i className="pi pi-lock" aria-hidden="true"></i>
                        {t('chat.locked')}
                      </span>
                    )}
                    {room.audience === 'admins' && (
                      <span className={styles.audienceTag} title={t('chat.audience.adminsHint')}>
                        <i className="pi pi-shield" aria-hidden="true"></i>
                        {t('chat.audience.admins')}
                      </span>
                    )}
                    {room.audience === 'roles' && (
                      <span className={styles.audienceTag} title={t('chat.audience.rolesHint', { roles: roleNames })}>
                        <i className="pi pi-users" aria-hidden="true"></i>
                        {roleNames}
                      </span>
                    )}
                  </h2>
                  <p className="muted">{room.description || t('chat.beginning', { room: room.name })}</p>
                </div>

                <div className={styles.headActions}>
                  {onlineHere.length > 0 && (
                    <button type="button" className={styles.presence} title={onlineHere.map((m) => m.name).join(', ')} onClick={() => setShowMembers(true)}>
                      {onlineHere.slice(0, 3).map((m) => (
                        <ChatAvatar key={m.id} member={m} size="sm" />
                      ))}
                      <span>{t('chat.onlineCount', { count: onlineHere.length })}</span>
                    </button>
                  )}
                  {isAdmin && (
                    <Button
                      icon={room.is_locked ? 'pi pi-lock-open' : 'pi pi-lock'}
                      text
                      rounded
                      severity={room.is_locked ? 'warning' : 'secondary'}
                      aria-label={room.is_locked ? t('chat.unlockRoom') : t('chat.lockRoom')}
                      tooltip={room.is_locked ? t('chat.unlockRoom') : t('chat.lockRoom')}
                      tooltipOptions={{ position: 'bottom' }}
                      loading={locking}
                      onClick={() => void toggleLock()}
                    />
                  )}
                  {can('chat.manage') && (
                    <Button
                      icon="pi pi-pencil"
                      text
                      rounded
                      severity="secondary"
                      aria-label={t('chat.editRoom')}
                      tooltip={t('chat.editRoom')}
                      tooltipOptions={{ position: 'bottom' }}
                      onClick={() => setRoomDialog({ open: true, room })}
                    />
                  )}
                  <Button
                    icon="pi pi-users"
                    text
                    rounded
                    severity={showMembers ? undefined : 'secondary'}
                    aria-label={showMembers ? t('chat.hideMembers') : t('chat.showMembers')}
                    aria-pressed={showMembers}
                    tooltip={showMembers ? t('chat.hideMembers') : t('chat.showMembers')}
                    tooltipOptions={{ position: 'bottom' }}
                    onClick={() => setShowMembers((v) => !v)}
                  />
                </div>
              </header>

              <ChatMessageList
                room={room}
                messages={messages}
                hasMore={hasMore}
                loading={loadingHistory}
                typingNames={typingNames(typing, room.id)}
                onLoadOlder={() => void loadOlder()}
                onDelete={confirmDelete}
                onMute={(member) => openMute(member, 'room')}
              />

              <ChatComposer room={room} />
            </section>
          ) : (
            <section className={cx(styles.main, styles.placeholder)}>
              {!ready ? (
                <Skeleton width="60%" height="1.4rem" />
              ) : (
                <p className="muted">
                  <i className="pi pi-comments" aria-hidden="true"></i> {t('chat.noRooms')}
                </p>
              )}
            </section>
          )}

          {room && showMembers && (
            <ChatMemberPanel className={styles.members} room={room} onClose={() => setShowMembers(false)} onMute={openMute} onUnmute={(m) => void unmute(m)} />
          )}
        </div>
      )}

      <ChatMuteDialog
        visible={muteDialog.open}
        member={muteDialog.member}
        room={room}
        initialScope={muteDialog.scope}
        busy={muteDialog.busy}
        onVisibleChange={(open) => setMuteDialog((d) => ({ ...d, open }))}
        onConfirm={(payload) => void mute(payload)}
      />

      <ChatRoomDialog
        visible={roomDialog.open}
        room={roomDialog.room}
        onVisibleChange={(open) => setRoomDialog((d) => ({ ...d, open }))}
        onSaved={(saved) => selectRoom(saved.id)}
        onDelete={confirmDeleteRoom}
      />
    </main>
  )
}
