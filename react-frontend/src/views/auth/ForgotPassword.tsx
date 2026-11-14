import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button } from 'primereact/button'
import { InputText } from 'primereact/inputtext'
import AuthCard from '../../components/shared/AuthCard'
import { authApi } from '../../api'
import { useFormErrors } from '../../hooks/useFormErrors'
import { useNotify } from '../../hooks/useNotify'
import { useT } from '../../i18n'
import styles from './AuthForms.module.css'

export default function ForgotPassword() {
  const { t } = useT()
  const notify = useNotify()
  const form = useFormErrors()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    form.clear()
    try {
      await authApi.forgotPassword(email)
      notify.success(t('auth.genericResetSuccess'))
    } catch (err) {
      if (!form.capture(err)) notify.error(err, t('auth.requestFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard eyebrow={t('auth.resetAccess')} title={t('auth.forgotPasswordTitle')} subtitle={t('auth.forgotPasswordSubtitle')}>
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
        <Button label={t('auth.sendResetLink')} type="submit" loading={submitting} />
        <p className={styles.helperText}>
          <Link to="/signin" className={styles.link}>
            {t('auth.backToSignIn')}
          </Link>
        </p>
      </form>
    </AuthCard>
  )
}
