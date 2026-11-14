import { useT } from '../../i18n'
import ErrorPage from './ErrorPage'

export default function NotFoundView() {
  const { t } = useT()
  return <ErrorPage icon="pi pi-compass" title={t('errors.notFoundTitle')} body={t('errors.notFound')} />
}
