import { useNavigate } from 'react-router'
import { Button } from 'primereact/button'
import BaseCard from '../../components/shared/cards/BaseCard'
import { useT } from '../../i18n'
import styles from './ErrorPage.module.css'

/** Shared layout of the 403 and 404 pages */
export default function ErrorPage({ icon, title, body }: { icon: string; title: string; body: string }) {
  const { t } = useT()
  const navigate = useNavigate()

  return (
    <main className="page">
      <BaseCard padding="lg" accent className={styles.card}>
        <i className={`${icon} ${styles.icon}`} aria-hidden="true"></i>
        <h1>{title}</h1>
        <p className="muted">{body}</p>
        <Button label={t('errors.backHome')} icon="pi pi-arrow-left" onClick={() => void navigate('/')} />
      </BaseCard>
    </main>
  )
}
