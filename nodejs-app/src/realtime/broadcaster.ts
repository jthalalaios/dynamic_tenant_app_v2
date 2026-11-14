import { Emitter } from '@socket.io/redis-emitter'
import { config } from '../config/index.ts'
import type { Ctx } from '../support/context.ts'
import { redis } from '../support/redis.ts'
import { CHANNEL_EVENT, type ChannelEvent } from './channels.ts'

/**
 * Publishes chat events to the websocket server right away, without letting a
 * websocket outage fail the request: the change is already saved, and clients
 * resync from the API when they reconnect.
 *
 * Drivers: `redis` (Socket.IO redis emitter → the realtime container), `log`,
 * `null`. Tests install an ArrayBroadcaster to assert on what was sent.
 */
export interface PublishedEvent extends ChannelEvent {
  /** Socket that must not receive it (the sender, who has the HTTP response) */
  except: string | null
}

export interface Broadcaster {
  publish(event: PublishedEvent): void | Promise<void>
}

export class RedisBroadcaster implements Broadcaster {
  private emitter: Emitter | null = null

  publish({ channel, event, data, except }: PublishedEvent): void {
    this.emitter ??= new Emitter(redis())
    const target = except ? this.emitter.to(channel).except(except) : this.emitter.to(channel)
    target.emit(CHANNEL_EVENT, { channel, event, data } satisfies ChannelEvent)
  }
}

export class LogBroadcaster implements Broadcaster {
  publish(event: PublishedEvent): void {
    console.info(`[broadcast] ${event.channel} ${event.event} ${JSON.stringify(event.data)}`)
  }
}

export class NullBroadcaster implements Broadcaster {
  publish(): void {}
}

export class ArrayBroadcaster implements Broadcaster {
  readonly events: PublishedEvent[] = []

  publish(event: PublishedEvent): void {
    this.events.push(event)
  }

  clear(): void {
    this.events.length = 0
  }
}

let instance: Broadcaster | null = null

export function broadcaster(): Broadcaster {
  if (!instance) {
    instance = config.broadcast === 'redis' ? new RedisBroadcaster() : config.broadcast === 'log' ? new LogBroadcaster() : new NullBroadcaster()
  }
  return instance
}

export function setBroadcaster(next: Broadcaster | null): void {
  instance = next
}

/** Socket.IO ids: 20 url-safe base64 characters; anything else is ignored */
export function validSocketId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null
}

/**
 * Publish an event; by default to everyone but the sender's own socket (X-Socket-ID),
 * which already has the result from the HTTP response.
 */
export async function broadcast(ctx: Ctx, channel: string, event: string, data: unknown, toOthers = true): Promise<void> {
  try {
    await broadcaster().publish({ channel, event, data, except: toOthers ? ctx.socketId : null })
  } catch (error) {
    console.error('[broadcast] failed', error)
  }
}
