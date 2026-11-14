import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from 'primereact/button'
import { Message } from 'primereact/message'
import { Skeleton } from 'primereact/skeleton'
import BaseCard from '../../components/shared/cards/BaseCard'
import StatCard from '../../components/shared/cards/StatCard'
import PageHeader from '../../components/shared/PageHeader'
import VisitorCard from './VisitorCard'
import PresenceToggle from './PresenceToggle'
import { ApiError, appointmentsApi, doctorApi } from '../../api'
import { useT } from '../../i18n'
import { useAccessStore, usePresenceStore } from '../../stores'
import { selectOnline } from '../../stores/presence'
import { useNotify } from '../../hooks/useNotify'
import { useFormatters } from '../../hooks/useFormatters'
import { snakeToCamel } from '../../helpers/text'
import type { Visitor } from '../../types/app'
import type { Appointment, DoctorDashboard as DashboardData } from '../../types/models'

const ACTIVE_STATUSES: Appointment['status'][] = ['scheduled', 'checked_in', 'in_progress']

export default function DoctorDashboard() {
  const { t } = useT()
  const navigate = useNavigate()
  const notify = useNotify()
  const fmt = useFormatters()
  const can = useAccessStore((s) => s.can)
  const online = usePresenceStore(selectOnline)

  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [checkingIn, setCheckingIn] = useState<number | null>(null)
  const canCheckIn = can('appointments.check-in')

  /** Today's active appointments as visitor cards */
  const queue: Visitor[] = (dashboard?.queue ?? [])
    .filter((a) => ACTIVE_STATUSES.includes(a.status))
    .map((a) => ({
      id: a.id,
      name: a.patient?.full_name ?? '—',
      time: fmt.time(a.scheduled_at),
      reason: snakeToCamel(a.reason),
      status: a.status === 'scheduled' ? 'waiting' : 'checkedIn'
    }))

  const s = dashboard?.stats
  const stats = s
    ? [
        { label: t('doctor.dashboard.stats.total'), value: s.scheduled, caption: t('doctor.dashboard.stats.totalCaption'), icon: 'pi pi-calendar' },
        { label: t('doctor.dashboard.stats.waiting'), value: s.waiting, caption: t('doctor.dashboard.stats.waitingCaption'), icon: 'pi pi-hourglass' },
        { label: t('doctor.dashboard.stats.checkedIn'), value: s.checked_in, caption: t('doctor.dashboard.stats.checkedInCaption'), icon: 'pi pi-check-circle' },
        { label: t('doctor.dashboard.stats.staffOnline'), value: s.staff_online, caption: t('doctor.dashboard.stats.staffOnlineCaption'), icon: 'pi pi-wifi' }
      ]
    : []

  const load = useCallback(async () => {
    try {
      setDashboard(await doctorApi.dashboard())
    } catch (err) {
      notify.error(err)
    }
  }, [notify])

  useEffect(() => {
    void load()
  }, [load])

  async function checkIn(visitor: Visitor) {
    setCheckingIn(visitor.id)
    try {
      await appointmentsApi.checkIn(visitor.id)
      notify.success(t('doctor.dashboard.checkedInToast', { name: visitor.name }), t('cards.checkedIn'))
      await load()
    } catch (err) {
      // The server is the authority on presence: resync if it says we're offline
      if (err instanceof ApiError && err.code === 'user_offline') await usePresenceStore.getState().refresh().catch(() => {})
      notify.error(err)
    } finally {
      setCheckingIn(null)
    }
  }

  function showDetails(visitor: Visitor) {
    notify.info(`${visitor.time} • ${t(`doctor.reasons.${visitor.reason}`)}`, visitor.name)
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow={t('doctor.dashboard.eyebrow')}
        title={t('doctor.dashboard.title')}
        subtitle={t('doctor.dashboard.subtitle')}
        actions={
          (can('presence.toggle') || can('appointments.create')) && (
            <>
              {can('presence.toggle') && <PresenceToggle />}
              {can('appointments.create') && (
                <Button label={t('doctor.dashboard.newVisit')} icon="pi pi-plus" onClick={() => void navigate('/clinic/appointments?new=1')} />
              )}
            </>
          )
        }
      />

      {canCheckIn && !online && <Message severity="warn" icon="pi pi-wifi" text={t('presence.offlineBanner')} className="page-message" />}

      <section className="card-grid card-grid--stats" aria-label={t('home.sections.glance')}>
        {dashboard
          ? stats.map((stat) => <StatCard key={stat.label} {...stat} />)
          : [1, 2, 3, 4].map((n) => <Skeleton key={n} height="9rem" borderRadius="18px" />)}
      </section>

      <section>
        <div className="section-head">
          <h2>{t('doctor.dashboard.queue')}</h2>
          <p>{t('doctor.dashboard.queueSubtitle')}</p>
        </div>
        {queue.length > 0 ? (
          <div className="card-grid">
            {queue.map((v) => (
              <VisitorCard
                key={v.id}
                visitor={v}
                checkInDisabled={!canCheckIn || !online}
                checkInHint={canCheckIn ? t('presence.offlineBanner') : t('errors.forbidden')}
                loading={checkingIn === v.id}
                onCheckIn={checkIn}
                onDetails={showDetails}
              />
            ))}
          </div>
        ) : (
          dashboard && (
            <BaseCard padding="lg">
              <p className="muted">{t('doctor.dashboard.emptyQueue')}</p>
            </BaseCard>
          )
        )}
      </section>
    </main>
  )
}
