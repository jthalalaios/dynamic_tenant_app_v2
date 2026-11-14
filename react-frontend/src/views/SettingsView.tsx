import { useState, type FormEvent } from 'react'
import { Button } from 'primereact/button'
import { InputText } from 'primereact/inputtext'
import { Password } from 'primereact/password'
import { SelectButton } from 'primereact/selectbutton'
import BaseCard from '../components/shared/cards/BaseCard'
import PageHeader from '../components/shared/PageHeader'
import TimezoneSelector from '../components/shared/TimezoneSelector'
import { authApi } from '../api'
import { SUPPORTED_LOCALES, type LocaleCode } from '../helpers/language'
import { useFormErrors } from '../hooks/useFormErrors'
import { useFormatters } from '../hooks/useFormatters'
import { useNotify } from '../hooks/useNotify'
import { usePreferenceActions } from '../hooks/usePreferenceActions'
import { useT } from '../i18n'
import { useAuthStore, usePreferencesStore, useUserStore } from '../stores'
import styles from './SettingsView.module.css'

const localeOptions = SUPPORTED_LOCALES.map((l) => ({ value: l.code, label: `${l.flag} ${l.label}` }))

export default function SettingsView() {
  const { t } = useT()
  const user = useUserStore((s) => s.user)
  const tenant = useUserStore((s) => s.tenant)
  const locale = usePreferencesStore((s) => s.locale)
  const notify = useNotify()
  const fmt = useFormatters()
  const { changeLocale } = usePreferenceActions()
  const profileErrors = useFormErrors()
  const passwordErrors = useFormErrors()

  const [name, setName] = useState(user?.name ?? '')
  const [savingProfile, setSavingProfile] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    setSavingProfile(true)
    profileErrors.clear()
    try {
      await useAuthStore.getState().applySession(await authApi.updateProfile({ name }))
      notify.success(t('common.saved'))
    } catch (err) {
      if (!profileErrors.capture(err)) notify.error(err)
    } finally {
      setSavingProfile(false)
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    setSavingPassword(true)
    passwordErrors.clear()
    try {
      await authApi.updateProfile({ current_password: currentPassword, password: newPassword, password_confirmation: confirmPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      notify.success(t('settings.passwordChanged'))
    } catch (err) {
      if (!passwordErrors.capture(err)) notify.error(err)
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <main className="page">
      <PageHeader eyebrow={t('common.settings')} title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <section className={`card-grid ${styles.grid}`}>
        <BaseCard padding="lg" header={<strong>{t('settings.profile')}</strong>}>
          <form className="dialog-form" onSubmit={saveProfile} noValidate>
            <div className="field field--full">
              <label htmlFor="s_name">{t('auth.name')}</label>
              <InputText id="s_name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!profileErrors.first('name')} className="p-fluid-field" />
              {profileErrors.first('name') && <small className="field-error">{profileErrors.first('name')}</small>}
            </div>
            <div className="field field--full">
              <label>{t('auth.email')}</label>
              <InputText value={user?.email ?? ''} disabled className="p-fluid-field" />
            </div>
            <div className="field field--full">
              <span className="muted">
                {t('settings.organization')}: <strong>{tenant?.name}</strong> · {tenant ? t(`themes.${tenant.type}`) : ''}
              </span>
            </div>
            <div className="field field--full">
              <Button label={t('common.save')} type="submit" loading={savingProfile} />
            </div>
          </form>
        </BaseCard>

        <BaseCard padding="lg" header={<strong>{t('settings.preferences')}</strong>}>
          <div className="dialog-form">
            <div className="field field--full">
              <label>{t('common.language')}</label>
              <SelectButton
                value={locale}
                options={localeOptions}
                optionLabel="label"
                optionValue="value"
                allowEmpty={false}
                onChange={(e) => e.value && void changeLocale(e.value as LocaleCode)}
              />
            </div>
            <div className="field field--full">
              <label>{t('common.timezone')}</label>
              <TimezoneSelector />
              <small className="muted">{t('settings.timezoneHint', { now: fmt.dateTime(new Date().toISOString()) })}</small>
            </div>
          </div>
        </BaseCard>

        <BaseCard padding="lg" header={<strong>{t('settings.security')}</strong>}>
          <form className="dialog-form" onSubmit={changePassword} noValidate>
            <div className="field field--full">
              <label htmlFor="s_current">{t('settings.currentPassword')}</label>
              <Password
                inputId="s_current"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                feedback={false}
                toggleMask
                autoComplete="current-password"
                invalid={!!passwordErrors.first('current_password')}
                className="p-fluid-field"
              />
              {passwordErrors.first('current_password') && <small className="field-error">{passwordErrors.first('current_password')}</small>}
            </div>
            <div className="field field--full">
              <label htmlFor="s_new">{t('auth.newPassword')}</label>
              <Password
                inputId="s_new"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                toggleMask
                autoComplete="new-password"
                invalid={!!passwordErrors.first('password')}
                className="p-fluid-field"
              />
              {passwordErrors.first('password') && <small className="field-error">{passwordErrors.first('password')}</small>}
            </div>
            <div className="field field--full">
              <label htmlFor="s_confirm">{t('auth.confirmPassword')}</label>
              <Password
                inputId="s_confirm"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                feedback={false}
                toggleMask
                autoComplete="new-password"
                className="p-fluid-field"
              />
            </div>
            <div className="field field--full">
              <Button label={t('settings.changePassword')} type="submit" severity="secondary" loading={savingPassword} />
            </div>
          </form>
        </BaseCard>
      </section>
    </main>
  )
}
