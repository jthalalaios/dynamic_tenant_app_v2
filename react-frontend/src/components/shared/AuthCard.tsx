import type { ReactNode } from 'react'
import BaseCard from './cards/BaseCard'
import styles from './AuthCard.module.css'

export default function AuthCard({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className={styles.shell}>
      <BaseCard className={styles.card} padding="lg" accent>
        <div className={styles.header}>
          <p className={`eyebrow ${styles.eyebrow}`}>{eyebrow}</p>
          <h2 className={styles.title}>{title}</h2>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
        {children}
      </BaseCard>
    </section>
  )
}
