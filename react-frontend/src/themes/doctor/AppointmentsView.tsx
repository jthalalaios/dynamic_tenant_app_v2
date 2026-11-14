import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { AutoComplete, type AutoCompleteCompleteEvent } from 'primereact/autocomplete'
import { Button } from 'primereact/button'
import { Calendar } from 'primereact/calendar'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { Dialog } from 'primereact/dialog'
import { Dropdown } from 'primereact/dropdown'
import { InputNumber } from 'primereact/inputnumber'
import { InputTextarea } from 'primereact/inputtextarea'
import BaseCard from '../../components/shared/cards/BaseCard'
import PageHeader from '../../components/shared/PageHeader'
import StatusTag from '../../components/shared/StatusTag'
import PresenceToggle from './PresenceToggle'
import { ApiError, appointmentsApi, patientsApi } from '../../api'
import { confirmDanger } from '../../hooks/confirmDanger'
import { useFormErrors } from '../../hooks/useFormErrors'
import { useFormatters } from '../../hooks/useFormatters'
import { useNotify } from '../../hooks/useNotify'
import { usePaginatedList } from '../../hooks/usePaginatedList'
import { dateToIsoDay, dateToWallTime, todayIn, wallTimeToDate } from '../../helpers/timezone'
import { snakeToCamel } from '../../helpers/text'
import { useT } from '../../i18n'
import { useAccessStore, usePreferencesStore, usePresenceStore } from '../../stores'
import { selectOnline } from '../../stores/presence'
import type { Appointment, AppointmentReason, AppointmentStatus, Patient } from '../../types/models'

const STATUSES: AppointmentStatus[] = ['scheduled', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show']
const REASONS: AppointmentReason[] = ['consultation', 'follow_up', 'new_patient', 'exam']

interface AppointmentForm {
  /** The picked patient, or the text typed so far (AutoComplete) */
  patient: Patient | string | null
  scheduledAt: Date | null
  duration: number
  reason: AppointmentReason
  notes: string
}

const emptyForm = (): AppointmentForm => ({ patient: null, scheduledAt: null, duration: 30, reason: 'consultation', notes: '' })

export default function AppointmentsView() {
  const { t } = useT()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const notify = useNotify()
  const errors = useFormErrors()
  const fmt = useFormatters()
  const can = useAccessStore((s) => s.can)
  const timezone = usePreferencesStore((s) => s.timezone)
  const online = usePresenceStore(selectOnline)

  const statusOptions = STATUSES.map((s) => ({ value: s, label: t(`status.appointment.${snakeToCamel(s)}`) }))
  const reasonOptions = REASONS.map((r) => ({ value: r, label: t(`doctor.reasons.${snakeToCamel(r)}`) }))

  // Default to "today" in the user's timezone, not the browser's
  const [day, setDay] = useState<Date | null>(() => wallTimeToDate(`${todayIn(usePreferencesStore.getState().timezone)}T00:00`))
  const list = usePaginatedList(appointmentsApi.list, { date: day ? dateToIsoDay(day) : '', status: '' as AppointmentStatus | '' })

  function applyDay(next: Date | null) {
    setDay(next)
    list.setFilters({ date: next ? dateToIsoDay(next) : '' })
    void list.search()
  }

  function applyStatus(next: AppointmentStatus | '') {
    list.setFilters({ status: next })
    void list.search()
  }

  const [busyId, setBusyId] = useState<number | null>(null)

  async function checkIn(appointment: Appointment) {
    setBusyId(appointment.id)
    try {
      await appointmentsApi.checkIn(appointment.id)
      notify.success(t('doctor.dashboard.checkedInToast', { name: appointment.patient?.full_name ?? '' }))
      await list.load()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'user_offline') await usePresenceStore.getState().refresh().catch(() => {})
      notify.error(err)
    } finally {
      setBusyId(null)
    }
  }

  async function setStatus(appointment: Appointment, status: AppointmentStatus) {
    setBusyId(appointment.id)
    try {
      await appointmentsApi.setStatus(appointment.id, status)
      await list.load()
    } catch (err) {
      notify.error(err)
    } finally {
      setBusyId(null)
    }
  }

  function confirmDelete(appointment: Appointment) {
    confirmDanger({
      header: t('common.confirmDeleteTitle'),
      message: t('doctor.appointments.confirmDelete', { name: appointment.patient?.full_name ?? '' }),
      rejectLabel: t('common.cancel'),
      acceptLabel: t('common.delete'),
      accept: async () => {
        try {
          await appointmentsApi.remove(appointment.id)
          notify.success(t('common.deleted'))
          await list.load()
        } catch (err) {
          notify.error(err)
        }
      }
    })
  }

  // --- create / edit dialog -------------------------------------------------
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Appointment | null>(null)
  const [patientSuggestions, setPatientSuggestions] = useState<Patient[]>([])
  const [form, setForm] = useState<AppointmentForm>(emptyForm)
  const patch = (changes: Partial<AppointmentForm>) => setForm((current) => ({ ...current, ...changes }))

  async function searchPatients(event: AutoCompleteCompleteEvent) {
    try {
      setPatientSuggestions((await patientsApi.list({ search: event.query, per_page: 20 })).data)
    } catch (err) {
      notify.error(err)
    }
  }

  function openCreate() {
    setEditing(null)
    errors.clear()
    setForm(emptyForm())
    setDialogOpen(true)
  }

  function openEdit(appointment: Appointment) {
    setEditing(appointment)
    errors.clear()
    setForm({
      patient: appointment.patient ?? null,
      scheduledAt: wallTimeToDate(appointment.scheduled_at),
      duration: appointment.duration_minutes,
      reason: appointment.reason,
      notes: appointment.notes ?? ''
    })
    setDialogOpen(true)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    errors.clear()
    const payload = {
      patient_id: form.patient && typeof form.patient === 'object' ? form.patient.id : 0,
      // Wall time; the API reads it in the user's timezone
      scheduled_at: form.scheduledAt ? dateToWallTime(form.scheduledAt) : '',
      duration_minutes: form.duration,
      reason: form.reason,
      notes: form.notes || null
    }
    try {
      if (editing) await appointmentsApi.update(editing.id, payload)
      else await appointmentsApi.create(payload)
      notify.success(t('common.saved'))
      setDialogOpen(false)
      await list.load()
    } catch (err) {
      if (!errors.capture(err)) notify.error(err)
    } finally {
      setSaving(false)
    }
  }

  // Deep link from the dashboard's "New visit" button
  const deepLink = useRef(params.get('new') === '1')
  const { load } = list
  useEffect(() => {
    void load().then(() => {
      if (!deepLink.current) return
      deepLink.current = false
      openCreate()
      void navigate('/clinic/appointments', { replace: true })
    })
  }, [load, navigate])

  return (
    <main className="page">
      <PageHeader
        eyebrow={t('nav.appointments')}
        title={t('doctor.appointments.title')}
        subtitle={t('doctor.appointments.subtitle')}
        actions={
          (can('presence.toggle') || can('appointments.create')) && (
            <>
              {can('presence.toggle') && <PresenceToggle />}
              {can('appointments.create') && <Button label={t('doctor.appointments.new')} icon="pi pi-plus" onClick={openCreate} />}
            </>
          )
        }
      />

      <BaseCard>
        <div className="table-toolbar">
          <div className="table-toolbar__filters">
            <Calendar
              value={day}
              onChange={(e) => applyDay((e.value as Date | null) ?? null)}
              dateFormat="yy-mm-dd"
              showIcon
              showButtonBar
              placeholder={t('doctor.appointments.anyDay')}
            />
            <Dropdown
              value={list.filters.status || null}
              options={statusOptions}
              optionLabel="label"
              optionValue="value"
              showClear
              placeholder={t('doctor.appointments.anyStatus')}
              onChange={(e) => applyStatus((e.value as AppointmentStatus | null) ?? '')}
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
          <Column header={t('doctor.appointments.when')} body={(a: Appointment) => fmt.dateTime(a.scheduled_at)} />
          <Column header={t('nav.patients')} body={(a: Appointment) => a.patient?.full_name} />
          <Column header={t('doctor.appointments.reason')} body={(a: Appointment) => t(`doctor.reasons.${snakeToCamel(a.reason)}`)} />
          <Column header={t('common.status')} body={(a: Appointment) => <StatusTag kind="appointment" status={a.status} />} />
          <Column
            header={t('doctor.appointments.checkedInBy')}
            body={(a: Appointment) =>
              a.checked_in_by ? (
                <span>
                  {a.checked_in_by.name} · {fmt.time(a.checked_in_at)}
                </span>
              ) : (
                <span className="muted">—</span>
              )
            }
          />
          <Column
            header={t('common.actions')}
            headerClassName="row-actions"
            body={(a: Appointment) => (
              <div className="row-actions">
                {can('appointments.check-in') && a.allowed_transitions.includes('checked_in') && (
                  <span title={online ? undefined : t('presence.offlineBanner')}>
                    <Button icon="pi pi-check" size="small" label={t('cards.checkIn')} disabled={!online} loading={busyId === a.id} onClick={() => void checkIn(a)} />
                  </span>
                )}
                {can('appointments.update') &&
                  a.allowed_transitions
                    .filter((s) => s !== 'checked_in')
                    .map((next) => (
                      <Button
                        key={next}
                        size="small"
                        text
                        label={t(`doctor.appointments.to.${snakeToCamel(next)}`)}
                        loading={busyId === a.id}
                        onClick={() => void setStatus(a, next)}
                      />
                    ))}
                {can('appointments.update') && a.status === 'scheduled' && (
                  <Button icon="pi pi-pencil" text rounded size="small" aria-label={t('common.edit')} onClick={() => openEdit(a)} />
                )}
                {can('appointments.delete') && (
                  <Button icon="pi pi-trash" text rounded size="small" severity="danger" aria-label={t('common.delete')} onClick={() => confirmDelete(a)} />
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
        header={editing ? t('doctor.appointments.edit') : t('doctor.appointments.new')}
        style={{ width: 'min(640px, 95vw)' }}
        footer={
          <>
            <Button label={t('common.cancel')} text onClick={() => setDialogOpen(false)} />
            <Button label={t('common.save')} type="submit" form="appointment-form" loading={saving} />
          </>
        }
      >
        <form id="appointment-form" className="dialog-form" onSubmit={save} noValidate>
          <div className="field field--full">
            <label htmlFor="patient">{t('nav.patients')}</label>
            <AutoComplete
              inputId="patient"
              value={form.patient}
              suggestions={patientSuggestions}
              completeMethod={searchPatients}
              field="full_name"
              forceSelection
              dropdown
              invalid={!!errors.first('patient_id')}
              onChange={(e) => patch({ patient: (e.value as Patient | string | null) ?? null })}
              className="p-fluid-field"
              inputClassName="p-fluid-field"
            />
            {errors.first('patient_id') && <small className="field-error">{errors.first('patient_id')}</small>}
          </div>
          <div className="field">
            <label htmlFor="scheduled_at">
              {t('doctor.appointments.when')} <span className="muted">({timezone})</span>
            </label>
            <Calendar
              inputId="scheduled_at"
              value={form.scheduledAt}
              onChange={(e) => patch({ scheduledAt: (e.value as Date | null) ?? null })}
              showTime
              hourFormat="24"
              stepMinute={5}
              dateFormat="yy-mm-dd"
              invalid={!!errors.first('scheduled_at')}
              className="p-fluid-field"
            />
            {errors.first('scheduled_at') && <small className="field-error">{errors.first('scheduled_at')}</small>}
          </div>
          <div className="field">
            <label htmlFor="duration">{t('doctor.appointments.duration')}</label>
            <InputNumber
              inputId="duration"
              value={form.duration}
              onValueChange={(e) => patch({ duration: e.value ?? 30 })}
              min={5}
              max={480}
              step={5}
              showButtons
              suffix=" min"
              className="p-fluid-field"
            />
          </div>
          <div className="field field--full">
            <label htmlFor="reason">{t('doctor.appointments.reason')}</label>
            <Dropdown
              inputId="reason"
              value={form.reason}
              options={reasonOptions}
              optionLabel="label"
              optionValue="value"
              invalid={!!errors.first('reason')}
              onChange={(e) => patch({ reason: e.value as AppointmentReason })}
              className="p-fluid-field"
            />
            {errors.first('reason') && <small className="field-error">{errors.first('reason')}</small>}
          </div>
          <div className="field field--full">
            <label htmlFor="notes">{t('common.notes')}</label>
            <InputTextarea id="notes" value={form.notes} onChange={(e) => patch({ notes: e.target.value })} rows={3} autoResize className="p-fluid-field" />
          </div>
        </form>
      </Dialog>
    </main>
  )
}
