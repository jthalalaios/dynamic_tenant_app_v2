import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { InputSwitch } from 'primereact/inputswitch'
import { InputText } from 'primereact/inputtext'
import { MultiSelect } from 'primereact/multiselect'
import { SelectButton } from 'primereact/selectbutton'
import { CHAT_ROOM_ICONS, type ChatRoomPayload } from '../../api'
import { useFormErrors } from '../../hooks/useFormErrors'
import { useNotify } from '../../hooks/useNotify'
import { useT } from '../../i18n'
import { useAccessStore, useChatStore } from '../../stores'
import type { ChatAudience, ChatRoom } from '../../types/models'
import { cx } from '../../utils/cx'
import styles from './ChatRoomDialog.module.css'

interface RoomForm {
  name: string
  description: string
  icon: string
  is_locked: boolean
  audience: ChatAudience
  role_ids: number[]
}

interface ChatRoomDialogProps {
  visible: boolean
  room: ChatRoom | null
  onVisibleChange: (visible: boolean) => void
  onSaved: (room: ChatRoom) => void
  onDelete: (room: ChatRoom) => void
}

export default function ChatRoomDialog({ visible, room, onVisibleChange, onSaved, onDelete }: ChatRoomDialogProps) {
  const { t } = useT()
  const isAdmin = useAccessStore((s) => s.isAdmin)
  const chatRoles = useChatStore((s) => s.roles)
  const notify = useNotify()
  const errors = useFormErrors()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<RoomForm>({ name: '', description: '', icon: 'comments', is_locked: false, audience: 'everyone', role_ids: [] })
  const patch = (changes: Partial<RoomForm>) => setForm((current) => ({ ...current, ...changes }))

  // Administrators can pick any audience; other room managers only everyone or their own roles
  const audienceOptions = [
    { value: 'everyone', label: t('chat.audience.everyone'), disabled: false },
    { value: 'admins', label: t('chat.audience.admins'), disabled: !isAdmin },
    { value: 'roles', label: t('chat.audience.roles'), disabled: false }
  ]
  // Administrators enter every room anyway, so admin roles are not offered
  const roleOptions = chatRoles.filter((r) => !r.is_admin).map((r) => ({ ...r, disabled: !r.assignable }))
  const audienceHint = t(`chat.audience.${form.audience}Hint`, {
    roles:
      roleOptions
        .filter((r) => form.role_ids.includes(r.id))
        .map((r) => r.name)
        .join(', ') || '…'
  })

  // Fresh form every time the dialog opens (only then: room objects are replaced on every refresh)
  const latestRoom = useRef(room)
  latestRoom.current = room
  const { clear } = errors
  useEffect(() => {
    if (!visible) return
    const current = latestRoom.current
    clear()
    setForm({
      name: current?.name ?? '',
      description: current?.description ?? '',
      icon: current?.icon ?? 'comments',
      is_locked: current?.is_locked ?? false,
      audience: current?.audience ?? 'everyone',
      role_ids: (current?.roles ?? []).map((r) => r.id)
    })
  }, [visible, clear])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setSaving(true)
    errors.clear()
    const payload: ChatRoomPayload = { name: form.name.trim(), description: form.description.trim() || null, icon: form.icon }
    // Only administrators may (un)lock; others never send the flag
    if (isAdmin) payload.is_locked = form.is_locked
    // The Global room is always open to everyone: its audience is never sent
    if (!room?.is_default) {
      payload.audience = form.audience
      payload.role_ids = form.audience === 'roles' ? form.role_ids : []
    }

    try {
      const chat = useChatStore.getState()
      const saved = room ? await chat.updateRoom(room.id, payload) : await chat.createRoom(payload)
      notify.success(t('chat.roomSaved'))
      onSaved(saved)
      onVisibleChange(false)
    } catch (err) {
      if (!errors.capture(err)) notify.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog visible={visible} modal header={room ? t('chat.editRoom') : t('chat.newRoom')} style={{ width: 'min(32rem, 94vw)' }} onHide={() => onVisibleChange(false)}>
      <form className={styles.form} noValidate onSubmit={submit}>
        <div className={styles.field}>
          <label htmlFor="room_name">{t('chat.roomName')}</label>
          <InputText
            id="room_name"
            value={form.name}
            onChange={(e) => patch({ name: e.target.value })}
            maxLength={60}
            invalid={!!errors.first('name')}
            autoFocus
            className="p-fluid-field"
          />
          {errors.first('name') && <small className="field-error">{errors.first('name')}</small>}
        </div>

        <div className={styles.field}>
          <label htmlFor="room_description">{t('chat.roomDescription')}</label>
          <InputText
            id="room_description"
            value={form.description}
            onChange={(e) => patch({ description: e.target.value })}
            maxLength={240}
            invalid={!!errors.first('description')}
            className="p-fluid-field"
          />
          {errors.first('description') && <small className="field-error">{errors.first('description')}</small>}
        </div>

        <fieldset className={styles.field}>
          <legend>{t('chat.roomIcon')}</legend>
          <div className={styles.icons} role="radiogroup" aria-label={t('chat.roomIcon')}>
            {CHAT_ROOM_ICONS.map((icon) => (
              <button
                key={icon}
                type="button"
                role="radio"
                aria-checked={form.icon === icon}
                aria-label={icon}
                className={cx(styles.icon, form.icon === icon && styles.iconActive)}
                onClick={() => patch({ icon })}
              >
                <i className={`pi pi-${icon}`} aria-hidden="true"></i>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.field}>
          <legend>{t('chat.audience.title')}</legend>
          {room?.is_default ? (
            <p className={`muted ${styles.audienceNote}`}>
              <i className="pi pi-globe" aria-hidden="true"></i> {t('chat.audience.defaultFixed')}
            </p>
          ) : (
            <>
              <SelectButton
                value={form.audience}
                options={audienceOptions}
                optionLabel="label"
                optionValue="value"
                optionDisabled="disabled"
                allowEmpty={false}
                onChange={(e) => e.value && patch({ audience: e.value as ChatAudience })}
              />
              <small className="muted">{audienceHint}</small>
              {form.audience === 'roles' && (
                <MultiSelect
                  value={form.role_ids}
                  options={roleOptions}
                  optionLabel="name"
                  optionValue="id"
                  optionDisabled="disabled"
                  display="chip"
                  placeholder={t('chat.audience.pickRoles')}
                  invalid={!!errors.first('role_ids')}
                  onChange={(e) => patch({ role_ids: (e.value as number[]) ?? [] })}
                  className="p-fluid-field"
                />
              )}
              {errors.first('role_ids') && <small className="field-error">{errors.first('role_ids')}</small>}
            </>
          )}
        </fieldset>

        {isAdmin && (
          <div className={styles.lockField}>
            <InputSwitch checked={form.is_locked} inputId="room_locked" onChange={(e) => patch({ is_locked: !!e.value })} />
            <label htmlFor="room_locked">
              <strong>{t('chat.roomLockedField')}</strong>
              <small className="muted">{t('chat.roomLockedFieldHint')}</small>
            </label>
          </div>
        )}

        <footer className={styles.actions}>
          {room && !room.is_default && <Button label={t('chat.deleteRoom')} icon="pi pi-trash" severity="danger" text type="button" onClick={() => onDelete(room)} />}
          <span className={styles.spacer}></span>
          <Button label={t('common.cancel')} text type="button" onClick={() => onVisibleChange(false)} />
          <Button label={t('common.save')} icon="pi pi-check" type="submit" loading={saving} />
        </footer>
      </form>
    </Dialog>
  )
}
