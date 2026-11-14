import type { ElementType, ReactNode } from 'react'
import { cx } from '../../../utils/cx'
import styles from './BaseCard.module.css'

interface BaseCardProps {
  as?: ElementType
  padding?: 'none' | 'sm' | 'md' | 'lg'
  /** Lift and glow on hover, for cards the user can act on */
  interactive?: boolean
  /** Thin primary→accent bar along the top edge */
  accent?: boolean
  className?: string
  header?: ReactNode
  footer?: ReactNode
  children?: ReactNode
}

export default function BaseCard({ as: Tag = 'article', padding = 'md', interactive = false, accent = false, className, header, footer, children }: BaseCardProps) {
  return (
    <Tag className={cx('base-card', styles.card, styles[padding], interactive && styles.interactive, accent && styles.accent, className)}>
      {header !== undefined && <header className={cx('base-card__header', styles.header)}>{header}</header>}
      <div className={cx('base-card__body', styles.body)}>{children}</div>
      {footer !== undefined && <footer className={cx('base-card__footer', styles.footer)}>{footer}</footer>}
    </Tag>
  )
}
