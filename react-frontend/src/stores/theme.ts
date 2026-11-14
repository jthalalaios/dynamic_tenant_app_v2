import { create } from 'zustand'
import { applyTheme, availableThemes, type Theme } from '../services/theme'
import { storage } from '../helpers/storage'
import { fixedTheme, initialThemes, isStandalone, isThemeName } from '../config/edition'
import type { TenantType } from '../types/models'

const THEME_KEY = 'theme'

interface ThemeState {
  enabled: TenantType[]
  currentThemeName: TenantType
  locked: boolean
  isStandalone: boolean
  init: () => void
  setTheme: (name: TenantType) => void
  lockTo: (type: TenantType) => void
  unlock: () => void
  /** Narrow the multi-mode offer to the themes the API actually serves (GET /app) */
  setEnabled: (themes: readonly string[]) => void
}

const stored = storage.get(THEME_KEY)

/**
 * Active visual theme.
 *
 * - Multi mode: guests may preview any enabled theme; once signed in, the
 *   theme is locked to the tenant type (a clinic always sees the doctor theme).
 * - Standalone mode: the theme is fixed and never unlocks (see config/edition).
 */
export const useThemeStore = create<ThemeState>((set, get) => ({
  enabled: [...initialThemes],
  currentThemeName: fixedTheme ?? (isThemeName(stored) && initialThemes.includes(stored) ? stored : initialThemes[0]),
  locked: isStandalone,
  isStandalone,

  init: () => applyTheme(get().currentThemeName),

  setTheme: (name) => {
    const { locked, enabled } = get()
    if (locked || !enabled.includes(name)) return
    set({ currentThemeName: name })
    storage.set(THEME_KEY, name)
    applyTheme(name)
  },

  lockTo: (type) => {
    set({ currentThemeName: type, locked: true })
    applyTheme(type)
  },

  unlock: () => {
    if (isStandalone) {
      get().lockTo(fixedTheme!)
      return
    }
    set({ locked: false })
    const preview = storage.get(THEME_KEY)
    const { enabled, currentThemeName } = get()
    const next = isThemeName(preview) && enabled.includes(preview) ? preview : enabled[0]
    if (next !== currentThemeName) get().setTheme(next)
  },

  setEnabled: (themes) => {
    if (isStandalone) return
    const next = initialThemes.filter((t) => themes.includes(t))
    if (!next.length) return
    set({ enabled: next })
    const { locked, currentThemeName } = get()
    if (!locked && !next.includes(currentThemeName)) get().setTheme(next[0])
  }
}))

export const selectAvailableThemes = (s: ThemeState): Theme[] => availableThemes.filter((t) => s.enabled.includes(t.name))

/** Whether a guest gets a theme picker (and a workspace type choice on sign up) */
export const selectCanSwitch = (s: ThemeState) => !s.locked && selectAvailableThemes(s).length > 1
