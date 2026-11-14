import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from 'react'
import { Button } from 'primereact/button'
import { InputTextarea } from 'primereact/inputtextarea'
import { ApiError } from '../../api'
import { useChatTime } from '../../hooks/useChatTime'
import { useNotify } from '../../hooks/useNotify'
import { useT } from '../../i18n'
import { useAccessStore, useChatStore } from '../../stores'
import { useChatModeration } from '../../stores/chat'
import type { ChatRoom } from '../../types/models'
import { cx } from '../../utils/cx'
import styles from './ChatComposer.module.css'

/** Mirrors the API's `max:2000` rule */
const MAX_LENGTH = 2000

export interface ChatComposerHandle {
  focus: () => void
}

export default function ChatComposer({ room, ref }: { room: ChatRoom; ref?: Ref<ChatComposerHandle> }) {
  const { t } = useT()
  const notify = useNotify()
  const time = useChatTime()
  const isAdmin = useAccessStore((s) => s.isAdmin)
  const { myMute } = useChatModeration()

  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)

  const focus = () => input.current?.focus()
  useImperativeHandle(ref, () => ({ focus }), [])

  /** Drafts survive switching rooms (in memory, per room) */
  const drafts = useRef(new Map<number, string>())
  const previousRoom = useRef<number | null>(null)
  const bodyRef = useRef(body)
  bodyRef.current = body

  useEffect(() => {
    if (previousRoom.current !== null && previousRoom.current !== room.id) drafts.current.set(previousRoom.current, bodyRef.current)
    if (previousRoom.current !== room.id) {
      setBody(drafts.current.get(room.id) ?? '')
      requestAnimationFrame(focus)
    }
    previousRoom.current = room.id
  }, [room.id])

  const canSend = body.trim().length > 0 && body.length <= MAX_LENGTH && !sending

  const mute = myMute(room.id)
  const blocked = mute
    ? { kind: 'muted', icon: 'pi pi-volume-off', text: mute.expires_at ? t('chat.mutedYouUntil', { time: time.full(mute.expires_at) }) : t('chat.mutedYou') }
    : room.is_locked && !isAdmin
      ? { kind: 'locked', icon: 'pi pi-lock', text: t('chat.lockedHint') }
      : null

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter sends, Shift+Enter adds a line; never interrupt an IME composition
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  async function submit(event?: FormEvent): Promise<void> {
    event?.preventDefault()
    if (!canSend) return
    const text = body.trim()
    setSending(true)
    try {
      await useChatStore.getState().send(text)
      setBody('')
      drafts.current.delete(room.id)
    } catch (err) {
      // The server knows best: a mute or lock may have just been applied
      if (err instanceof ApiError && (err.code === 'chat_muted' || err.code === 'chat_room_locked')) {
        void useChatStore.getState().refreshRooms().catch(() => {})
      }
      notify.error(err)
    } finally {
      setSending(false)
      requestAnimationFrame(focus)
    }
  }

  if (blocked) {
    return (
      <div className={cx(styles.blocked, blocked.kind === 'muted' ? styles.blockedMuted : styles.blockedLocked)} role="status">
        <i className={blocked.icon} aria-hidden="true"></i>
        <span>{blocked.text}</span>
      </div>
    )
  }

  return (
    <form className={styles.composer} onSubmit={submit}>
      <InputTextarea
        ref={input}
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
          useChatStore.getState().notifyTyping()
        }}
        className={styles.input}
        rows={1}
        autoResize
        maxLength={MAX_LENGTH}
        placeholder={t('chat.placeholder', { room: room.name })}
        aria-label={t('chat.placeholder', { room: room.name })}
        onKeyDown={onKeyDown}
      />
      <div className={styles.side}>
        {body.length > MAX_LENGTH - 200 && (
          <small className={cx(styles.count, body.length >= MAX_LENGTH && styles.countFull)}>{t('chat.characters', { count: body.length, max: MAX_LENGTH })}</small>
        )}
        <Button type="submit" icon="pi pi-send" rounded loading={sending} disabled={!canSend} aria-label={t('chat.send')} tooltip={`${t('chat.send')} · ${t('chat.sendHint')}`} tooltipOptions={{ position: 'top' }} />
      </div>
    </form>
  )
}
