import { useEffect, useState } from 'react'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import BaseCard from '../../components/shared/cards/BaseCard'
import PageHeader from '../../components/shared/PageHeader'
import { marketplaceApi } from '../../api'
import { useT } from '../../i18n'
import { useNotify } from '../../hooks/useNotify'
import { useFormatters } from '../../hooks/useFormatters'
import type { TopProduct } from '../../types/models'

export default function InsightsView() {
  const { t } = useT()
  const notify = useNotify()
  const fmt = useFormatters()
  const [rows, setRows] = useState<TopProduct[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    marketplaceApi
      .topProducts()
      .then(setRows)
      .catch((err) => notify.error(err))
      .finally(() => setLoading(false))
  }, [notify])

  return (
    <main className="page">
      <PageHeader eyebrow={t('nav.marketing')} title={t('marketplace.insights.title')} subtitle={t('marketplace.insights.subtitle')} />

      <BaseCard header={<strong>{t('marketplace.insights.topProducts')}</strong>}>
        <DataTable value={rows} loading={loading} size="small" emptyMessage={t('common.noResults')}>
          <Column header="#" body={(_row: TopProduct, options) => options.rowIndex + 1} />
          <Column field="name" header={t('marketplace.products.name')} />
          <Column header={t('marketplace.insights.unitsSold')} body={(row: TopProduct) => fmt.number(row.units)} />
          <Column header={t('marketplace.insights.revenue')} body={(row: TopProduct) => fmt.money(row.revenue_cents, 'EUR')} />
        </DataTable>
      </BaseCard>
    </main>
  )
}
