import { cx } from '../../../utils/cx'
import BaseCard from './BaseCard'
import styles from './StatCard.module.css'

interface StatCardProps {
  label: string
  value: string | number
  caption?: string
  icon?: string
  trend?: string
  trendDirection?: 'up' | 'down'
}

export default function StatCard({ label, value, caption = '', icon = 'pi pi-chart-bar', trend = '', trendDirection = 'up' }: StatCardProps) {
  return (
    <BaseCard interactive>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        <span className={styles.icon} aria-hidden="true">
          <i className={icon}></i>
        </span>
      </div>
      <div className={styles.value}>{value}</div>
      <div className={styles.bottom}>
        {trend && (
          <span className={cx(styles.trend, trendDirection === 'down' ? styles.trendDown : styles.trendUp)}>
            <i className={trendDirection === 'down' ? 'pi pi-arrow-down-right' : 'pi pi-arrow-up-right'} aria-hidden="true"></i>
            {trend}
          </span>
        )}
        <span className={styles.caption}>{caption}</span>
      </div>
    </BaseCard>
  )
}
