import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button } from 'primereact/button'
import { InputText } from 'primereact/inputtext'
import { Password } from 'primereact/password'
import AuthCard from '../../components/shared/AuthCard'
import { homePathFor } from '../../config/navigation'
import { useFormErrors } from '../../hooks/useFormErrors'
import { useNotify } from '../../hooks/useNotify'
import { useT } from '../../i18n'
import { safeRedirect } from '../../router/guards'
import { useAccessStore, useAuthStore } from '../../stores'
import styles from './AuthForms.module.css'

export default function Login() {
  const { t } = useT()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const notify = useNotify()
  const form = useFormErrors()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    form.clear()
    try {
      const session = await useAuthStore.getState().login({ email, password })
      await navigate(safeRedirect(params.get('redirect')) ?? homePathFor(session.tenant.type, useAccessStore.getState().can), { replace: true })
    } catch (err) {
      if (!form.capture(err)) notify.error(err, t('auth.loginFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard eyebrow={t('auth.welcomeBack')} title={t('auth.signInTitle')} subtitle={t('auth.signInSubtitle')}>
      <form onSubmit={onSubmit} className={styles.formGrid} noValidate>
        <label htmlFor="email">{t('auth.email')}</label>
        <InputText
          id="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          autoComplete="email"
          placeholder={t('auth.emailPlaceholder')}
          invalid={!!form.first('email')}
          className="p-fluid-field"
        />
        {form.first('email') && <small className="field-error">{form.first('email')}</small>}

        <label htmlFor="password">{t('auth.password')}</label>
        <Password
          inputId="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          toggleMask
          feedback={false}
          autoComplete="current-password"
          placeholder={t('auth.passwordPlaceholder')}
          invalid={!!form.first('password')}
          className="p-fluid-field"
        />
        {form.first('password') && <small className="field-error">{form.first('password')}</small>}

        <div className={styles.actionsRow}>
          <Button label={t('auth.signInTitle')} type="submit" loading={submitting} />
          <Link to="/forgot" className={styles.forgotLink}>
            {t('auth.forgotPassword')}
          </Link>
        </div>

        <p className={`${styles.helperText} ${styles.helperTextLoose}`}>
          {t('auth.newHere')}{' '}
          <Link to="/register" className={styles.link}>
            {t('auth.createAccount')}
          </Link>
        </p>
      </form>
    </AuthCard>
  )
}
