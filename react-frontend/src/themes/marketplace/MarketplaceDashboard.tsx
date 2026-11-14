import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from 'primereact/button'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { Skeleton } from 'primereact/skeleton'
import { Tag } from 'primereact/tag'
import BaseCard from '../../components/shared/cards/BaseCard'
import StatCard from '../../components/shared/cards/StatCard'
import PageHeader from '../../components/shared/PageHeader'
import StatusTag from '../../components/shared/StatusTag'
import { marketplaceApi } from '../../api'
import { useT } from '../../i18n'
import { useAccessStore } from '../../stores'
import { useNotify } from '../../hooks/useNotify'
import { useFormatters } from '../../hooks/useFormatters'
import type { MarketplaceDashboard as DashboardData, Order, StoreProduct } from '../../types/models'
import styles from './MarketplaceDashboard.module.css'

export default function MarketplaceDashboard() {
  const { t } = useT()
  const navigate = useNavigate()
  const notify = useNotify()
  const fmt = useFormatters()
  const can = useAccessStore((s) => s.can)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)

  useEffect(() => {
    marketplaceApi
      .dashboard()
      .then(setDashboard)
      .catch((err) => notify.error(err))
  }, [notify])

  const s = dashboard?.stats
  const stats = s
    ? [
        { label: t('marketplace.dashboard.stats.products'), value: s.products, caption: t('marketplace.dashboard.stats.productsCaption', { count: s.active_products }), icon: 'pi pi-box' },
        { label: t('marketplace.dashboard.stats.units'), value: fmt.number(s.units_in_stock), caption: t('marketplace.dashboard.stats.lowStockCaption', { count: s.low_stock }), icon: 'pi pi-warehouse' },
        { label: t('marketplace.dashboard.stats.ordersToday'), value: s.orders_today, caption: t('marketplace.dashboard.stats.pendingCaption', { count: s.pending_orders }), icon: 'pi pi-shopping-cart' },
        // Revenue is reported in the shop's default currency
        { label: t('marketplace.dashboard.stats.revenue'), value: fmt.money(s.revenue_cents, 'EUR'), caption: t('marketplace.dashboard.stats.revenueCaption'), icon: 'pi pi-wallet' }
      ]
    : []

  return (
    <main className="page">
      <PageHeader
        eyebrow={t('marketplace.dashboard.eyebrow')}
        title={t('marketplace.dashboard.title')}
        subtitle={t('marketplace.dashboard.subtitle')}
        actions={
          (can('orders.create') || can('products.create')) && (
            <>
              {can('orders.create') && (
                <Button label={t('marketplace.orders.new')} icon="pi pi-shopping-cart" outlined onClick={() => void navigate('/market/orders?new=1')} />
              )}
              {can('products.create') && (
                <Button label={t('marketplace.dashboard.newProduct')} icon="pi pi-plus" onClick={() => void navigate('/market/products?new=1')} />
              )}
            </>
          )
        }
      />

      <section className="card-grid card-grid--stats" aria-label={t('home.sections.glance')}>
        {dashboard
          ? stats.map((stat) => <StatCard key={stat.label} {...stat} />)
          : [1, 2, 3, 4].map((n) => <Skeleton key={n} height="9rem" borderRadius="18px" />)}
      </section>

      <section className={`card-grid ${styles.twoCol}`}>
        {can('products.view') && (
          <BaseCard header={<strong>{t('marketplace.dashboard.lowStock')}</strong>}>
            <DataTable value={dashboard?.low_stock ?? []} size="small" emptyMessage={t('marketplace.dashboard.allStocked')}>
              <Column field="name" header={t('marketplace.products.name')} />
              <Column field="sku" header="SKU" />
              <Column
                header={t('marketplace.products.stock')}
                body={(p: StoreProduct) => <Tag value={String(p.stock)} severity={p.stock === 0 ? 'danger' : 'warning'} rounded />}
              />
            </DataTable>
          </BaseCard>
        )}
        {can('orders.view') && (
          <BaseCard header={<strong>{t('marketplace.dashboard.recentOrders')}</strong>}>
            <DataTable value={dashboard?.recent_orders ?? []} size="small" emptyMessage={t('common.noResults')}>
              <Column field="number" header={t('marketplace.orders.number')} />
              <Column field="customer_name" header={t('marketplace.orders.customer')} />
              <Column header={t('marketplace.orders.total')} body={(o: Order) => fmt.money(o.total_cents, o.currency)} />
              <Column header={t('common.status')} body={(o: Order) => <StatusTag kind="order" status={o.status} />} />
            </DataTable>
          </BaseCard>
        )}
      </section>
    </main>
  )
}
