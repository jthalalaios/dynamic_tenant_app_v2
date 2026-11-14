import { createElement, Fragment, useCallback, type ReactNode } from 'react'
import { create } from 'zustand'

/**
 * Translations with vue-i18n's message syntax, so the locale files are shared
 * unchanged with the Vue app: `{name}` placeholders and `{'@'}` literals.
 *
 * Messages are lazy-loaded per locale by helpers/language.ts. Missing keys fall
 * back to English, then to the key itself (warned about in development).
 */
type Messages = { [key: string]: string | Messages }
export type TranslateParams = Record<string, string | number>

interface I18nState {
  locale: string
  messages: Record<string, Messages>
}

const FALLBACK = 'en'

export const useI18nStore = create<I18nState>(() => ({ locale: FALLBACK, messages: {} }))

export function setLocaleMessages(locale: string, messages: Messages): void {
  useI18nStore.setState((state) => ({ messages: { ...state.messages, [locale]: messages } }))
}

export function setActiveLocale(locale: string): void {
  useI18nStore.setState({ locale })
}

function lookup(messages: Messages | undefined, key: string): string | undefined {
  let node: string | Messages | undefined = messages
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

function format(message: string, params: TranslateParams = {}): string {
  return message.replace(/\{\s*(?:'([^']*)'|([A-Za-z0-9_]+))\s*\}/g, (match, literal: string | undefined, name: string | undefined) => {
    if (literal !== undefined) return literal
    return name !== undefined && name in params ? String(params[name]) : match
  })
}

/** Translate outside React (router titles, notifications built in stores) */
export function translate(key: string, params?: TranslateParams): string {
  const { locale, messages } = useI18nStore.getState()
  const message = lookup(messages[locale], key) ?? lookup(messages[FALLBACK], key)

  if (message === undefined) {
    if (import.meta.env.DEV && Object.keys(messages).length) console.warn(`[i18n] Missing translation: ${key}`)
    return key
  }

  return format(message, params)
}

/**
 * Component interpolation (vue-i18n's <i18n-t>): splits a translated message on its
 * `{slot}` placeholders and puts React nodes there.
 *
 *   interpolate(t('auth.verificationSentTo'), { email: <strong>{email}</strong> })
 */
export function interpolate(message: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return message.split(/(\{\s*[A-Za-z0-9_]+\s*\})/g).map((part, index) => {
    const name = /^\{\s*([A-Za-z0-9_]+)\s*\}$/.exec(part)?.[1]
    return name !== undefined && name in nodes ? createElement(Fragment, { key: index }, nodes[name]) : part
  })
}

/** `const { t, locale } = useT()`: re-renders when the locale or its messages change */
export function useT() {
  const locale = useI18nStore((state) => state.locale)
  const messages = useI18nStore((state) => state.messages)

  const t = useCallback(
    (key: string, params?: TranslateParams) => {
      const message = lookup(messages[locale], key) ?? lookup(messages[FALLBACK], key)
      return message === undefined ? key : format(message, params)
    },
    [locale, messages]
  )

  return { t, locale }
}
