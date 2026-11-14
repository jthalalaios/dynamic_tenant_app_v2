import { useT } from '../../i18n'
import ErrorPage from './ErrorPage'

export default function ForbiddenView() {
  const { t } = useT()
  return <ErrorPage icon="pi pi-lock" title={t('errors.forbiddenTitle')} body={t('errors.forbidden')} />
}
