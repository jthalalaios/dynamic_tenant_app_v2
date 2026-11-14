import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from 'primereact/button'
import { Calendar } from 'primereact/calendar'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { Dialog } from 'primereact/dialog'
import { Dropdown } from 'primereact/dropdown'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputText } from 'primereact/inputtext'
import { InputTextarea } from 'primereact/inputtextarea'
import BaseCard from '../../components/shared/cards/BaseCard'
import PageHeader from '../../components/shared/PageHeader'
import { patientsApi } from '../../api'
import { confirmDanger } from '../../hooks/confirmDanger'
import { useFormErrors } from '../../hooks/useFormErrors'
import { useNotify } from '../../hooks/useNotify'
import { usePaginatedList } from '../../hooks/usePaginatedList'
import { dateToIsoDay, wallTimeToDate } from '../../helpers/timezone'
import { useT } from '../../i18n'
import { useAccessStore } from '../../stores'
import type { Patient } from '../../types/models'

interface PatientForm {
  first_name: string
  last_name: string
  email: string
  phone: string
  dob: Date | null
  gender: Patient['gender']
  notes: string
}

const emptyForm = (): PatientForm => ({ first_name: '', last_name: '', email: '', phone: '', dob: null, gender: null, notes: '' })

export default function PatientsView() {
  const { t } = useT()
  const notify = useNotify()
  const errors = useFormErrors()
  const can = useAccessStore((s) => s.can)
  const list = usePaginatedList(patientsApi.list, { search: '' })

  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(searchTimer.current), [])

  const { load } = list
  useEffect(() => {
    void load()
  }, [load])

  function debouncedSearch(value: string) {
    list.setFilters({ search: value })
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => void list.search(), 300)
  }

  const genderOptions = (['female', 'male', 'other'] as const).map((g) => ({ value: g, label: t(`doctor.patients.genders.${g}`) }))

  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Patient | null>(null)
  const [form, setForm] = useState<PatientForm>(emptyForm)
  const patch = (changes: Partial<PatientForm>) => setForm((current) => ({ ...current, ...changes }))

  function openCreate() {
    setEditing(null)
    errors.clear()
    setForm(emptyForm())
    setDialogOpen(true)
  }

  function openEdit(patient: Patient) {
    setEditing(patient)
    errors.clear()
    setForm({
      first_name: patient.first_name,
      last_name: patient.last_name,
      email: patient.email ?? '',
      phone: patient.phone ?? '',
      dob: patient.date_of_birth ? wallTimeToDate(`${patient.date_of_birth}T00:00`) : null,
      gender: patient.gender,
      notes: patient.notes ?? ''
    })
    setDialogOpen(true)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    errors.clear()
    const payload = {
      first_name: form.first_name,
      last_name: form.last_name,
      email: form.email || null,
      phone: form.phone || null,
      date_of_birth: form.dob ? dateToIsoDay(form.dob) : null,
      gender: form.gender,
      notes: form.notes || null
    }
    try {
      if (editing) await patientsApi.update(editing.id, payload)
      else await patientsApi.create(payload)
      notify.success(t('common.saved'))
      setDialogOpen(false)
      await list.load()
    } catch (err) {
      if (!errors.capture(err)) notify.error(err)
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(patient: Patient) {
    confirmDanger({
      header: t('common.confirmDeleteTitle'),
      message: t('doctor.patients.confirmDelete', { name: patient.full_name }),
      rejectLabel: t('common.cancel'),
      acceptLabel: t('common.delete'),
      accept: async () => {
        try {
          await patientsApi.remove(patient.id)
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
        eyebrow={t('nav.patients')}
        title={t('doctor.patients.title')}
        subtitle={t('doctor.patients.subtitle')}
        actions={can('patients.create') && <Button label={t('doctor.patients.new')} icon="pi pi-user-plus" onClick={openCreate} />}
      />

      <BaseCard>
        <div className="table-toolbar">
          <IconField iconPosition="left">
            <InputIcon className="pi pi-search" />
            <InputText value={list.filters.search ?? ''} placeholder={t('doctor.patients.search')} onChange={(e) => debouncedSearch(e.target.value)} />
          </IconField>
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
          <Column field="full_name" header={t('auth.name')} />
          <Column header={t('doctor.patients.dateOfBirth')} body={(p: Patient) => p.date_of_birth ?? '—'} />
          <Column field="phone" header={t('doctor.patients.phone')} />
          <Column field="email" header={t('auth.email')} />
          <Column
            header={t('common.actions')}
            headerClassName="row-actions"
            body={(p: Patient) => (
              <div className="row-actions">
                {can('patients.update') && <Button icon="pi pi-pencil" text rounded size="small" aria-label={t('common.edit')} onClick={() => openEdit(p)} />}
                {can('patients.delete') && (
                  <Button icon="pi pi-trash" text rounded size="small" severity="danger" aria-label={t('common.delete')} onClick={() => confirmDelete(p)} />
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
        header={editing ? t('doctor.patients.edit') : t('doctor.patients.new')}
        style={{ width: 'min(640px, 95vw)' }}
        footer={
          <>
            <Button label={t('common.cancel')} text onClick={() => setDialogOpen(false)} />
            <Button label={t('common.save')} type="submit" form="patient-form" loading={saving} />
          </>
        }
      >
        <form id="patient-form" className="dialog-form" onSubmit={save} noValidate>
          <div className="field">
            <label htmlFor="first_name">{t('doctor.patients.firstName')}</label>
            <InputText id="first_name" value={form.first_name} onChange={(e) => patch({ first_name: e.target.value })} invalid={!!errors.first('first_name')} className="p-fluid-field" />
            {errors.first('first_name') && <small className="field-error">{errors.first('first_name')}</small>}
          </div>
          <div className="field">
            <label htmlFor="last_name">{t('doctor.patients.lastName')}</label>
            <InputText id="last_name" value={form.last_name} onChange={(e) => patch({ last_name: e.target.value })} invalid={!!errors.first('last_name')} className="p-fluid-field" />
            {errors.first('last_name') && <small className="field-error">{errors.first('last_name')}</small>}
          </div>
          <div className="field">
            <label htmlFor="p_email">{t('auth.email')}</label>
            <InputText id="p_email" value={form.email} onChange={(e) => patch({ email: e.target.value })} type="email" invalid={!!errors.first('email')} className="p-fluid-field" />
            {errors.first('email') && <small className="field-error">{errors.first('email')}</small>}
          </div>
          <div className="field">
            <label htmlFor="phone">{t('doctor.patients.phone')}</label>
            <InputText id="phone" value={form.phone} onChange={(e) => patch({ phone: e.target.value })} type="tel" className="p-fluid-field" />
          </div>
          <div className="field">
            <label htmlFor="dob">{t('doctor.patients.dateOfBirth')}</label>
            <Calendar
              inputId="dob"
              value={form.dob}
              onChange={(e) => patch({ dob: (e.value as Date | null) ?? null })}
              dateFormat="yy-mm-dd"
              maxDate={new Date()}
              showIcon
              invalid={!!errors.first('date_of_birth')}
              className="p-fluid-field"
            />
            {errors.first('date_of_birth') && <small className="field-error">{errors.first('date_of_birth')}</small>}
          </div>
          <div className="field">
            <label htmlFor="gender">{t('doctor.patients.gender')}</label>
            <Dropdown
              inputId="gender"
              value={form.gender}
              options={genderOptions}
              optionLabel="label"
              optionValue="value"
              showClear
              onChange={(e) => patch({ gender: (e.value as Patient['gender']) ?? null })}
              className="p-fluid-field"
            />
          </div>
          <div className="field field--full">
            <label htmlFor="p_notes">{t('common.notes')}</label>
            <InputTextarea id="p_notes" value={form.notes} onChange={(e) => patch({ notes: e.target.value })} rows={3} autoResize className="p-fluid-field" />
          </div>
        </form>
      </Dialog>
    </main>
  )
}
