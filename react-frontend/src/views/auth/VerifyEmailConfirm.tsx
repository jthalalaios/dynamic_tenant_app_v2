import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Button } from 'primereact/button'
import { Message } from 'primereact/message'
import { ProgressSpinner } from 'primereact/progressspinner'
import AuthCard from '../../components/shared/AuthCard'
import { ApiError, authApi } from '../../api'
import { broadcastAuthSignal } from '../../helpers/authSignals'
import { useT } from '../../i18n'
import { isAuthenticated, useAuthStore, useIsAuthenticated } from '../../stores'
import styles from './AuthForms.module.css'

type State = 'pending' | 'done' | 'failed'

export default function VerifyEmailConfirm() {
  const { t } = useT()
  const navigate = useNavigate()
  const { id = '', hash = '' } = useParams()
  const [params] = useSearchParams()
  const signedIn = useIsAuthenticated()
  const [state, setState] = useState<State>('pending')
  const [errorMessage, setErrorMessage] = useState('')
  // The link is verified once, even under StrictMode's double effects
  const started = useRef(false)

  const title = state === 'done' ? t('auth.emailVerifiedTitle') : state === 'failed' ? t('auth.verificationFailedTitle') : t('auth.verifyingEmailTitle')
  const subtitle = state === 'done' ? t('auth.emailVerifiedBody') : state === 'failed' ? t('auth.verificationFailedBody') : t('auth.verifyingEmailBody')

  useEffect(() => {
    if (started.current) return
    started.current = true

    const expires = params.get('expires') ?? ''
    const signature = params.get('signature') ?? ''

    if (!id || !hash || !expires || !signature) {
      setErrorMessage(t('auth.verificationLinkIncomplete'))
      setState('failed')
      return
    }

    void (async () => {
      try {
        await authApi.verifyEmail({ id, hash, expires, signature })
        // Unlock any other tab still showing "verify your email"
        broadcastAuthSignal({ type: 'email-verified', userId: Number(id) })
        // Unlock the app right away when the link was opened in the signed-in browser
        if (isAuthenticated()) await useAuthStore.getState().refreshSession().catch(() => {})
        setState('done')
      } catch (err) {
        setErrorMessage(err instanceof ApiError && err.message ? err.message : t('auth.verificationLinkIncomplete'))
        setState('failed')
      }
    })()
  }, [id, hash, params, t])

  function proceed() {
    // The guard sends signed-in users to their landing page
    void navigate(isAuthenticated() ? '/' : '/signin', { replace: true })
  }

  return (
    <AuthCard eyebrow={t('auth.oneMoreStep')} title={title} subtitle={subtitle}>
      <div className={styles.stack}>
        {state === 'pending' && <ProgressSpinner className={styles.spinner} strokeWidth="4" aria-label={t('auth.verifyingEmailTitle')} />}

        {state === 'done' && (
          <Button label={signedIn ? t('auth.continueToApp') : t('auth.signInTitle')} icon="pi pi-arrow-right" iconPos="right" onClick={proceed} />
        )}

        {state === 'failed' && (
          <>
            <Message severity="warn" text={errorMessage} className="page-message" />
            {signedIn ? (
              <Button label={t('auth.requestNewLink')} onClick={() => void navigate('/verify-email', { replace: true })} />
            ) : (
              <Link to="/signin" className={styles.link}>
                {t('auth.backToSignIn')}
              </Link>
            )}
          </>
        )}
      </div>
    </AuthCard>
  )
}
