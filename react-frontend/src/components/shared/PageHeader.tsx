import type { ReactNode } from 'react'
import BaseCard from './cards/BaseCard'
import styles from './PageHeader.module.css'

export default function PageHeader({ title, eyebrow, subtitle, actions }: { title: string; eyebrow?: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <BaseCard className="dashboard-header" accent padding="lg">
      <div className="dashboard-header__inner">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1 className="dashboard-header__title">{title}</h1>
          {subtitle && <p className="dashboard-header__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </BaseCard>
  )
}
