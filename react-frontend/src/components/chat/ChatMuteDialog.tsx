import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'
import { SelectButton } from 'primereact/selectbutton'
import ChatAvatar from './ChatAvatar'
import { CHAT_MUTE_DURATIONS, type ChatMutePayload } from '../../api'
import { useT } from '../../i18n'
import type { ChatMember, ChatRoom } from '../../types/models'
import styles from './ChatMuteDialog.module.css'

/** SelectButton needs a non-null value; 0 stands for "until lifted" */
const FOREVER = 0

interface ChatMuteDialogProps {
  visible: boolean
  member: ChatMember | null
  room: ChatRoom | null
  initialScope: 'room' | 'everywhere'
  busy: boolean
  onVisibleChange: (visible: boolean) => void
  onConfirm: (payload: ChatMutePayload) => void
}

export default function ChatMuteDialog({ visible, member, room, initialScope, busy, onVisibleChange, onConfirm }: ChatMuteDialogProps) {
  const { t } = useT()
  const [scope, setScope] = useState<'room' | 'everywhere'>('room')
  const [duration, setDuration] = useState<number>(60)
  const [reason, setReason] = useState('')

  // Fresh form every time the dialog opens (only then: room objects are replaced on every refresh)
  const latest = useRef({ room, initialScope })
  latest.current = { room, initialScope }
  useEffect(() => {
    if (!visible) return
    setScope(latest.current.room ? latest.current.initialScope : 'everywhere')
    setDuration(60)
    setReason('')
  }, [visible])

  const scopeOptions = [...(room ? [{ label: t('chat.scopeRoom', { room: room.name }), value: 'room' }] : []), { label: t('chat.scopeEverywhere'), value: 'everywhere' }]

  const durationOptions = [
    ...CHAT_MUTE_DURATIONS.map((minutes) => ({ label: t(`chat.durations.${minutes}`), value: minutes as number })),
    { label: t('chat.durations.forever'), value: FOREVER }
  ]

  function submit(event: FormEvent): void {
    event.preventDefault()
    if (!member) return
    onConfirm({
      user_id: member.id,
      room_id: scope === 'room' && room ? room.id : null,
      duration_minutes: duration === FOREVER ? null : duration,
      reason: reason.trim() || null
    })
  }

  return (
    <Dialog visible={visible} modal header={member ? t('chat.muteTitle', { name: member.name }) : ''} style={{ width: 'min(30rem, 94vw)' }} onHide={() => onVisibleChange(false)}>
      {member && (
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.who}>
            <ChatAvatar member={member} size="lg" />
            <p className="muted">{t('chat.muteHint')}</p>
          </div>

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>{t('chat.muteScope')}</legend>
            <SelectButton value={scope} options={scopeOptions} optionLabel="label" optionValue="value" allowEmpty={false} onChange={(e) => e.value && setScope(e.value)} />
          </fieldset>

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>{t('chat.muteDuration')}</legend>
            <SelectButton
              value={duration}
              options={durationOptions}
              optionLabel="label"
              optionValue="value"
              allowEmpty={false}
              className={styles.durations}
              onChange={(e) => e.value !== null && e.value !== undefined && setDuration(e.value as number)}
            />
          </fieldset>

          <div className={styles.field}>
            <label htmlFor="mute_reason" className={styles.legend}>
              {t('chat.muteReason')}
            </label>
            <InputText id="mute_reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('chat.muteReasonPlaceholder')} maxLength={240} className="p-fluid-field" />
          </div>

          <footer className={styles.actions}>
            <Button label={t('common.cancel')} text type="button" onClick={() => onVisibleChange(false)} />
            <Button label={t('chat.mute')} icon="pi pi-volume-off" severity="warning" type="submit" loading={busy} />
          </footer>
        </form>
      )}
    </Dialog>
  )
}
