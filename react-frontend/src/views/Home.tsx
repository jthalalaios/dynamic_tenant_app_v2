import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from 'primereact/button'
import { Carousel, type CarouselResponsiveOption } from 'primereact/carousel'
import BaseCard from '../components/shared/cards/BaseCard'
import StatCard from '../components/shared/cards/StatCard'
import FeatureCard from '../components/shared/cards/FeatureCard'
import VisitorCard from '../themes/doctor/VisitorCard'
import ProductCard from '../themes/marketplace/ProductCard'
import { getSampleVisitors } from '../themes/doctor/visitors'
import { getSampleProducts } from '../themes/marketplace/products'
import { getDomainForTheme } from '../config/appDomains'
import { showToast } from '../hooks/useNotify'
import { useT } from '../i18n'
import { useThemeStore } from '../stores'
import type { Product, Visitor } from '../types/app'
import styles from './Home.module.css'

// One card beside the hero text on desktop; two once the hero stacks full-width; one on phones
const carouselResponsive: CarouselResponsiveOption[] = [
  { breakpoint: '1024px', numVisible: 2, numScroll: 1 },
  { breakpoint: '640px', numVisible: 1, numScroll: 1 }
]

export default function Home() {
  const navigate = useNavigate()
  const { t } = useT()
  const theme = useThemeStore((s) => s.currentThemeName)

  const domain = getDomainForTheme(theme)
  const isDoctor = domain.id === 'doctor'
  const key = domain.id

  const metrics = domain.metrics.map((m) => ({
    ...m,
    label: t(`home.${key}.metrics.${m.key}.title`),
    value: t(`home.${key}.metrics.${m.key}.value`),
    caption: t(`home.${key}.metrics.${m.key}.caption`)
  }))
  const features = domain.features.map((f) => ({
    ...f,
    title: t(`home.${key}.features.${f.key}.title`),
    body: t(`home.${key}.features.${f.key}.body`)
  }))

  const [visitors, setVisitors] = useState<Visitor[]>(getSampleVisitors)
  const [products] = useState<Product[]>(getSampleProducts)

  function checkIn(visitor: Visitor) {
    setVisitors((list) => list.map((v) => (v.id === visitor.id ? { ...v, status: 'checkedIn' } : v)))
  }

  function showDetails(visitor: Visitor) {
    showToast({ severity: 'info', summary: visitor.name, detail: `${visitor.time} • ${t(`doctor.reasons.${visitor.reason}`)}`, life: 3000 })
  }

  function addToCart(product: Product) {
    showToast({ severity: 'success', summary: t('cards.addToCart'), detail: t('cards.addedToCart', { name: product.name }), life: 3000 })
  }

  return (
    <main className="page home">
      <BaseCard className={`${styles.hero} ${styles.fadeIn}`} padding="lg" accent>
        <div className={styles.heroInner}>
          <div className={styles.heroLeft}>
            <p className={`eyebrow ${styles.eyebrow}`}>{t(`home.${key}.experience`)}</p>
            <h1 className={styles.heroTitle}>{t(`home.${key}.heroTitle`)}</h1>
            <p className={styles.heroSub}>{t(`home.${key}.heroSubtitle`)}</p>
            <div className={styles.heroCta}>
              <Button label={t(`home.${key}.ctaLabel`)} icon={domain.ctaIcon} size="large" onClick={() => void navigate(domain.dashboardRoute)} />
            </div>
          </div>
          <div className={styles.heroRight}>
            <p className={styles.carouselTitle}>{t(`home.${key}.carouselTitle`)}</p>
            {isDoctor ? (
              <Carousel
                key="visitors"
                value={visitors}
                numVisible={1}
                numScroll={1}
                responsiveOptions={carouselResponsive}
                className={styles.carousel}
                itemTemplate={(visitor: Visitor) => (
                  <div className={styles.slide}>
                    <VisitorCard visitor={visitor} onCheckIn={checkIn} onDetails={showDetails} />
                  </div>
                )}
              />
            ) : (
              <Carousel
                key="products"
                value={products}
                numVisible={1}
                numScroll={1}
                responsiveOptions={carouselResponsive}
                className={styles.carousel}
                itemTemplate={(product: Product) => (
                  <div className={styles.slide}>
                    <ProductCard product={product} onAdd={addToCart} />
                  </div>
                )}
              />
            )}
          </div>
        </div>
      </BaseCard>

      <section className={styles.fadeUp}>
        <div className="section-head">
          <h2>{t('home.sections.glance')}</h2>
        </div>
        <div className="card-grid card-grid--stats">
          {metrics.map((metric) => (
            <StatCard
              key={metric.key}
              label={metric.label}
              value={metric.value}
              caption={metric.caption}
              icon={metric.icon}
              trend={metric.trend}
              trendDirection={metric.trendDirection}
            />
          ))}
        </div>
      </section>

      <section className={styles.fadeUp}>
        <div className="section-head">
          <h2>{t('home.sections.features')}</h2>
        </div>
        <div className="card-grid card-grid--stats">
          {features.map((feature) => (
            <FeatureCard key={feature.key} title={feature.title} body={feature.body} icon={feature.icon} />
          ))}
        </div>
      </section>
    </main>
  )
}
