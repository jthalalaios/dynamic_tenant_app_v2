import { createRef, useCallback, useMemo } from 'react'
import type { Toast, ToastMessage } from 'primereact/toast'
import { ApiError } from '../api'
import { useT } from '../i18n'

/** The app's single <Toast> (mounted in App.tsx), like PrimeVue's ToastService */
export const toastRef = createRef<Toast>()

export function showToast(message: ToastMessage): void {
  toastRef.current?.show(message)
}

/**
 * Toast helpers with consistent API error handling.
 */
export function useNotify() {
  const { t } = useT()

  const success = useCallback((detail: string, summary = t('common.success')) => showToast({ severity: 'success', summary, detail, life: 3000 }), [t])

  const info = useCallback((detail: string, summary = t('common.info')) => showToast({ severity: 'info', summary, detail, life: 3000 }), [t])

  /** Shows the most useful message from any thrown value */
  const error = useCallback(
    (err: unknown, fallback = t('errors.generic')) => {
      const apiError = err instanceof ApiError ? err : ApiError.from(err)
      // 401s are handled globally (redirect to sign-in); don't stack a toast on top
      if (apiError.status === 401) return

      const detail = apiError.isNetworkError ? t('errors.network') : (apiError.firstError() ?? (apiError.message || fallback))

      showToast({ severity: 'error', summary: t('common.error'), detail, life: 5000 })
    },
    [t]
  )

  return useMemo(() => ({ success, info, error }), [success, info, error])
}
