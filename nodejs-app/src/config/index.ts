import { env, envBool, envInt, envList } from './env.ts'

/**
 * Application configuration (the port of Laravel's config/*.php).
 *
 * Built from the environment once; `config` is a plain mutable object so tests can
 * flip a setting (like Laravel's `config([...])`) and `resetConfig()` restores it.
 */
function build() {
  const frontendUrl = env('FRONTEND_URL', 'http://localhost:5273')
  const frontendDoctor = env('FRONTEND_URL_DOCTOR')
  const frontendMarketplace = env('FRONTEND_URL_MARKETPLACE')

  return {
    app: {
      name: env('APP_NAME', 'Workspace'),
      /** local | production | testing */
      env: env('APP_ENV', 'production'),
      key: env('APP_KEY'),
      url: env('APP_URL', 'http://localhost:3000').replace(/\/+$/, ''),
      frontendUrl: frontendUrl.replace(/\/+$/, ''),
      /** Storage and API timezone: everything is stored in UTC */
      timezone: 'UTC',
      locale: env('APP_LOCALE', 'en'),
      port: envInt('PORT', 3000),
      logLevel: env('LOG_LEVEL', 'info'),
      /** proxy-addr list (nginx); empty = trust nobody */
      trustedProxies: envList('TRUSTED_PROXIES'),
      bcryptRounds: envInt('BCRYPT_ROUNDS', 12)
    },

    database: {
      host: env('DB_HOST', '127.0.0.1'),
      port: envInt('DB_PORT', 5432),
      database: env('DB_DATABASE', 'nodejs-react-app'),
      user: env('DB_USERNAME', 'postgres'),
      password: env('DB_PASSWORD'),
      poolMax: envInt('DB_POOL_MAX', 10)
    },

    redis: {
      host: env('REDIS_HOST', '127.0.0.1'),
      port: envInt('REDIS_PORT', 6379),
      password: env('REDIS_PASSWORD') || undefined
    },

    /** redis | memory */
    cacheStore: env('CACHE_STORE', 'memory'),

    /** redis | log | null */
    broadcast: env('BROADCAST_CONNECTION', 'log'),

    realtime: {
      port: envInt('REALTIME_PORT', 6001),
      /** Hostnames allowed to open a websocket; ['*'] = any */
      allowedOrigins: envList('REALTIME_ALLOWED_ORIGINS', '*'),
      /** Members may send client events (typing whispers) on presence channels they joined */
      acceptClientEvents: true
    },

    mail: {
      /** smtp | log | array */
      mailer: env('MAIL_MAILER', 'log'),
      scheme: env('MAIL_SCHEME', 'smtp'),
      host: env('MAIL_HOST', '127.0.0.1'),
      port: envInt('MAIL_PORT', 2525),
      username: env('MAIL_USERNAME'),
      password: env('MAIL_PASSWORD'),
      fromAddress: env('MAIL_FROM_ADDRESS', 'hello@example.com'),
      fromName: env('MAIL_FROM_NAME', env('APP_NAME', 'Workspace'))
    },

    cors: {
      // Comma separated list; defaults to the multi SPA plus any standalone theme frontends
      allowedOrigins: envList(
        'CORS_ALLOWED_ORIGINS',
        [frontendUrl, frontendDoctor, frontendMarketplace].filter(Boolean).join(',')
      ).map((url) => url.replace(/\/+$/, '')),
      exposedHeaders: ['Content-Language', 'Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
      maxAge: 3600
    },

    tenancy: {
      // Locales the API can answer in; the first one is the fallback
      locales: ['en', 'el'] as string[],

      presence: {
        // Minutes without a heartbeat after which an open session no longer counts as online
        timeoutMinutes: envInt('PRESENCE_TIMEOUT_MINUTES', 5)
      },

      /*
       | Themes (tenant types) this backend serves. One backend can power a single
       | "multi" frontend (theme picker), several standalone frontends (one per
       | theme), or both at once.
       |
       | - enabled:      empty = every TenantType. A standalone deployment sets TENANCY_THEMES=doctor.
       | - header:       standalone frontends send it; auth endpoints (login, register,
       |                 forgot password) then only act on accounts of that theme and
       |                 tokens of another theme are refused.
       | - frontendUrls: where emailed links (reset password, verify email) point for
       |                 accounts of each theme; falls back to app.frontendUrl.
       */
      themes: {
        enabled: envList('TENANCY_THEMES'),
        header: 'x-app-theme',
        frontendUrls: {
          doctor: frontendDoctor,
          marketplace: frontendMarketplace
        } as Record<string, string>
      },

      /*
       | One workspace (organization) per theme. Everyone who signs up joins the
       | workspace of the theme they pick, as a `registration.role` member; an
       | administrator then promotes them on the Team page. Missing workspaces
       | are created on demand (tenancy/workspaces.ts).
       */
      workspaces: {
        doctor: {
          slug: env('TENANCY_DOCTOR_WORKSPACE', 'acme-clinic'),
          name: env('TENANCY_DOCTOR_WORKSPACE_NAME', 'Acme Clinic')
        },
        marketplace: {
          slug: env('TENANCY_MARKETPLACE_WORKSPACE', 'acme-market'),
          name: env('TENANCY_MARKETPLACE_WORKSPACE_NAME', 'Acme Market')
        },
        // Used when a workspace has to be created
        timezone: env('TENANCY_WORKSPACE_TIMEZONE', 'Europe/Athens')
      } as { doctor: { slug: string; name: string }; marketplace: { slug: string; name: string }; timezone: string },

      registration: {
        // System role (config/permissions.ts) given to self-registered users
        role: 'member'
      },

      auth: {
        // Lifetime of issued personal access tokens
        tokenTtlMinutes: envInt('AUTH_TOKEN_TTL_MINUTES', 60 * 12),
        tokenName: 'spa',
        // When true, unverified users can sign in but only reach their own session
        // endpoints (me, profile, logout, resend verification) until they verify.
        verifyEmail: envBool('AUTH_VERIFY_EMAIL', true),
        verificationTtlMinutes: envInt('AUTH_VERIFICATION_TTL_MINUTES', 60 * 24),
        // Password reset links
        passwordResetExpireMinutes: 60,
        passwordResetThrottleSeconds: 60
      },

      pagination: {
        default: 15,
        max: 100
      }
    },

    permissionsCacheTtl: envInt('PERMISSIONS_CACHE_TTL', 3600)
  }
}

export type AppConfig = ReturnType<typeof build>

export const config: AppConfig = build()

/** Restore every value from the environment (tests) */
export function resetConfig(): void {
  const fresh = build()
  for (const key of Object.keys(fresh) as (keyof AppConfig)[]) {
    ;(config as Record<string, unknown>)[key] = fresh[key]
  }
}

export function isProduction(): boolean {
  return config.app.env === 'production'
}

export function isLocal(): boolean {
  return config.app.env === 'local'
}
