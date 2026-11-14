import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Button, type ButtonProps } from 'primereact/button'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { Dialog } from 'primereact/dialog'
import { Dropdown } from 'primereact/dropdown'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputNumber } from 'primereact/inputnumber'
import { InputText } from 'primereact/inputtext'
import { confirmDialog } from 'primereact/confirmdialog'
import BaseCard from '../../components/shared/cards/BaseCard'
import PageHeader from '../../components/shared/PageHeader'
import StatusTag from '../../components/shared/StatusTag'
import { ordersApi, productsApi } from '../../api'
import { useFormErrors } from '../../hooks/useFormErrors'
import { useFormatters } from '../../hooks/useFormatters'
import { useNotify } from '../../hooks/useNotify'
import { usePaginatedList } from '../../hooks/usePaginatedList'
import { useT } from '../../i18n'
import { useAccessStore } from '../../stores'
import type { Order, OrderStatus, StoreProduct } from '../../types/models'
import styles from './OrdersView.module.css'

const STATUSES: OrderStatus[] = ['pending', 'paid', 'shipped', 'delivered', 'cancelled']

/** Look of each next-status action: forward steps are filled, cancelling is a quiet outline */
const TRANSITION_STYLE: Record<OrderStatus, { icon: string; severity: NonNullable<ButtonProps['severity']> }> = {
  pending: { icon: 'pi pi-clock', severity: 'secondary' },
  paid: { icon: 'pi pi-wallet', severity: 'success' },
  shipped: { icon: 'pi pi-truck', severity: 'info' },
  delivered: { icon: 'pi pi-check-circle', severity: 'success' },
  cancelled: { icon: 'pi pi-times', severity: 'danger' }
}

interface Line {
  product_id: number | null
  quantity: number | null
}

export default function OrdersView() {
  const { t } = useT()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const notify = useNotify()
  const errors = useFormErrors()
  const fmt = useFormatters()
  const can = useAccessStore((s) => s.can)
  const list = usePaginatedList(ordersApi.list, { search: '', status: '' as OrderStatus | '' })

  const statusOptions = STATUSES.map((s) => ({ value: s, label: t(`status.order.${s}`) }))

  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(searchTimer.current), [])

  function debouncedSearch(value: string) {
    list.setFilters({ search: value })
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => void list.search(), 300)
  }

  /** `${orderId}:${status}` of the action in flight, so only that button spins */
  const [busyKey, setBusyKey] = useState<string | null>(null)

  async function setStatus(order: Order, status: OrderStatus) {
    setBusyKey(`${order.id}:${status}`)
    try {
      await ordersApi.setStatus(order.id, status)
      await list.load()
    } catch (err) {
      notify.error(err)
    } finally {
      setBusyKey(null)
    }
  }

  /** Cancelling cannot be undone, so it asks first */
  function confirmCancel(order: Order) {
    confirmDialog({
      header: t('common.confirmDeleteTitle'),
      message: t('marketplace.orders.confirmCancel', { number: order.number }),
      icon: 'pi pi-exclamation-triangle',
      rejectLabel: t('common.cancel'),
      acceptLabel: t('marketplace.orders.to.cancelled'),
      acceptClassName: 'p-button-danger',
      rejectClassName: 'p-button-text',
      defaultFocus: 'reject',
      accept: () => void setStatus(order, 'cancelled')
    })
  }

  // --- new order dialog ------------------------------------------------------
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [products, setProducts] = useState<StoreProduct[]>([])
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [items, setItems] = useState<Line[]>([{ product_id: null, quantity: 1 }])

  const updateLine = (index: number, changes: Partial<Line>) => setItems((lines) => lines.map((line, i) => (i === index ? { ...line, ...changes } : line)))

  // Validation errors for any line (items.0.product_id, ...) or the whole list
  const itemsError = Object.entries(errors.errors).find(([key]) => key === 'items' || key.startsWith('items.'))?.[1]?.[0]

  const pricedLines = items
    .map((line) => ({ product: products.find((p) => p.id === line.product_id), quantity: line.quantity ?? 0 }))
    .filter((l): l is { product: StoreProduct; quantity: number } => !!l.product)
  const estimatedTotal = pricedLines.length
    ? fmt.money(
        pricedLines.reduce((sum, l) => sum + l.product.price_cents * l.quantity, 0),
        pricedLines[0].product.currency
      )
    : null

  async function openCreate() {
    errors.clear()
    setCustomerName('')
    setCustomerEmail('')
    setItems([{ product_id: null, quantity: 1 }])
    setDialogOpen(true)
    try {
      setProducts((await productsApi.list({ active: 1, per_page: 100 })).data)
    } catch (err) {
      notify.error(err)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    errors.clear()
    try {
      const order = await ordersApi.create({
        customer_name: customerName,
        customer_email: customerEmail || null,
        items: items.filter((line) => line.product_id !== null).map((line) => ({ product_id: line.product_id as number, quantity: line.quantity ?? 1 }))
      })
      notify.success(t('marketplace.orders.placed', { number: order.number }))
      setDialogOpen(false)
      await list.load()
    } catch (err) {
      if (!errors.capture(err)) notify.error(err)
    } finally {
      setSaving(false)
    }
  }

  // Deep link from the dashboard's "New order" button
  const deepLink = useRef(params.get('new') === '1')
  const { load } = list
  useEffect(() => {
    void load().then(() => {
      if (!deepLink.current) return
      deepLink.current = false
      void openCreate()
      void navigate('/market/orders', { replace: true })
    })
    // openCreate only sets state and fetches the product list
  }, [load, navigate])

  return (
    <main className="page">
      <PageHeader
        eyebrow={t('nav.orders')}
        title={t('marketplace.orders.title')}
        subtitle={t('marketplace.orders.subtitle')}
        actions={can('orders.create') && <Button label={t('marketplace.orders.new')} icon="pi pi-plus" onClick={() => void openCreate()} />}
      />

      <BaseCard>
        <div className="table-toolbar">
          <div className="table-toolbar__filters">
            <IconField iconPosition="left">
              <InputIcon className="pi pi-search" />
              <InputText value={list.filters.search ?? ''} placeholder={t('marketplace.orders.search')} onChange={(e) => debouncedSearch(e.target.value)} />
            </IconField>
            <Dropdown
              value={list.filters.status || null}
              options={statusOptions}
              optionLabel="label"
              optionValue="value"
              showClear
              placeholder={t('doctor.appointments.anyStatus')}
              onChange={(e) => {
                list.setFilters({ status: (e.value as OrderStatus | null) ?? '' })
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
          className={styles.table}
        >
          <Column field="number" header={t('marketplace.orders.number')} />
          <Column header={t('marketplace.orders.placedAt')} body={(o: Order) => fmt.dateTime(o.created_at)} />
          <Column field="customer_name" header={t('marketplace.orders.customer')} />
          <Column field="items_count" header={t('marketplace.orders.items')} />
          <Column header={t('marketplace.orders.total')} body={(o: Order) => fmt.money(o.total_cents, o.currency)} />
          <Column header={t('common.status')} body={(o: Order) => <StatusTag kind="order" status={o.status} />} />
          <Column
            header={t('common.actions')}
            headerClassName={styles.colCenter}
            bodyClassName={styles.colCenter}
            body={(o: Order) =>
              can('orders.update') && o.allowed_transitions.length ? (
                <div className={styles.actions}>
                  {o.allowed_transitions.map((next) => (
                    <Button
                      key={next}
                      size="small"
                      rounded
                      outlined={next === 'cancelled'}
                      severity={TRANSITION_STYLE[next].severity}
                      icon={TRANSITION_STYLE[next].icon}
                      label={t(`marketplace.orders.to.${next}`)}
                      loading={busyKey === `${o.id}:${next}`}
                      disabled={busyKey !== null && busyKey.startsWith(`${o.id}:`)}
                      className={styles.action}
                      onClick={() => (next === 'cancelled' ? confirmCancel(o) : void setStatus(o, next))}
                    />
                  ))}
                </div>
              ) : (
                <span className="muted" aria-hidden="true">
                  —
                </span>
              )
            }
          />
        </DataTable>
      </BaseCard>

      <Dialog
        visible={dialogOpen}
        onHide={() => setDialogOpen(false)}
        modal
        header={t('marketplace.orders.new')}
        style={{ width: 'min(720px, 95vw)' }}
        footer={
          <>
            <Button label={t('common.cancel')} text onClick={() => setDialogOpen(false)} />
            <Button label={t('marketplace.orders.place')} type="submit" form="order-form" loading={saving} />
          </>
        }
      >
        <form id="order-form" className="dialog-form" onSubmit={save} noValidate>
          <div className="field">
            <label htmlFor="customer_name">{t('marketplace.orders.customer')}</label>
            <InputText id="customer_name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} invalid={!!errors.first('customer_name')} className="p-fluid-field" />
            {errors.first('customer_name') && <small className="field-error">{errors.first('customer_name')}</small>}
          </div>
          <div className="field">
            <label htmlFor="customer_email">{t('auth.email')}</label>
            <InputText
              id="customer_email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              type="email"
              invalid={!!errors.first('customer_email')}
              className="p-fluid-field"
            />
            {errors.first('customer_email') && <small className="field-error">{errors.first('customer_email')}</small>}
          </div>

          <div className="field field--full">
            <label>{t('marketplace.orders.items')}</label>
            {items.map((line, index) => (
              <div key={index} className={styles.line}>
                <Dropdown
                  value={line.product_id}
                  options={products}
                  optionLabel="name"
                  optionValue="id"
                  filter
                  optionDisabled={(p: StoreProduct) => p.stock === 0}
                  placeholder={t('marketplace.orders.pickProduct')}
                  className={styles.lineProduct}
                  itemTemplate={(option: StoreProduct) => (
                    <>
                      <span>{option.name}</span>
                      <span className={`muted ${styles.lineMeta}`}>
                        {fmt.money(option.price_cents, option.currency)} · {t('marketplace.orders.inStock', { count: option.stock })}
                      </span>
                    </>
                  )}
                  onChange={(e) => updateLine(index, { product_id: (e.value as number | null) ?? null })}
                />
                <InputNumber
                  value={line.quantity}
                  onValueChange={(e) => updateLine(index, { quantity: e.value ?? null })}
                  min={1}
                  max={1000}
                  showButtons
                  className={styles.lineQty}
                  inputClassName={styles.lineQtyInput}
                />
                <Button
                  type="button"
                  icon="pi pi-times"
                  text
                  rounded
                  severity="secondary"
                  aria-label={t('common.delete')}
                  disabled={items.length === 1}
                  onClick={() => setItems((lines) => lines.filter((_, i) => i !== index))}
                />
              </div>
            ))}
            {itemsError && <small className="field-error">{itemsError}</small>}
            <div className={styles.footer}>
              <Button
                type="button"
                label={t('marketplace.orders.addLine')}
                icon="pi pi-plus"
                text
                size="small"
                onClick={() => setItems((lines) => [...lines, { product_id: null, quantity: 1 }])}
              />
              {estimatedTotal !== null && (
                <strong>
                  {t('marketplace.orders.total')}: {estimatedTotal}
                </strong>
              )}
            </div>
          </div>
        </form>
      </Dialog>
    </main>
  )
}
