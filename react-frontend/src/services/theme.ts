import { palette } from '@primeuix/styled'
import laraTheme from 'primereact/resources/themes/lara-light-blue/theme.css?raw'
import type { TenantType } from '../types/models'

export type Theme = {
  name: TenantType
  label: string
  cssVars: Record<string, string>
  bodyClass?: string
}

export const doctorTheme: Theme = {
  name: 'doctor',
  label: 'Doctor',
  cssVars: {
    '--bg': '#f6fbff',
    '--text': '#0f1724',
    '--primary': '#0f66f0',
    '--primary-contrast': '#ffffff',
    '--surface': '#ffffff',
    '--surface-elevated': '#f8fbff',
    '--border': '#e6eefb',
    '--accent': '#06b6d4',
    '--muted': '#64748b'
  },
  bodyClass: 'theme-doctor'
}

export const marketplaceTheme: Theme = {
  name: 'marketplace',
  label: 'Marketplace',
  cssVars: {
    '--bg': '#fffaf4',
    '--text': '#1f2937',
    '--primary': '#ef4444',
    '--primary-contrast': '#ffffff',
    '--surface': '#ffffff',
    '--surface-elevated': '#fff4eb',
    '--border': '#fde7d8',
    '--accent': '#f59e0b',
    '--muted': '#7c2d12'
  },
  bodyClass: 'theme-marketplace'
}

/** Every theme the app ships; which ones are offered is decided by the theme store */
export const availableThemes: Theme[] = [doctorTheme, marketplaceTheme]

/**
 * PrimeReact's Lara theme hard-codes Tailwind's blue as its primary colour. To keep
 * every component (buttons, tags, focus rings...) in the active theme's colour, like
 * PrimeVue's updatePrimaryPalette(), the theme is re-emitted with those shades
 * swapped for a palette generated from the theme's primary. Info-severity rules keep
 * their blue, so "info" never turns into the brand colour.
 */
const LARA_BLUE: Record<string, string> = {
  '50': '#eff6ff',
  '100': '#dbeafe',
  '200': '#bfdbfe',
  '300': '#93c5fd',
  '400': '#60a5fa',
  '500': '#3b82f6',
  '600': '#2563eb',
  '700': '#1d4ed8',
  '800': '#1e40af',
  '900': '#1e3a8a'
}

function hexToRgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`
}

const themedCss = new Map<string, string>()

function recolour(primary: string): string {
  const cached = themedCss.get(primary)
  if (cached) return cached

  const scale = palette(primary) as Record<string, string> | string
  if (typeof scale === 'string') return laraTheme

  // Fonts are the app's own (no Inter files are shipped with the injected theme)
  const css = laraTheme.replace(/@font-face\s*{[^}]*}/g, '')
  const swaps = Object.entries(LARA_BLUE).map(([shade, blue]) => [new RegExp(blue, 'gi'), scale[shade] ?? blue] as const)
  const rgb = hexToRgb(scale['500'] ?? LARA_BLUE['500'])

  const out = css
    .split('}')
    .map((chunk) => {
      const selector = chunk.slice(0, chunk.lastIndexOf('{'))
      if (/-info\b/.test(selector)) return chunk
      let next = chunk.replace(/rgba\(59,\s*130,\s*246,/g, `rgba(${rgb},`)
      for (const [pattern, colour] of swaps) next = next.replace(pattern, colour)
      return next
    })
    .join('}')

  themedCss.set(primary, out)
  return out
}

function applyComponentTheme(primary: string): void {
  let style = document.getElementById('primereact-theme') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'primereact-theme'
    // First in <head>, so the app's own stylesheets come later in the cascade
    document.head.prepend(style)
  }
  style.textContent = recolour(primary)
}

export function applyTheme(themeName: TenantType): void {
  const theme = availableThemes.find((t) => t.name === themeName) || doctorTheme
  const root = document.documentElement
  Object.entries(theme.cssVars).forEach(([k, v]) => root.style.setProperty(k, v))

  // Keep PrimeReact components in sync with the active theme
  applyComponentTheme(theme.cssVars['--primary'])

  // Manage body class for theme-specific selectors
  document.body.classList.remove(...availableThemes.map((t) => t.bodyClass || ''))
  if (theme.bodyClass) document.body.classList.add(theme.bodyClass)

  applyFavicon(theme.cssVars['--primary'], theme.cssVars['--accent'])
}

/** Same mark as public/favicon.svg, drawn in the theme's colours */
function faviconSvg(primary: string, accent: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${primary}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><path d="M18 20h28a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H30l-8 7v-7h-4a4 4 0 0 1-4-4V24a4 4 0 0 1 4-4z" fill="#fff"/><circle cx="24" cy="31" r="2.6" fill="${primary}"/><circle cx="32" cy="31" r="2.6" fill="${primary}"/><circle cx="40" cy="31" r="2.6" fill="${primary}"/></svg>`
}

function applyFavicon(primary: string, accent: string): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = 'image/svg+xml'
  link.href = `data:image/svg+xml,${encodeURIComponent(faviconSvg(primary, accent))}`
}
