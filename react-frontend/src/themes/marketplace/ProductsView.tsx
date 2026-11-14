import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Button } from 'primereact/button'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { Dialog } from 'primereact/dialog'
import { Dropdown } from 'primereact/dropdown'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputNumber } from 'primereact/inputnumber'
import { InputSwitch } from 'primereact/inputswitch'
import { InputText } from 'primereact/inputtext'
import { InputTextarea } from 'primereact/inputtextarea'
import { Tag } from 'primereact/tag'
import BaseCard from '../../components/shared/cards/BaseCard'
import PageHeader from '../../components/shared/PageHeader'
import { productsApi } from '../../api'
import { confirmDanger } from '../../hooks/confirmDanger'
import { useFormErrors } from '../../hooks/useFormErrors'
import { useFormatters } from '../../hooks/useFormatters'
import { useNotify } from '../../hooks/useNotify'
import { usePaginatedList } from '../../hooks/usePaginatedList'
import { toCents } from '../../helpers/money'
import { useT } from '../../i18n'
import { useAccessStore, usePreferencesStore } from '../../stores'
import { selectIntl } from '../../stores/preferences'
import type { StoreProduct } from '../../types/models'
import styles from './ProductsView.module.css'

interface ProductForm {
  sku: string
  name: string
  price: number | null
  currency: string
  stock: number | null
  category: string
  description: string
  is_active: boolean
}

const emptyForm = (): ProductForm => ({ sku: '', name: '', price: 0, currency: 'EUR', stock: 0, category: '', description: '', is_active: true })

export default function ProductsView() {
  const { t } = useT()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const notify = useNotify()
  const errors = useFormErrors()
  const fmt = useFormatters()
  const intl = usePreferencesStore(selectIntl)
  const can = useAccessStore((s) => s.can)
  const list = usePaginatedList(productsApi.list, { search: '' })

  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(searchTimer.current), [])

  function debouncedSearch(value: string) {
    list.setFilters({ search: value })
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => void list.search(), 300)
  }

  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<StoreProduct | null>(null)
  const [form, setForm] = useState<ProductForm>(emptyForm)
  const patch = (changes: Partial<ProductForm>) => setForm((current) => ({ ...current, ...changes }))

  function openCreate() {
    setEditing(null)
    errors.clear()
    setForm(emptyForm())
    setDialogOpen(true)
  }

  function openEdit(product: StoreProduct) {
    setEditing(product)
    errors.clear()
    setForm({
      sku: product.sku,
      name: product.name,
      price: product.price_cents / 100,
      currency: product.currency,
      stock: product.stock,
      category: product.category ?? '',
      description: product.description ?? '',
      is_active: product.is_active
    })
    setDialogOpen(true)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    errors.clear()
    const payload = {
      sku: form.sku,
      name: form.name,
      price_cents: toCents(form.price),
      currency: form.currency,
      stock: form.stock ?? 0,
      category: form.category || null,
      description: form.description || null,
      is_active: form.is_active
    }
    try {
      if (editing) await productsApi.update(editing.id, payload)
      else await productsApi.create(payload)
      notify.success(t('common.saved'))
      setDialogOpen(false)
      await list.load()
    } catch (err) {
      if (!errors.capture(err)) notify.error(err)
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(product: StoreProduct) {
    confirmDanger({
      header: t('common.confirmDeleteTitle'),
      message: t('marketplace.products.confirmDelete', { name: product.name }),
      rejectLabel: t('common.cancel'),
      acceptLabel: t('common.delete'),
      accept: async () => {
        try {
          await productsApi.remove(product.id)
          notify.success(t('common.deleted'))
          await list.load()
        } catch (err) {
          notify.error(err)
        }
      }
    })
  }

  // Deep link from the dashboard's "New product" button
  const deepLink = useRef(params.get('new') === '1')
  const { load } = list
  useEffect(() => {
    void load().then(() => {
      if (!deepLink.current) return
      deepLink.current = false
      openCreate()
      void navigate('/market/products', { replace: true })
    })
  }, [load, navigate])

  return (
    <main className="page">
      <PageHeader
        eyebrow={t('nav.products')}
        title={t('marketplace.products.title')}
        subtitle={t('marketplace.products.subtitle')}
        actions={can('products.create') && <Button label={t('marketplace.dashboard.newProduct')} icon="pi pi-plus" onClick={openCreate} />}
      />

      <BaseCard>
        <div className="table-toolbar">
          <IconField iconPosition="left">
            <InputIcon className="pi pi-search" />
            <InputText value={list.filters.search ?? ''} placeholder={t('marketplace.products.search')} onChange={(e) => debouncedSearch(e.target.value)} />
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
          <Column field="sku" header="SKU" />
          <Column field="name" header={t('marketplace.products.name')} />
          <Column header={t('marketplace.products.category')} body={(p: StoreProduct) => p.category ?? '—'} />
          <Column header={t('marketplace.products.price')} body={(p: StoreProduct) => fmt.money(p.price_cents, p.currency)} />
          <Column
            header={t('marketplace.products.stock')}
            body={(p: StoreProduct) => <Tag value={String(p.stock)} severity={p.stock === 0 ? 'danger' : p.stock < 10 ? 'warning' : 'success'} rounded />}
          />
          <Column
            header={t('common.status')}
            body={(p: StoreProduct) => <Tag value={p.is_active ? t('common.active') : t('common.inactive')} severity={p.is_active ? 'success' : 'secondary'} rounded />}
          />
          <Column
            header={t('common.actions')}
            headerClassName="row-actions"
            body={(p: StoreProduct) => (
              <div className="row-actions">
                {can('products.update') && <Button icon="pi pi-pencil" text rounded size="small" aria-label={t('common.edit')} onClick={() => openEdit(p)} />}
                {can('products.delete') && (
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
        header={editing ? t('marketplace.products.edit') : t('marketplace.dashboard.newProduct')}
        style={{ width: 'min(640px, 95vw)' }}
        footer={
          <>
            <Button label={t('common.cancel')} text onClick={() => setDialogOpen(false)} />
            <Button label={t('common.save')} type="submit" form="product-form" loading={saving} />
          </>
        }
      >
        <form id="product-form" className="dialog-form" onSubmit={save} noValidate>
          <div className="field">
            <label htmlFor="sku">SKU</label>
            <InputText id="sku" value={form.sku} onChange={(e) => patch({ sku: e.target.value })} invalid={!!errors.first('sku')} className="p-fluid-field" />
            {errors.first('sku') && <small className="field-error">{errors.first('sku')}</small>}
          </div>
          <div className="field">
            <label htmlFor="name">{t('marketplace.products.name')}</label>
            <InputText id="name" value={form.name} onChange={(e) => patch({ name: e.target.value })} invalid={!!errors.first('name')} className="p-fluid-field" />
            {errors.first('name') && <small className="field-error">{errors.first('name')}</small>}
          </div>
          <div className="field">
            <label htmlFor="price">{t('marketplace.products.price')}</label>
            <InputNumber
              inputId="price"
              value={form.price}
              onValueChange={(e) => patch({ price: e.value ?? null })}
              mode="currency"
              currency={form.currency}
              locale={intl}
              min={0}
              invalid={!!errors.first('price_cents')}
              className="p-fluid-field"
            />
            {errors.first('price_cents') && <small className="field-error">{errors.first('price_cents')}</small>}
          </div>
          <div className="field">
            <label htmlFor="currency">{t('marketplace.products.currency')}</label>
            <Dropdown inputId="currency" value={form.currency} options={['EUR', 'USD', 'GBP']} onChange={(e) => patch({ currency: e.value as string })} className="p-fluid-field" />
          </div>
          <div className="field">
            <label htmlFor="stock">{t('marketplace.products.stock')}</label>
            <InputNumber inputId="stock" value={form.stock} onValueChange={(e) => patch({ stock: e.value ?? null })} min={0} showButtons className="p-fluid-field" />
          </div>
          <div className="field">
            <label htmlFor="category">{t('marketplace.products.category')}</label>
            <InputText id="category" value={form.category} onChange={(e) => patch({ category: e.target.value })} className="p-fluid-field" />
          </div>
          <div className="field field--full">
            <label htmlFor="description">{t('marketplace.products.description')}</label>
            <InputTextarea id="description" value={form.description} onChange={(e) => patch({ description: e.target.value })} rows={3} autoResize className="p-fluid-field" />
          </div>
          <div className={`field field--full ${styles.toggleField}`}>
            <InputSwitch inputId="is_active" checked={form.is_active} onChange={(e) => patch({ is_active: !!e.value })} />
            <label htmlFor="is_active">{t('common.active')}</label>
          </div>
        </form>
      </Dialog>
    </main>
  )
}
