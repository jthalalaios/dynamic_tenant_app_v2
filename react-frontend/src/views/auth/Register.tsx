import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { Button } from 'primereact/button'
import { InputText } from 'primereact/inputtext'
import { Password } from 'primereact/password'
import { SelectButton } from 'primereact/selectbutton'
import AuthCard from '../../components/shared/AuthCard'
import { appApi } from '../../api'
import { homePathFor } from '../../config/navigation'
import { useFormErrors } from '../../hooks/useFormErrors'
import { useNotify } from '../../hooks/useNotify'
import { useT } from '../../i18n'
import { useAccessStore, useAuthStore, usePreferencesStore, useThemeStore } from '../../stores'
import { selectAvailableThemes, selectCanSwitch } from '../../stores/theme'
import type { TenantType } from '../../types/models'
import styles from './AuthForms.module.css'

export default function Register() {
  const { t } = useT()
  const navigate = useNavigate()
  const notify = useNotify()
  const form = useFormErrors()
  const canSwitch = useThemeStore(selectCanSwitch)
  const available = useThemeStore(useShallow(selectAvailableThemes))
  const currentTheme = useThemeStore((s) => s.currentThemeName)

  // Default to the theme the guest is previewing (always the fixed one in a standalone app)
  const [type, setType] = useState<TenantType>(currentTheme)
  /** Workspace names from the API; the theme label until they arrive */
  const [workspaces, setWorkspaces] = useState<Partial<Record<TenantType, string>>>({})
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const workspaceName = workspaces[type] ?? t(`themes.${type}`)
  const typeOptions = available.map((theme) => ({ value: theme.name, label: t(`themes.${theme.name}`) }))

  useEffect(() => {
    appApi
      .config()
      .then((config) => setWorkspaces(config.workspaces ?? {}))
      .catch(() => {})
  }, [])

  // Follow the theme if it changes (e.g. the API narrowed the offer)
  useEffect(() => setType(currentTheme), [currentTheme])

  /** Preview the workspace being joined */
  function chooseType(next: TenantType) {
    setType(next)
    useThemeStore.getState().setTheme(next)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    form.clear()
    try {
      const prefs = usePreferencesStore.getState()
      const session = await useAuthStore.getState().register({ type, name, email, password, timezone: prefs.timezone, locale: prefs.locale })
      await navigate(homePathFor(session.tenant.type, useAccessStore.getState().can), { replace: true })
    } catch (err) {
      if (!form.capture(err)) notify.error(err, t('auth.registrationFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard eyebrow={t('auth.createAccount')} title={t('auth.signUpTitle')} subtitle={t('auth.signUpSubtitle')}>
      <form onSubmit={onSubmit} className={styles.formGrid} noValidate>
        {/* Standalone apps (and single-theme backends) only offer their own workspace */}
        {canSwitch && (
          <>
            <span className={styles.fieldLabel}>{t('auth.workspaceType')}</span>
            <SelectButton
              value={type}
              options={typeOptions}
              optionLabel="label"
              optionValue="value"
              allowEmpty={false}
              aria-label={t('auth.workspaceType')}
              onChange={(e) => e.value && chooseType(e.value as TenantType)}
            />
          </>
        )}

        {/* Everyone joins the theme's single workspace, as a member an admin can promote */}
        <p className={styles.joinHint} role="note">
          <i className={type === 'doctor' ? 'pi pi-heart' : 'pi pi-shopping-bag'} aria-hidden="true"></i>
          <span>{t('auth.joinWorkspace', { workspace: workspaceName })}</span>
        </p>

        <label htmlFor="name">{t('auth.name')}</label>
        <InputText
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          placeholder={t('auth.fullName')}
          invalid={!!form.first('name')}
          className="p-fluid-field"
        />
        {form.first('name') && <small className="field-error">{form.first('name')}</small>}

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
          autoComplete="new-password"
          placeholder={t('auth.choosePassword')}
          invalid={!!form.first('password')}
          className="p-fluid-field"
        />
        {form.first('password') && <small className="field-error">{form.first('password')}</small>}

        <Button label={t('auth.createAccount')} type="submit" loading={submitting} />

        <p className={styles.helperText}>
          {t('auth.alreadyHaveAccount')}{' '}
          <Link to="/signin" className={styles.link}>
            {t('auth.signInLink')}
          </Link>
        </p>
      </form>
    </AuthCard>
  )
}
