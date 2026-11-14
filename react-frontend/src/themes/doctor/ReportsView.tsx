import { useCallback, useEffect, useState } from 'react'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { SelectButton } from 'primereact/selectbutton'
import BaseCard from '../../components/shared/cards/BaseCard'
import StatCard from '../../components/shared/cards/StatCard'
import PageHeader from '../../components/shared/PageHeader'
import StatusTag from '../../components/shared/StatusTag'
import { doctorApi } from '../../api'
import { useT } from '../../i18n'
import { useNotify } from '../../hooks/useNotify'
import { selectIntl, usePreferencesStore } from '../../stores/preferences'
import { snakeToCamel } from '../../helpers/text'
import type { ReportSummary } from '../../types/models'

type Row = { label: string; total: number }

export default function ReportsView() {
  const { t } = useT()
  const notify = useNotify()
  const intl = usePreferencesStore(selectIntl)
  const [days, setDays] = useState(30)
  const [summary, setSummary] = useState<ReportSummary | null>(null)
  const [loading, setLoading] = useState(false)

  const share = (count: number) =>
    summary?.total ? new Intl.NumberFormat(intl, { style: 'percent', maximumFractionDigits: 0 }).format(count / summary.total) : '—'

  const load = useCallback(
    async (period: number) => {
      setLoading(true)
      try {
        setSummary(await doctorApi.reportSummary(period))
      } catch (err) {
        notify.error(err)
      } finally {
        setLoading(false)
      }
    },
    [notify]
  )

  useEffect(() => {
    void load(days)
  }, [load, days])

  return (
    <main className="page">
      <PageHeader
        eyebrow={t('nav.reports')}
        title={t('doctor.reports.title')}
        subtitle={t('doctor.reports.subtitle', { days })}
        actions={<SelectButton value={days} options={[7, 30, 90]} allowEmpty={false} onChange={(e) => e.value && setDays(e.value as number)} />}
      />

      <section className="card-grid card-grid--stats">
        <StatCard label={t('doctor.reports.total')} value={summary?.total ?? '—'} caption={t('doctor.reports.totalCaption', { days })} icon="pi pi-calendar" />
      </section>

      <section className="card-grid">
        <BaseCard header={<strong>{t('doctor.reports.byStatus')}</strong>}>
          <DataTable value={(summary?.by_status ?? []) as Row[]} loading={loading} size="small" emptyMessage={t('common.noResults')}>
            <Column header={t('common.status')} body={(row: Row) => <StatusTag kind="appointment" status={row.label} />} />
            <Column field="total" header={t('doctor.reports.count')} />
            <Column header={t('doctor.reports.share')} body={(row: Row) => share(row.total)} />
          </DataTable>
        </BaseCard>
        <BaseCard header={<strong>{t('doctor.reports.byReason')}</strong>}>
          <DataTable value={(summary?.by_reason ?? []) as Row[]} loading={loading} size="small" emptyMessage={t('common.noResults')}>
            <Column header={t('doctor.appointments.reason')} body={(row: Row) => t(`doctor.reasons.${snakeToCamel(row.label)}`)} />
            <Column field="total" header={t('doctor.reports.count')} />
            <Column header={t('doctor.reports.share')} body={(row: Row) => share(row.total)} />
          </DataTable>
        </BaseCard>
      </section>
    </main>
  )
}
