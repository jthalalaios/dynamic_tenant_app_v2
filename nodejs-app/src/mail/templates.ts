import type { MailBrand, MailCopy } from './branding.ts'

/**
 * Branded email templates (the port of resources/views/mail). Every theme fills
 * the shared shell's `hero` and `content`; colours come from config/branding.ts.
 * Email-client safe: tables, inline styles, no external images or web fonts.
 *
 * Add `templates.<theme>['<template>']` to brand a new theme; themes without one
 * use the generic `default` templates.
 */
export interface MailView {
  brand: MailBrand
  copy: MailCopy
  url: string
  expiresIn: string | null
  locale: string
}

type Template = (view: MailView) => string

const FONT = "'Segoe UI', Helvetica, Arial, sans-serif"

/** HTML-escape like Blade's {{ }} */
export function e(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

// --------------------------------------------------------------------- shell

function layout(view: MailView, hero: string, content: string): string {
  const { brand, copy } = view
  const c = (name: string) => e(brand.color(name))

  return `<!DOCTYPE html>
<html lang="${e(view.locale.replace('_', '-'))}" xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light only">
    <meta name="supported-color-schemes" content="light only">
    <title>${e(copy.get('subject'))}</title>
</head>
<body style="margin:0; padding:0; width:100%; background-color:${c('background')}; -webkit-text-size-adjust:100%;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">
        ${e(copy.get('intro'))}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${c('background')};">
        <tr>
            <td align="center" style="padding:32px 14px 40px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;">
                    <tr>
                        <td style="padding:0 4px 18px;">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td width="40" height="40" align="center" valign="middle" bgcolor="${c('primary')}"
                                        style="width:40px; height:40px; border-radius:12px; background-color:${c('primary')}; background-image:linear-gradient(135deg, ${c('primary')}, ${c('accent')}); color:#ffffff; font-family:Arial, sans-serif; font-size:20px; line-height:40px; font-weight:700;">
                                        ${e(brand.glyph)}
                                    </td>
                                    <td style="padding-left:12px; font-family:${FONT};">
                                        <div style="font-size:18px; font-weight:700; color:${c('text')};">${e(brand.organization)}</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color:${c('surface')}; border:1px solid ${c('border')}; border-radius:22px; overflow:hidden;">
                            ${hero}
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td style="padding:30px 34px 34px; font-family:${FONT}; font-size:15px; line-height:1.6; color:${c('text')};">
                                        ${content}
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding:22px 24px 0; font-family:${FONT}; font-size:12px; line-height:1.6; color:${c('muted')};">
                            ${e(copy.common('footer'))}<br>
                            <a href="${e(brand.frontendUrl)}" style="color:${c('primary')}; text-decoration:none; font-weight:600;">${e(brand.organization)}</a>
                            &nbsp;·&nbsp; © ${new Date().getFullYear()}
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`
}

// ------------------------------------------------------------------ partials

/** Bulletproof call-to-action button: a table cell, so it renders even where CSS is limited (Outlook) */
function button(view: MailView, label: string): string {
  const c = (name: string) => e(view.brand.color(name))
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px;">
    <tr>
        <td align="center" bgcolor="${c('primary')}"
            style="border-radius:14px; background-color:${c('primary')}; background-image:linear-gradient(135deg, ${c('primary')}, ${c('accent')}); box-shadow:0 10px 24px rgba(15, 23, 42, 0.14);">
            <a href="${e(view.url)}" target="_blank" rel="noopener"
               style="display:inline-block; padding:15px 30px; font-family:${FONT}; font-size:16px; font-weight:700; color:#ffffff; text-decoration:none; border-radius:14px;">
                ${e(label)} &rarr;
            </a>
        </td>
    </tr>
</table>`
}

/** Expiry, safety note, raw link fallback and signature: the same for every theme */
function closing(view: MailView): string {
  const { copy } = view
  const c = (name: string) => e(view.brand.color(name))
  const expires = view.expiresIn
    ? `<p style="margin:0 0 18px; font-size:13px; color:${c('muted')};">⏱&nbsp; ${e(copy.common('expires', { time: view.expiresIn }))}</p>`
    : ''

  return `${expires}
<p style="margin:0 0 22px; font-size:14px; color:${c('muted')};">${e(copy.get('ignore'))}</p>

<p style="margin:0; font-size:15px;">
    ${e(copy.common('signature'))}
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px; border-top:1px solid ${c('border')};">
    <tr>
        <td style="padding-top:16px; font-size:12px; line-height:1.55; color:${c('muted')};">
            ${e(copy.common('fallback'))}<br>
            <a href="${e(view.url)}" style="color:${c('primary')}; word-break:break-all;">${e(view.url)}</a>
        </td>
    </tr>
</table>`
}

function greetingAndIntro(view: MailView): string {
  return `<p style="margin:0 0 14px; font-size:16px; font-weight:600;">${e(view.copy.common('greeting'))}</p>
<p style="margin:0;">${e(view.copy.get('intro'))}</p>`
}

// ---------------------------------------------------------------------- heroes

/** Generic hero: just the title */
function defaultHero(view: MailView): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
        <td style="padding:32px 34px 0; font-family:${FONT};">
            <h1 style="margin:0; font-size:24px; line-height:1.3; color:${e(view.brand.color('text'))};">${e(view.copy.get('title'))}</h1>
        </td>
    </tr>
</table>`
}

/** Clinic hero: calm, airy band with a medical cross badge */
function doctorHero(view: MailView, icon: string): string {
  const c = (name: string) => e(view.brand.color(name))
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
        <td align="center" bgcolor="${c('soft')}"
            style="padding:38px 28px 30px; background-color:${c('soft')}; background-image:linear-gradient(180deg, ${c('soft')} 0%, ${c('surface')} 100%); border-bottom:1px solid ${c('border')}; font-family:${FONT};">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td width="68" height="68" align="center" valign="middle" bgcolor="${c('surface')}"
                        style="width:68px; height:68px; border-radius:50%; background-color:${c('surface')}; border:2px solid ${c('border')}; box-shadow:0 10px 26px rgba(15, 102, 240, 0.16); color:${c('primary')}; font-family:Arial, sans-serif; font-size:32px; line-height:64px; font-weight:700;">
                        ${e(icon)}
                    </td>
                </tr>
            </table>
            <h1 style="margin:20px 0 6px; font-size:24px; line-height:1.3; font-weight:700; color:${c('text')};">${e(view.copy.get('title'))}</h1>
            <p style="margin:0; font-size:13px; letter-spacing:0.14em; text-transform:uppercase; font-weight:700; color:${c('primary')};">${e(view.copy.get('eyebrow'))}</p>
        </td>
    </tr>
</table>`
}

/** Store hero: bold full-bleed gradient banner with white type */
function marketplaceHero(view: MailView, icon: string): string {
  const c = (name: string) => e(view.brand.color(name))
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
        <td bgcolor="${c('primary')}"
            style="padding:34px 34px 32px; background-color:${c('primary')}; background-image:linear-gradient(120deg, ${c('primary')} 0%, ${c('accent')} 100%); font-family:${FONT}; color:#ffffff;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td valign="middle">
                        <span style="display:inline-block; padding:5px 12px; border-radius:999px; background-color:rgba(255, 255, 255, 0.22); font-size:11px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:#ffffff;">
                            ${e(view.copy.get('eyebrow'))}
                        </span>
                        <h1 style="margin:14px 0 0; font-size:27px; line-height:1.25; font-weight:800; color:#ffffff;">${e(view.copy.get('title'))}</h1>
                    </td>
                    <td width="76" align="right" valign="middle" style="font-size:52px; line-height:1;">${e(icon)}</td>
                </tr>
            </table>
        </td>
    </tr>
</table>`
}

// ------------------------------------------------------------------- templates

const generic: Template = (view) =>
  layout(view, defaultHero(view), `${greetingAndIntro(view)}\n${button(view, view.copy.get('cta'))}\n${closing(view)}`)

function doctorHighlights(view: MailView): string {
  const highlights = view.copy.items('highlights')
  if (!highlights.length) return ''
  const c = (name: string) => e(view.brand.color(name))
  const rows = highlights
    .map(
      (line) => `<tr>
        <td style="padding:0 20px 12px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                    <td width="24" height="24" align="center" valign="middle" bgcolor="${c('soft')}"
                        style="width:24px; height:24px; border-radius:50%; background-color:${c('soft')}; color:${c('primary')}; font-family:Arial, sans-serif; font-size:13px; font-weight:700; line-height:24px;">✓</td>
                    <td style="padding-left:12px; font-size:14px; color:${c('text')};">${e(line)}</td>
                </tr>
            </table>
        </td>
    </tr>`
    )
    .join('\n')

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="margin:24px 0 24px; border:1px solid ${c('border')}; border-radius:16px; background-color:${c('background')};">
    <tr>
        <td style="padding:18px 20px 8px; font-size:14px; font-weight:700; color:${c('text')};">${e(view.copy.get('highlights_title'))}</td>
    </tr>
    ${rows}
    <tr><td style="font-size:0; line-height:6px;">&nbsp;</td></tr>
</table>`
}

function marketplaceHighlights(view: MailView): string {
  const highlights = view.copy.items('highlights')
  if (!highlights.length) return ''
  const c = (name: string) => e(view.brand.color(name))
  // One icon per highlight, in order: products, orders, insights
  const icons = ['📦', '🚚', '📈']
  const rows = highlights
    .map(
      (line, i) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="margin:0 0 10px; border-radius:14px; background-color:${c('soft')}; border-left:4px solid ${i % 2 ? c('accent') : c('primary')};">
    <tr>
        <td width="52" align="center" valign="middle" style="padding:14px 0 14px 8px; font-size:22px; line-height:1;">${icons[i] ?? '✨'}</td>
        <td valign="middle" style="padding:14px 16px 14px 6px; font-size:14px; font-weight:600; color:${c('text')};">${e(line)}</td>
    </tr>
</table>`
    )
    .join('\n')

  return `<p style="margin:26px 0 12px; font-size:14px; font-weight:700; color:${c('text')};">${e(view.copy.get('highlights_title'))}</p>
${rows}
<div style="height:16px; line-height:16px; font-size:0;">&nbsp;</div>`
}

const templates: Record<string, Record<string, Template>> = {
  default: {
    'verify-email': generic,
    'reset-password': generic
  },
  doctor: {
    'verify-email': (view) =>
      layout(
        view,
        doctorHero(view, '✚'),
        `${greetingAndIntro(view)}\n${button(view, view.copy.get('cta'))}\n${doctorHighlights(view)}\n${closing(view)}`
      ),
    'reset-password': (view) =>
      layout(view, doctorHero(view, '🔒'), `${greetingAndIntro(view)}\n${button(view, view.copy.get('cta'))}\n${closing(view)}`)
  },
  marketplace: {
    'verify-email': (view) =>
      layout(
        view,
        marketplaceHero(view, '🛍'),
        `${greetingAndIntro(view)}\n${button(view, view.copy.get('cta'))}\n${marketplaceHighlights(view)}\n${closing(view)}`
      ),
    'reset-password': (view) =>
      layout(view, marketplaceHero(view, '🔑'), `${greetingAndIntro(view)}\n${button(view, view.copy.get('cta'))}\n${closing(view)}`)
  }
}

/** Name of the template that renders: `{theme}.{template}`, or `default.{template}` */
export function templateName(theme: string, template: string): string {
  return templates[theme]?.[template] ? `${theme}.${template}` : `default.${template}`
}

export function renderHtml(template: string, view: MailView): string {
  const render = templates[view.brand.theme]?.[template] ?? templates.default[template]
  if (!render) throw new Error(`Unknown mail template: ${template}`)
  return render(view)
}

/** Plain-text part of every branded call-to-action email (not HTML: nothing is escaped) */
export function renderText(view: MailView): string {
  const { copy } = view
  const lines = [copy.get('title'), '', copy.common('greeting'), '', copy.get('intro'), '', `${copy.get('cta')}:`, view.url, '']
  if (view.expiresIn) lines.push(copy.common('expires', { time: view.expiresIn }), '')
  lines.push(copy.get('ignore'), '', copy.common('signature'), '', '--', copy.common('footer'), view.brand.frontendUrl)
  return lines.join('\n') + '\n'
}
