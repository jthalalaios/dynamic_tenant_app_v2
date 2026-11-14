import type { FastifyInstance } from 'fastify'
import { config, isLocal } from '../../config/index.ts'
import { db } from '../../db/database.ts'
import { isTenantType } from '../../domain/enums.ts'
import { buildMail, mailLocaleFor, resetUrl, verificationUrl } from '../../mail/notifications.ts'
import { supportedLocale } from '../../support/i18n.ts'

export async function webRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async () => ({ name: config.app.name, api: '/api/v1' }))

  // Health check (Docker): the server only listens once the migrations succeeded
  app.get('/up', async () => ({ status: 'ok' }))

  /**
   * Local development only: preview the branded emails, rendered for a real account
   * of the theme. Nothing is sent.
   *
   *   /dev/mail/verify-email/doctor
   *   /dev/mail/reset-password/marketplace?lang=el
   *   /dev/mail/verify-email/doctor?format=text
   */
  if (!isLocal()) return

  app.get<{ Params: { template: string; theme: string }; Querystring: { lang?: string; format?: string } }>(
    '/dev/mail/:template/:theme',
    async (request, reply) => {
      const { template, theme } = request.params
      if (template !== 'verify-email' && template !== 'reset-password') return reply.code(404).send({ message: 'Unknown template.' })
      if (!isTenantType(theme)) return reply.code(404).send({ message: 'Unknown theme.' })

      const row = await db()
        .selectFrom('users')
        .innerJoin('tenants', 'tenants.id', 'users.tenant_id')
        .selectAll('users')
        .where('tenants.type', '=', theme)
        .orderBy('users.id')
        .executeTakeFirst()
      if (!row) return reply.code(404).send({ message: `No ${theme} account to preview with. Run the demo seeder first.` })

      const tenant = await db().selectFrom('tenants').selectAll().where('id', '=', row.tenant_id!).executeTakeFirstOrThrow()
      const locale = supportedLocale(request.query.lang) ? request.query.lang : mailLocaleFor(row, tenant, config.app.locale)
      const url = template === 'verify-email' ? verificationUrl(row, tenant) : resetUrl(row, tenant, 'preview-token')
      const mail = buildMail(row, tenant, template, url, locale)

      if (request.query.format === 'text') return reply.type('text/plain; charset=utf-8').send(mail.text)
      return reply.type('text/html; charset=utf-8').send(mail.html)
    }
  )
}
