import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button } from 'primereact/button'
import { InputText } from 'primereact/inputtext'
import { Message } from 'primereact/message'
import { Password } from 'primereact/password'
import AuthCard from '../../components/shared/AuthCard'
import { authApi } from '../../api'
import { useFormErrors } from '../../hooks/useFormErrors'
import { useNotify } from '../../hooks/useNotify'
import { useT } from '../../i18n'
import styles from './AuthForms.module.css'

export default function ResetPassword() {
  const { t } = useT()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const notify = useNotify()
  const form = useFormErrors()

  // The emailed link carries ?token=…&email=…
  const token = params.get('token') ?? ''
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    form.clear()
    try {
      const { message } = await authApi.resetPassword({ token, email, password, password_confirmation: passwordConfirmation })
      notify.success(message)
      await navigate('/signin', { replace: true })
    } catch (err) {
      if (!form.capture(err)) notify.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard eyebrow={t('auth.resetAccess')} title={t('auth.resetPasswordTitle')} subtitle={t('auth.resetPasswordSubtitle')}>
      {!token ? (
        <Message severity="warn" text={t('auth.resetLinkInvalid')} className="page-message" />
      ) : (
        <form onSubmit={onSubmit} className={styles.formGrid} noValidate>
          <label htmlFor="email">{t('auth.email')}</label>
          <InputText id="email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" invalid={!!form.first('email')} className="p-fluid-field" />
          {form.first('email') && <small className="field-error">{form.first('email')}</small>}

          <label htmlFor="password">{t('auth.newPassword')}</label>
          <Password
            inputId="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            toggleMask
            autoComplete="new-password"
            invalid={!!form.first('password')}
            className="p-fluid-field"
          />
          {form.first('password') && <small className="field-error">{form.first('password')}</small>}

          <label htmlFor="password_confirmation">{t('auth.confirmPassword')}</label>
          <Password
            inputId="password_confirmation"
            value={passwordConfirmation}
            onChange={(e) => setPasswordConfirmation(e.target.value)}
            toggleMask
            feedback={false}
            autoComplete="new-password"
            className="p-fluid-field"
          />

          <Button label={t('auth.resetPasswordAction')} type="submit" loading={submitting} />
          <p className={styles.helperText}>
            <Link to="/signin" className={styles.link}>
              {t('auth.backToSignIn')}
            </Link>
          </p>
        </form>
      )}
    </AuthCard>
  )
}
