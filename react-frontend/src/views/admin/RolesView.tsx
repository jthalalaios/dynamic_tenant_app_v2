import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button } from 'primereact/button'
import { Checkbox } from 'primereact/checkbox'
import { InputSwitch } from 'primereact/inputswitch'
import { InputText } from 'primereact/inputtext'
import { Message } from 'primereact/message'
import { Skeleton } from 'primereact/skeleton'
import { Tag } from 'primereact/tag'
import BaseCard from '../../components/shared/cards/BaseCard'
import PageHeader from '../../components/shared/PageHeader'
import { permissionsApi, rolesApi } from '../../api'
import { confirmDanger } from '../../hooks/confirmDanger'
import { useFormErrors } from '../../hooks/useFormErrors'
import { useNotify } from '../../hooks/useNotify'
import { useT } from '../../i18n'
import { useAccessStore, useAuthStore } from '../../stores'
import type { PermissionGroup, Role } from '../../types/models'
import { cx } from '../../utils/cx'
import styles from './RolesView.module.css'

interface RoleForm {
  name: string
  description: string
  is_admin: boolean
  permissions: string[]
}

const emptyForm = (): RoleForm => ({ name: '', description: '', is_admin: false, permissions: [] })

const formFor = (role: Role): RoleForm => ({ name: role.name, description: role.description ?? '', is_admin: role.is_admin, permissions: [...(role.permissions ?? [])] })

export default function RolesView() {
  const { t } = useT()
  const notify = useNotify()
  const errors = useFormErrors()
  const can = useAccessStore((s) => s.can)

  const [roles, setRoles] = useState<Role[]>([])
  const [permissionGroups, setPermissionGroups] = useState<PermissionGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<Role | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<RoleForm>(emptyForm)

  const editorOpen = creating || selected !== null
  const readOnly = creating ? !can('roles.create') : !can('roles.update')
  const permissionsError = Object.entries(errors.errors).find(([k]) => k.startsWith('permissions'))?.[1]?.[0]

  function groupState(group: PermissionGroup) {
    const names = group.permissions.map((p) => p.name)
    const granted = names.filter((n) => form.permissions.includes(n)).length
    return { all: granted === names.length, some: granted > 0 }
  }

  function toggleGroup(group: PermissionGroup, checked: boolean) {
    const names = group.permissions.map((p) => p.name)
    setForm((f) => ({ ...f, permissions: checked ? [...new Set([...f.permissions, ...names])] : f.permissions.filter((p) => !names.includes(p)) }))
  }

  function togglePermission(name: string, checked: boolean) {
    setForm((f) => ({ ...f, permissions: checked ? [...f.permissions, name] : f.permissions.filter((p) => p !== name) }))
  }

  function select(role: Role) {
    setCreating(false)
    setSelected(role)
    errors.clear()
    setForm(formFor(role))
  }

  function startCreate() {
    setCreating(true)
    setSelected(null)
    errors.clear()
    setForm(emptyForm())
  }

  /** Reload the list; keep (and refresh) the selected role when it still exists */
  const loadRoles = useCallback(async (keepId: number | null) => {
    const list = await rolesApi.all()
    setRoles(list)
    if (keepId !== null) {
      const fresh = list.find((r) => r.id === keepId)
      setSelected(fresh ?? null)
      if (fresh) setForm(formFor(fresh))
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const [, groups] = await Promise.all([loadRoles(null), permissionsApi.grouped()])
        setPermissionGroups(groups)
      } catch (err) {
        notify.error(err)
      } finally {
        setLoading(false)
      }
    })()
  }, [loadRoles, notify])

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    errors.clear()
    const payload = {
      name: form.name,
      description: form.description || null,
      // System roles keep their admin flag; sending it unchanged is a no-op either way
      is_admin: form.is_admin,
      permissions: form.is_admin ? [] : form.permissions
    }
    try {
      const role = selected ? await rolesApi.update(selected.id, payload) : await rolesApi.create(payload)
      setCreating(false)
      setSelected(role)
      await loadRoles(role.id)
      // The signed-in user's own grants may have changed
      await useAuthStore.getState().refreshSession()
      notify.success(t('common.saved'))
    } catch (err) {
      if (!errors.capture(err)) notify.error(err)
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(role: Role) {
    confirmDanger({
      header: t('common.confirmDeleteTitle'),
      message: t('admin.roles.confirmDelete', { name: role.name, count: role.users_count ?? 0 }),
      rejectLabel: t('common.cancel'),
      acceptLabel: t('common.delete'),
      accept: async () => {
        try {
          await rolesApi.remove(role.id)
          setSelected(null)
          await loadRoles(null)
          await useAuthStore.getState().refreshSession()
          notify.success(t('common.deleted'))
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
        title={t('admin.roles.title')}
        subtitle={t('admin.roles.subtitle')}
        actions={can('roles.create') && <Button label={t('admin.roles.new')} icon="pi pi-plus" onClick={startCreate} />}
      />

      <div className={styles.layout}>
        <BaseCard padding="sm" className={styles.list}>
          {loading ? (
            <Skeleton height="12rem" />
          ) : (
            <ul>
              {roles.map((role) => (
                <li key={role.id}>
                  <button className={cx(styles.item, selected?.id === role.id && styles.itemActive)} onClick={() => select(role)}>
                    <span className={styles.itemName}>
                      {role.name}
                      {role.is_system && <i className="pi pi-lock muted" title={t('admin.roles.system')} aria-hidden="true"></i>}
                    </span>
                    <span className={styles.itemMeta}>
                      {role.is_admin && <Tag value={t('roles.admin')} severity="contrast" rounded />}
                      <span className="muted">{t('admin.roles.members', { count: role.users_count ?? 0 })}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </BaseCard>

        {editorOpen ? (
          <BaseCard padding="lg">
            <form onSubmit={save} noValidate>
              <div className="dialog-form">
                <div className="field">
                  <label htmlFor="r_name">{t('auth.name')}</label>
                  <InputText
                    id="r_name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    disabled={readOnly}
                    invalid={!!errors.first('name')}
                    className="p-fluid-field"
                  />
                  {errors.first('name') && <small className="field-error">{errors.first('name')}</small>}
                </div>
                <div className="field">
                  <label htmlFor="r_desc">{t('admin.roles.description')}</label>
                  <InputText
                    id="r_desc"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    disabled={readOnly}
                    className="p-fluid-field"
                  />
                </div>
                <div className={`field field--full ${styles.toggleField}`}>
                  <InputSwitch
                    inputId="r_admin"
                    checked={form.is_admin}
                    disabled={readOnly || !!selected?.is_system}
                    onChange={(e) => setForm((f) => ({ ...f, is_admin: !!e.value }))}
                  />
                  <label htmlFor="r_admin">{t('admin.roles.isAdmin')}</label>
                  <small className="muted">{t('admin.roles.isAdminHint')}</small>
                </div>
              </div>

              <h3 className={styles.matrixTitle}>{t('admin.roles.permissions')}</h3>
              {form.is_admin ? (
                <Message severity="info" text={t('admin.roles.adminHasAll')} className="page-message" />
              ) : (
                <div className={styles.matrix}>
                  {permissionGroups.map((group) => {
                    const state = groupState(group)
                    return (
                      <fieldset key={group.group} className={styles.group}>
                        <legend>
                          <Checkbox
                            inputId={`group-${group.group}`}
                            checked={state.some}
                            icon={state.some && !state.all ? 'pi pi-minus' : undefined}
                            disabled={readOnly}
                            onChange={() => toggleGroup(group, !state.all)}
                          />
                          <label htmlFor={`group-${group.group}`}>{t(`permissionGroups.${group.group}`)}</label>
                        </legend>
                        {group.permissions.map((permission) => (
                          <div key={permission.name} className={styles.matrixItem}>
                            <Checkbox
                              inputId={permission.name}
                              checked={form.permissions.includes(permission.name)}
                              disabled={readOnly}
                              onChange={(e) => togglePermission(permission.name, !!e.checked)}
                            />
                            <label htmlFor={permission.name}>
                              <span>{permission.description}</span>
                              <code className="muted">{permission.name}</code>
                            </label>
                          </div>
                        ))}
                      </fieldset>
                    )
                  })}
                </div>
              )}
              {permissionsError && <small className="field-error">{permissionsError}</small>}

              <div className={styles.actions}>
                {selected && !selected.is_system && can('roles.delete') && (
                  <Button type="button" label={t('common.delete')} icon="pi pi-trash" severity="danger" text onClick={() => confirmDelete(selected)} />
                )}
                <span className={styles.spacer}></span>
                {!readOnly && <Button label={t('common.save')} type="submit" loading={saving} />}
              </div>
            </form>
          </BaseCard>
        ) : (
          <BaseCard padding="lg">
            <p className="muted">{t('admin.roles.pickOne')}</p>
          </BaseCard>
        )}
      </div>
    </main>
  )
}
