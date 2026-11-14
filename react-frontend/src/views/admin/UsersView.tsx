import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from 'primereact/button'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { Dialog } from 'primereact/dialog'
import { Dropdown } from 'primereact/dropdown'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputSwitch } from 'primereact/inputswitch'
import { InputText } from 'primereact/inputtext'
import { MultiSelect } from 'primereact/multiselect'
import { Password } from 'primereact/password'
import { Tag } from 'primereact/tag'
import BaseCard from '../../components/shared/cards/BaseCard'
import PageHeader from '../../components/shared/PageHeader'
import { rolesApi, usersApi } from '../../api'
import { confirmDanger } from '../../hooks/confirmDanger'
import { useFormErrors } from '../../hooks/useFormErrors'
import { useFormatters } from '../../hooks/useFormatters'
import { useNotify } from '../../hooks/useNotify'
import { usePaginatedList } from '../../hooks/usePaginatedList'
import { useT } from '../../i18n'
import { useAccessStore, useAuthStore, useUserStore } from '../../stores'
import type { Role, TeamMember } from '../../types/models'
import styles from './UsersView.module.css'

interface MemberForm {
  name: string
  email: string
  password: string
  role_ids: number[]
  is_active: boolean
}

const emptyForm = (): MemberForm => ({ name: '', email: '', password: '', role_ids: [], is_active: true })

export default function UsersView() {
  const { t } = useT()
  const notify = useNotify()
  const errors = useFormErrors()
  const fmt = useFormatters()
  const can = useAccessStore((s) => s.can)
  const myId = useUserStore((s) => s.user?.id)
  const list = usePaginatedList(usersApi.list, { search: '', role_id: null as number | null })
  const [roles, setRoles] = useState<Role[]>([])

  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(searchTimer.current), [])

  function debouncedSearch(value: string) {
    list.setFilters({ search: value })
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => void list.search(), 300)
  }

  const { load } = list
  useEffect(() => {
    void (async () => {
      await load()
      try {
        setRoles(await rolesApi.all())
      } catch (err) {
        notify.error(err)
      }
    })()
  }, [load, notify])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<TeamMember | null>(null)
  const [form, setForm] = useState<MemberForm>(emptyForm)
  const patch = (changes: Partial<MemberForm>) => setForm((current) => ({ ...current, ...changes }))
  const roleError = errors.first('role_ids') ?? Object.entries(errors.errors).find(([k]) => k.startsWith('role_ids.'))?.[1]?.[0]

  function openCreate() {
    setEditing(null)
    errors.clear()
    setForm(emptyForm())
    setDialogOpen(true)
  }

  function openEdit(member: TeamMember) {
    setEditing(member)
    errors.clear()
    setForm({ name: member.name, email: member.email, password: '', role_ids: member.roles?.map((r) => r.id) ?? [], is_active: member.is_active })
    setDialogOpen(true)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    errors.clear()
    try {
      if (editing) {
        await usersApi.update(editing.id, { name: form.name, email: form.email, password: form.password || null, role_ids: form.role_ids, is_active: form.is_active })
        // Editing yourself may change your own permissions
        if (editing.id === myId) await useAuthStore.getState().refreshSession()
      } else {
        await usersApi.create({ name: form.name, email: form.email, password: form.password, role_ids: form.role_ids })
      }
      notify.success(t('common.saved'))
      setDialogOpen(false)
      await list.load()
    } catch (err) {
      if (!errors.capture(err)) notify.error(err)
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(member: TeamMember) {
    confirmDanger({
      header: t('common.confirmDeleteTitle'),
      message: t('admin.users.confirmDelete', { name: member.name }),
      rejectLabel: t('common.cancel'),
      acceptLabel: t('common.delete'),
      accept: async () => {
        try {
          await usersApi.remove(member.id)
          notify.success(t('common.deleted'))
          await list.load()
        } catch (err) {
          notify.error(err)
        }
      }
    })
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow={t('nav.administration')}
        title={t('admin.users.title')}
        subtitle={t('admin.users.subtitle')}
        actions={can('users.create') && <Button label={t('admin.users.new')} icon="pi pi-user-plus" onClick={openCreate} />}
      />

      <BaseCard>
        <div className="table-toolbar">
          <div className="table-toolbar__filters">
            <IconField iconPosition="left">
              <InputIcon className="pi pi-search" />
              <InputText value={list.filters.search ?? ''} placeholder={t('admin.users.search')} onChange={(e) => debouncedSearch(e.target.value)} />
            </IconField>
            <Dropdown
              value={list.filters.role_id}
              options={roles}
              optionLabel="name"
              optionValue="id"
              showClear
              placeholder={t('admin.users.anyRole')}
              onChange={(e) => {
                list.setFilters({ role_id: (e.value as number | null) ?? null })
                void list.search()
              }}
            />
          </div>
        </div>

        <DataTable
          lazy
          paginator
          value={list.items}
          totalRecords={list.total}
          rows={list.rows}
          first={list.first}
          loading={list.loading}
          rowsPerPageOptions={[15, 30, 50]}
          dataKey="id"
          stripedRows
          onPage={list.onPage}
          emptyMessage={t('common.noResults')}
        >
          <Column
            header={t('auth.name')}
            body={(m: TeamMember) => (
              <div className={styles.userCell}>
                <strong>{m.name}</strong>
                <span className="muted">{m.email}</span>
              </div>
            )}
          />
          <Column
            header={t('nav.roles')}
            body={(m: TeamMember) => (
              <div className={styles.tagList}>
                {m.roles?.map((role) => <Tag key={role.id} value={role.name} severity={role.is_admin ? 'contrast' : 'secondary'} rounded />)}
              </div>
            )}
          />
          <Column
            header={t('common.status')}
            body={(m: TeamMember) => <Tag value={m.is_active ? t('common.active') : t('common.inactive')} severity={m.is_active ? 'success' : 'danger'} rounded />}
          />
          <Column header={t('admin.users.lastLogin')} body={(m: TeamMember) => fmt.dateTime(m.last_login_at)} />
          <Column
            header={t('common.actions')}
            headerClassName="row-actions"
            body={(m: TeamMember) => (
              <div className="row-actions">
                {can('users.update') && <Button icon="pi pi-pencil" text rounded size="small" aria-label={t('common.edit')} onClick={() => openEdit(m)} />}
                {can('users.delete') && m.id !== myId && (
                  <Button icon="pi pi-trash" text rounded size="small" severity="danger" aria-label={t('common.delete')} onClick={() => confirmDelete(m)} />
                )}
              </div>
            )}
          />
        </DataTable>
      </BaseCard>

      <Dialog
        visible={dialogOpen}
        onHide={() => setDialogOpen(false)}
        modal
        header={editing ? t('admin.users.edit') : t('admin.users.new')}
        style={{ width: 'min(640px, 95vw)' }}
        footer={
          <>
            <Button label={t('common.cancel')} text onClick={() => setDialogOpen(false)} />
            <Button label={t('common.save')} type="submit" form="user-form" loading={saving} />
          </>
        }
      >
        <form id="user-form" className="dialog-form" onSubmit={save} noValidate>
          <div className="field">
            <label htmlFor="u_name">{t('auth.name')}</label>
            <InputText id="u_name" value={form.name} onChange={(e) => patch({ name: e.target.value })} invalid={!!errors.first('name')} className="p-fluid-field" />
            {errors.first('name') && <small className="field-error">{errors.first('name')}</small>}
          </div>
          <div className="field">
            <label htmlFor="u_email">{t('auth.email')}</label>
            <InputText id="u_email" value={form.email} onChange={(e) => patch({ email: e.target.value })} type="email" invalid={!!errors.first('email')} className="p-fluid-field" />
            {errors.first('email') && <small className="field-error">{errors.first('email')}</small>}
          </div>
          <div className="field field--full">
            <label htmlFor="u_password">{editing ? t('admin.users.newPasswordOptional') : t('auth.password')}</label>
            <Password
              inputId="u_password"
              value={form.password}
              onChange={(e) => patch({ password: e.target.value })}
              toggleMask
              autoComplete="new-password"
              invalid={!!errors.first('password')}
              className="p-fluid-field"
            />
            {errors.first('password') && <small className="field-error">{errors.first('password')}</small>}
          </div>
          <div className="field field--full">
            <label htmlFor="u_roles">{t('nav.roles')}</label>
            <MultiSelect
              inputId="u_roles"
              value={form.role_ids}
              options={roles}
              optionLabel="name"
              optionValue="id"
              display="chip"
              invalid={!!roleError}
              onChange={(e) => patch({ role_ids: (e.value as number[]) ?? [] })}
              className="p-fluid-field"
            />
            {roleError && <small className="field-error">{roleError}</small>}
            <small className="muted">{t('admin.users.rolesHint')}</small>
          </div>
          {editing && (
            <div className={`field field--full ${styles.toggleField}`}>
              <InputSwitch inputId="u_active" checked={form.is_active} disabled={editing.id === myId} onChange={(e) => patch({ is_active: !!e.value })} />
              <label htmlFor="u_active">{t('common.active')}</label>
            </div>
          )}
        </form>
      </Dialog>
    </main>
  )
}
