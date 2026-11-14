import { Button } from 'primereact/button'
import { Tag } from 'primereact/tag'
import BaseCard from '../../components/shared/cards/BaseCard'
import { useT } from '../../i18n'
import type { Product } from '../../types/app'
import styles from './ProductCard.module.css'

const LOW_STOCK_THRESHOLD = 10

export default function ProductCard({ product, onAdd }: { product: Product; onAdd: (product: Product) => void }) {
  const { t, locale } = useT()

  const price = new Intl.NumberFormat(locale === 'el' ? 'el-GR' : 'en-US', { style: 'currency', currency: 'USD' }).format(product.price)

  const stockLabel =
    product.stock === 0 ? t('cards.soldOut') : product.stock < LOW_STOCK_THRESHOLD ? t('cards.lowStock', { count: product.stock }) : t('cards.inStock')
  const stockSeverity = product.stock === 0 ? 'danger' : product.stock < LOW_STOCK_THRESHOLD ? 'warning' : 'success'

  return (
    <BaseCard
      padding="none"
      interactive
      footer={
        <>
          <span className={styles.price}>{price}</span>
          <Button className={styles.add} label={t('cards.addToCart')} icon="pi pi-shopping-cart" size="small" disabled={product.stock === 0} onClick={() => onAdd(product)} />
        </>
      }
    >
      <div className={styles.media}>
        <i className={product.icon} aria-hidden="true"></i>
        <Tag className={styles.stock} value={stockLabel} severity={stockSeverity} rounded />
      </div>

      <div className={styles.content}>
        <span className={styles.category}>{t(`marketplace.categories.${product.category}`)}</span>
        <h3 className={styles.name}>{product.name}</h3>
        <div className={styles.rating} aria-label={t('cards.rating', { rating: product.rating })}>
          {[1, 2, 3, 4, 5].map((star) => (
            <i key={star} className={star <= product.rating ? 'pi pi-star-fill' : 'pi pi-star'} aria-hidden="true"></i>
          ))}
        </div>
      </div>
    </BaseCard>
  )
}
