import type { CSSProperties } from 'react'
import { initials } from '../../helpers/text'
import type { ChatMember } from '../../types/models'
import { cx } from '../../utils/cx'
import styles from './ChatAvatar.module.css'

interface ChatAvatarProps {
  member: Pick<ChatMember, 'id' | 'name'> | null
  size?: 'sm' | 'md' | 'lg'
  /** Shows a presence dot when set */
  online?: boolean
}

export default function ChatAvatar({ member, size = 'md', online }: ChatAvatarProps) {
  // A stable, distinct hue per member, softened to sit well on both themes
  const hue = member ? (member.id * 137) % 360 : 0
  const palette = member ? ({ '--avatar-bg': `hsl(${hue} 72% 90%)`, '--avatar-fg': `hsl(${hue} 52% 30%)` } as CSSProperties) : undefined

  return (
    <span className={cx('chat-avatar', styles.avatar, styles[size], !member && styles.ghost)} style={palette} aria-hidden="true">
      {member ? initials(member.name) : <i className="pi pi-user"></i>}
      {online !== undefined && <span className={cx(styles.dot, online && styles.dotOn)}></span>}
    </span>
  )
}
