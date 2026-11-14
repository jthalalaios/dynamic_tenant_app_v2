import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Button } from 'primereact/button'
import AuthCard from '../../components/shared/AuthCard'
import { authApi } from '../../api'
import { onAuthSignal } from '../../helpers/authSignals'
import { useNotify } from '../../hooks/useNotify'
import { interpolate, useT } from '../../i18n'
import { useAuthStore, useUserStore } from '../../stores'
import { selectMustVerifyEmail } from '../../stores/user'
import styles from './AuthForms.module.css'

/** Interval of the background re-check while this tab is visible */
const POLL_MS = 15_000

const mustVerify = () => selectMustVerifyEmail(useUserStore.getState())

export default function VerifyEmail() {
  const { t } = useT()
  const navigate = useNavigate()
  const notify = useNotify()
  const email = useUserStore((s) => s.user?.email)

  const [checking, setChecking] = useState(false)
  const [resending, setResending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const checkingRef = useRef(false)
  const silentRunning = useRef(false)

  // Resend cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  /**
   * Quiet re-check (no toasts): runs when another tab confirms the link, when this
   * tab regains focus, and every few seconds, so the page unlocks by itself.
   */
  useEffect(() => {
    async function silentCheck() {
      if (silentRunning.current || checkingRef.current || document.visibilityState !== 'visible') return
      silentRunning.current = true
      try {
        await useAuthStore.getState().refreshSession()
        if (!mustVerify()) await navigate('/', { replace: true })
      } catch {
        // Offline or signed out: the global handlers deal with it; try again later
      } finally {
        silentRunning.current = false
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void silentCheck()
    }

    const offSignal = onAuthSignal((signal) => {
      if (signal.type === 'email-verified' && signal.userId === useUserStore.getState().user?.id) void silentCheck()
    })
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    const poller = setInterval(() => void silentCheck(), POLL_MS)

    return () => {
      clearInterval(poller)
      offSignal()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [navigate])

  /** The link may have been opened on another device: re-read the session */
  async function checkAgain() {
    setChecking(true)
    checkingRef.current = true
    try {
      await useAuthStore.getState().refreshSession()
      if (mustVerify()) notify.info(t('auth.stillUnverified'))
      else await navigate('/', { replace: true })
    } catch (err) {
      notify.error(err)
    } finally {
      setChecking(false)
      checkingRef.current = false
    }
  }

  async function resend() {
    setResending(true)
    try {
      const { message, verified } = await authApi.resendVerification()
      if (verified) {
        await useAuthStore.getState().refreshSession()
        await navigate('/', { replace: true })
        return
      }
      notify.success(message)
      setCooldown(30)
    } catch (err) {
      notify.error(err)
    } finally {
      setResending(false)
    }
  }

  async function signOut() {
    await useAuthStore.getState().logout()
    await navigate('/signin', { replace: true })
  }

  return (
    <AuthCard eyebrow={t('auth.oneMoreStep')} title={t('auth.verifyEmailTitle')} subtitle={t('auth.verifyEmailSubtitle')}>
      <div className={styles.stack}>
        <p className={styles.sentTo}>
          <i className="pi pi-envelope" aria-hidden="true"></i>
          <span>{interpolate(t('auth.verificationSentTo'), { email: <strong>{email}</strong> })}</span>
        </p>

        <Button label={t('auth.iVerified')} icon="pi pi-check" loading={checking} onClick={() => void checkAgain()} />
        <Button
          label={cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resendVerification')}
          severity="secondary"
          outlined
          loading={resending}
          disabled={cooldown > 0}
          onClick={() => void resend()}
        />

        <p className={styles.helperText}>
          {t('auth.wrongAccount')}{' '}
          <button type="button" className={`${styles.link} ${styles.linkButton}`} onClick={() => void signOut()}>
            {t('common.logout')}
          </button>
        </p>
      </div>
    </AuthCard>
  )
}
