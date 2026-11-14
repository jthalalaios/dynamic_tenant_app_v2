import { Tag, type TagProps } from 'primereact/tag'
import { useT } from '../../i18n'
import { snakeToCamel } from '../../helpers/text'

const SEVERITY: Record<string, NonNullable<TagProps['severity']>> = {
  scheduled: 'warning',
  checked_in: 'info',
  in_progress: 'contrast',
  completed: 'success',
  cancelled: 'danger',
  no_show: 'secondary',
  pending: 'warning',
  paid: 'info',
  shipped: 'contrast',
  delivered: 'success'
}

export default function StatusTag({ kind, status }: { kind: 'appointment' | 'order'; status: string }) {
  const { t } = useT()
  return <Tag value={t(`status.${kind}.${snakeToCamel(status)}`)} severity={SEVERITY[status] ?? 'secondary'} rounded />
}
