import { db } from '../db/database.ts'
import { provisionDefaultRooms } from '../services/chat/chatService.ts'
import { tenantContext } from '../support/context.ts'

/**
 * Demo rooms and a short conversation for the demo clinic and shop.
 * Idempotent, and safe to run on its own: `node src/cli.ts db:seed --class=ChatDemoSeeder`.
 *
 * Messages are written directly (not through the chat service) so seeding never
 * needs the websocket server.
 */
const DEMO: Record<string, { room: { slug: string; name: string; icon: string; description: string }; messages: [string, string, string][] }> = {
  'acme-clinic': {
    room: { slug: 'front-desk', name: 'Front desk', icon: 'calendar', description: 'Arrivals, delays and walk-ins.' },
    messages: [
      ['admin@clinic.test', 'announcements', 'Welcome to the clinic chat! Please keep patient details out of the open rooms.'],
      ['reception@clinic.test', 'general', 'Good morning everyone ☀️'],
      ['doctor@clinic.test', 'general', 'Morning! I am running ten minutes late after rounds.'],
      ['reception@clinic.test', 'front-desk', 'Two walk-ins waiting, I have put them on the list.'],
      ['admin@clinic.test', 'general', 'Thanks both, coffee is on me today.'],
      ['doctor@clinic.test', 'doctors', 'Can someone cover my 15:00 follow-up?'],
      ['admin@clinic.test', 'doctors', 'I will take it, Bob.'],
      ['admin@clinic.test', 'admins', 'Reminder: review the new roles before Friday.']
    ]
  },
  'acme-market': {
    room: { slug: 'sales-floor', name: 'Sales floor', icon: 'shopping-cart', description: 'Orders, stock and customer questions.' },
    messages: [
      ['admin@market.test', 'announcements', 'Flash sale starts Friday at 10:00. Stock up on headphones!'],
      ['sales@market.test', 'general', 'Hi team 👋'],
      ['manager@market.test', 'sales-floor', 'The Voyager backpack is out of stock, please offer the Aurora bundle instead.'],
      ['sales@market.test', 'sales-floor', 'Got it, thanks Max.'],
      ['manager@market.test', 'managers', 'Weekly stock count moves to Thursday.'],
      ['admin@market.test', 'admins', 'Quarterly numbers are in, looking good.']
    ]
  }
}

export async function runChatDemoSeeder(): Promise<void> {
  for (const [slug, demo] of Object.entries(DEMO)) {
    const tenant = await db().selectFrom('tenants').selectAll().where('slug', '=', slug).where('deleted_at', 'is', null).executeTakeFirst()
    if (!tenant) continue

    // Global, Announcements, Admins and the theme's role rooms (idempotent, by slug)
    await provisionDefaultRooms(tenantContext(tenant))
    await db()
      .insertInto('chat_rooms')
      .values({ tenant_id: tenant.id, ...demo.room })
      .onConflict((oc) => oc.columns(['tenant_id', 'slug']).doNothing())
      .execute()

    const seeded = await db().selectFrom('chat_messages').select('id').where('tenant_id', '=', tenant.id).executeTakeFirst()
    if (seeded) continue

    const rooms = new Map(
      (await db().selectFrom('chat_rooms').select(['id', 'slug']).where('tenant_id', '=', tenant.id).execute()).map((r) => [r.slug, r.id])
    )
    const users = new Map(
      (await db().selectFrom('users').select(['id', 'email']).where('tenant_id', '=', tenant.id).execute()).map((u) => [u.email, u.id])
    )

    const now = Date.now()
    for (const [i, [email, room, body]] of demo.messages.entries()) {
      const userId = users.get(email)
      const roomId = rooms.get(room)
      if (userId === undefined || roomId === undefined) continue

      // Backdated, so the demo conversation reads like the morning's chat
      const createdAt = new Date(now - (demo.messages.length - i) * 7 * 60_000)
      await db()
        .insertInto('chat_messages')
        .values({ tenant_id: tenant.id, room_id: roomId, user_id: userId, body, created_at: createdAt, updated_at: createdAt })
        .execute()
    }
  }
}
