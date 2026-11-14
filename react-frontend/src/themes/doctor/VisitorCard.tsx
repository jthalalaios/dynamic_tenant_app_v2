import { Avatar } from 'primereact/avatar'
import { Button } from 'primereact/button'
import { Tag } from 'primereact/tag'
import BaseCard from '../../components/shared/cards/BaseCard'
import { useT } from '../../i18n'
import { initials } from '../../helpers/text'
import type { Visitor } from '../../types/app'
import styles from './VisitorCard.module.css'

interface VisitorCardProps {
  visitor: Visitor
  /** e.g. the user is offline or lacks the check-in permission */
  checkInDisabled?: boolean
  /** Explains why check-in is disabled (shown as a tooltip) */
  checkInHint?: string
  loading?: boolean
  onDetails: (visitor: Visitor) => void
  onCheckIn: (visitor: Visitor) => void
}

export default function VisitorCard({ visitor, checkInDisabled = false, checkInHint = '', loading = false, onDetails, onCheckIn }: VisitorCardProps) {
  const { t } = useT()
  const isCheckedIn = visitor.status === 'checkedIn'

  return (
    <BaseCard
      padding="none"
      interactive
      footer={
        <>
          <Button label={t('cards.details')} icon="pi pi-search" size="small" text onClick={() => onDetails(visitor)} />
          <span className={styles.checkin} title={!isCheckedIn && checkInDisabled ? checkInHint : undefined}>
            <Button
              label={isCheckedIn ? t('cards.checkedIn') : t('cards.checkIn')}
              icon={isCheckedIn ? 'pi pi-check-circle' : 'pi pi-check'}
              size="small"
              outlined={!isCheckedIn}
              disabled={isCheckedIn || checkInDisabled}
              loading={loading}
              onClick={() => onCheckIn(visitor)}
            />
          </span>
        </>
      }
    >
      <div className={styles.main}>
        <Avatar label={initials(visitor.name)} shape="circle" size="large" className={styles.avatar} />
        <div className={styles.info}>
          <div className={styles.name}>{visitor.name}</div>
          <div className={styles.meta}>
            <i className="pi pi-clock" aria-hidden="true"></i>
            <span>{visitor.time}</span>
            <span aria-hidden="true">•</span>
            <span>{t(`doctor.reasons.${visitor.reason}`)}</span>
          </div>
        </div>
      </div>
      <div className={styles.status}>
        <Tag
          value={isCheckedIn ? t('cards.checkedIn') : t('cards.waiting')}
          severity={isCheckedIn ? 'success' : 'warning'}
          icon={isCheckedIn ? 'pi pi-check-circle' : 'pi pi-hourglass'}
          rounded
        />
      </div>
    </BaseCard>
  )
}
