import { hmac, safeEqual } from './hash.ts'

/**
 * Relative signed URLs (Laravel's URL::temporarySignedRoute(absolute: false) and
 * the `signed:relative` middleware). The signature covers the path and every query
 * parameter except `signature`, so it survives proxies and differing hosts.
 */
function canonical(path: string, params: URLSearchParams): string {
  const query = new URLSearchParams([...params].filter(([key]) => key !== 'signature').sort(([a], [b]) => a.localeCompare(b)))
  const qs = query.toString()
  return qs ? `${path}?${qs}` : path
}

/** `{ expires, signature }` for a relative path, valid for `minutes` */
export function signPath(path: string, minutes: number): { expires: string; signature: string } {
  const expires = String(Math.floor(Date.now() / 1000) + minutes * 60)
  const signature = hmac(canonical(path, new URLSearchParams({ expires })))
  return { expires, signature }
}

/** 'valid' | 'expired' | 'invalid' for a request path + its query parameters */
export function verifySignedPath(path: string, params: URLSearchParams): 'valid' | 'expired' | 'invalid' {
  const signature = params.get('signature') ?? ''
  if (!signature || !safeEqual(hmac(canonical(path, params)), signature)) return 'invalid'

  const expires = Number(params.get('expires'))
  if (params.has('expires') && (!Number.isFinite(expires) || expires * 1000 < Date.now())) return 'expired'

  return 'valid'
}
