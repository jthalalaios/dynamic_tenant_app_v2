import BaseCard from './BaseCard'
import styles from './FeatureCard.module.css'

export default function FeatureCard({ title, body, icon }: { title: string; body: string; icon: string }) {
  return (
    <BaseCard interactive accent>
      <span className={styles.icon} aria-hidden="true">
        <i className={icon}></i>
      </span>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.body}>{body}</p>
    </BaseCard>
  )
}
