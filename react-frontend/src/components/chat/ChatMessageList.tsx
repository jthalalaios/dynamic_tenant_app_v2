import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from 'primereact/button'
import { Skeleton } from 'primereact/skeleton'
import ChatAvatar from './ChatAvatar'
import { useChatTime } from '../../hooks/useChatTime'
import { useT } from '../../i18n'
import { useUserStore } from '../../stores'
import { useChatModeration } from '../../stores/chat'
import type { ChatMember, ChatMessage, ChatRoom } from '../../types/models'
import { cx } from '../../utils/cx'
import styles from './ChatMessageList.module.css'

/** Consecutive messages of one author within this window share a header */
const GROUP_WINDOW_MS = 5 * 60_000
/** Within this distance from the bottom, new messages auto-scroll into view */
const STICKY_PX = 140

interface ChatMessageListProps {
  room: ChatRoom
  messages: ChatMessage[]
  hasMore: boolean
  loading: boolean
  typingNames: string[]
  onLoadOlder: () => void
  onDelete: (message: ChatMessage) => void
  onMute: (member: ChatMember) => void
}

type Item =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: ChatMessage; own: boolean; head: boolean; muted: boolean; canDelete: boolean; canModerate: boolean }

export default function ChatMessageList({ room, messages, hasMore, loading, typingNames, onLoadOlder, onDelete, onMute }: ChatMessageListProps) {
  const { t } = useT()
  const time = useChatTime()
  const myId = useUserStore((s) => s.user?.id)
  const { canDelete, canModerate, muteOf } = useChatModeration()

  const scroller = useRef<HTMLDivElement>(null)
  const [unseen, setUnseen] = useState(0)
  const pinnedToBottom = useRef(true)
  const restore = useRef<{ height: number; top: number } | null>(null)
  const previousMessages = useRef<ChatMessage[] | null>(null)

  const items: Item[] = []
  let previous: ChatMessage | null = null
  let previousDay = ''
  for (const message of messages) {
    const day = time.dayKey(message.created_at)
    if (day !== previousDay) {
      items.push({ kind: 'day', key: `day-${day}`, label: time.dayLabel(message.created_at) })
      previous = null
      previousDay = day
    }

    const sameAuthor = previous !== null && previous.user?.id === message.user?.id
    const close = previous !== null && Date.parse(message.created_at) - Date.parse(previous.created_at) < GROUP_WINDOW_MS
    const author = message.user

    items.push({
      kind: 'message',
      key: `m-${message.id}`,
      message,
      own: author?.id === myId,
      head: !(sameAuthor && close),
      muted: author ? muteOf(author.id, room.id) !== null : false,
      canDelete: canDelete(message),
      canModerate: canModerate(author)
    })
    previous = message
  }

  const typingText =
    typingNames.length === 0
      ? ''
      : typingNames.length === 1
        ? t('chat.typingOne', { name: typingNames[0] })
        : typingNames.length === 2
          ? t('chat.typingTwo', { first: typingNames[0], second: typingNames[1] })
          : t('chat.typingMany')

  function distanceFromBottom(): number {
    const el = scroller.current
    return el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0
  }

  function scrollToBottom(smooth = false): void {
    const el = scroller.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    setUnseen(0)
    pinnedToBottom.current = true
  }

  function requestOlder(): void {
    const el = scroller.current
    if (!el || loading || !hasMore) return
    // Keep the first visible message in place once older ones are prepended
    restore.current = { height: el.scrollHeight, top: el.scrollTop }
    onLoadOlder()
  }

  function onScroll(): void {
    const el = scroller.current
    if (!el) return
    pinnedToBottom.current = distanceFromBottom() < STICKY_PX
    if (pinnedToBottom.current) setUnseen(0)
    if (el.scrollTop < 80) requestOlder()
  }

  // New room: start at the latest message
  useLayoutEffect(() => {
    setUnseen(0)
    restore.current = null
    previousMessages.current = null
    scrollToBottom()
    // scrollToBottom only touches refs and state setters
  }, [room.id])

  // After every render with a new message list (Vue's watch + nextTick)
  useLayoutEffect(() => {
    const prev = previousMessages.current
    const next = messages
    if (prev === next) return
    previousMessages.current = next

    const el = scroller.current
    if (!el) return

    const prependedOlder = prev?.length && next.length && next[0].id < prev[0].id
    if (prependedOlder && restore.current) {
      el.scrollTop = el.scrollHeight - restore.current.height + restore.current.top
      restore.current = null
      return
    }
    restore.current = null

    const newest = next[next.length - 1]
    const grew = !prev?.length || (newest && newest.id > prev[prev.length - 1].id)
    if (!grew) return

    const mine = newest?.user?.id === useUserStore.getState().user?.id
    if (pinnedToBottom.current || mine || !prev?.length) scrollToBottom(!!prev?.length)
    else setUnseen((count) => count + next.length - prev.length)
  }, [messages])

  // First paint of the page
  useEffect(() => scrollToBottom(), [])

  return (
    <div className={styles.list}>
      <div ref={scroller} className={styles.scroll} role="log" aria-live="polite" aria-label={room.name} onScroll={onScroll}>
        <div className={styles.history}>
          {hasMore ? (
            <Button label={t('chat.loadOlder')} icon="pi pi-history" size="small" text rounded loading={loading} onClick={requestOlder} />
          ) : (
            !loading && (
              <div className={styles.intro}>
                <span className={styles.introIcon}>
                  <i className={`pi pi-${room.icon}`} aria-hidden="true"></i>
                </span>
                <h3>{room.name}</h3>
                <p className="muted">{room.description || t('chat.beginning', { room: room.name })}</p>
              </div>
            )
          )}
        </div>

        {loading && !messages.length ? (
          [1, 2, 3, 4, 5].map((n) => (
            <div key={n} className={cx(styles.skeletonRow, n % 3 === 0 && styles.skeletonRowOwn)}>
              <Skeleton shape="circle" size="2.4rem" />
              <Skeleton width={`${30 + ((n * 17) % 40)}%`} height="2.6rem" borderRadius="16px" />
            </div>
          ))
        ) : !messages.length ? (
          <p className={`${styles.empty} muted`}>
            <i className="pi pi-comments" aria-hidden="true"></i> {t('chat.empty')}
          </p>
        ) : null}

        {items.map((item) =>
          item.kind === 'day' ? (
            <div key={item.key} className={styles.day} role="separator">
              <span>{item.label}</span>
            </div>
          ) : (
            <article
              key={item.key}
              className={cx(styles.message, item.own && styles.own, !item.head && styles.grouped)}
              aria-label={`${item.message.user?.name ?? t('chat.formerMember')}, ${time.full(item.message.created_at)}`}
            >
              <div className={styles.gutter}>{item.head && !item.own && <ChatAvatar member={item.message.user} />}</div>

              <div className={styles.content}>
                {item.head && (
                  <header className={styles.meta}>
                    <span className={styles.author}>{item.own ? t('chat.you') : (item.message.user?.name ?? t('chat.formerMember'))}</span>
                    {item.message.user?.is_admin && (
                      <span className={styles.adminBadge} title={t('chat.admin')}>
                        <i className="pi pi-shield" aria-hidden="true"></i>
                        {t('chat.admin')}
                      </span>
                    )}
                    {item.muted && (
                      <span className={styles.mutedBadge} title={t('chat.mutedBadge')}>
                        <i className="pi pi-volume-off" aria-hidden="true"></i>
                      </span>
                    )}
                    <time className={styles.time} dateTime={item.message.created_at} title={time.full(item.message.created_at)}>
                      {time.clock(item.message.created_at)}
                    </time>
                  </header>
                )}

                <div className={styles.row}>
                  <p className={styles.bubble} title={item.head ? undefined : time.full(item.message.created_at)}>
                    {item.message.body}
                  </p>

                  {(item.canDelete || item.canModerate) && (
                    <div className={styles.actions}>
                      {item.canModerate && item.message.user && (
                        <button
                          type="button"
                          className={styles.action}
                          title={t('chat.mute')}
                          aria-label={t('chat.muteTitle', { name: item.message.user.name })}
                          onClick={() => item.message.user && onMute(item.message.user)}
                        >
                          <i className="pi pi-volume-off" aria-hidden="true"></i>
                        </button>
                      )}
                      {item.canDelete && (
                        <button
                          type="button"
                          className={cx(styles.action, styles.actionDanger)}
                          title={t('chat.deleteMessage')}
                          aria-label={t('chat.deleteMessage')}
                          onClick={() => onDelete(item.message)}
                        >
                          <i className="pi pi-trash" aria-hidden="true"></i>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </article>
          )
        )}
      </div>

      <div className={styles.footer}>
        {unseen > 0 && (
          <button type="button" className={styles.jump} onClick={() => scrollToBottom(true)}>
            <i className="pi pi-arrow-down" aria-hidden="true"></i>
            {t('chat.newMessages')} · {unseen}
          </button>
        )}

        <p className={styles.typing} aria-live="polite">
          {typingText && (
            <>
              <span className={styles.dots} aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
              </span>
              {typingText}
            </>
          )}
        </p>
      </div>
    </div>
  )
}
