import nodemailer, { type Transporter } from 'nodemailer'
import { config } from '../config/index.ts'

/**
 * Outgoing mail. Transports: `smtp` (nodemailer), `log` (prints the message,
 * the development default) and `array` (kept in memory, for tests).
 */
export interface MailMessage {
  to: string
  from: { name: string; address: string }
  subject: string
  html: string
  text: string
}

export interface Mailer {
  send(message: MailMessage): Promise<void>
}

/** The mail server is unreachable or refused the message (SMTP down, bad credentials...) */
export class MailTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'MailTransportError'
  }
}

export class ArrayMailer implements Mailer {
  readonly sent: MailMessage[] = []
  /** Set to make every send fail like an SMTP outage */
  failWith: Error | null = null

  async send(message: MailMessage): Promise<void> {
    if (this.failWith) throw new MailTransportError(this.failWith.message, { cause: this.failWith })
    this.sent.push(message)
  }

  clear(): void {
    this.sent.length = 0
    this.failWith = null
  }
}

export class LogMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    console.info(
      [
        '[mail] ----------------------------------------------------------------',
        `From: ${message.from.name} <${message.from.address}>`,
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        '',
        message.text,
        '-----------------------------------------------------------------------'
      ].join('\n')
    )
  }
}

export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter

  constructor() {
    const { host, port, username, password, scheme } = config.mail
    this.transporter = nodemailer.createTransport({
      host,
      port,
      // smtps = implicit TLS (465); smtp upgrades with STARTTLS when the server offers it
      secure: scheme === 'smtps',
      auth: username ? { user: username, pass: password } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000
    })
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: { name: message.from.name, address: message.from.address },
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text
      })
    } catch (error) {
      throw new MailTransportError(error instanceof Error ? error.message : String(error), { cause: error })
    }
  }
}

let instance: Mailer | null = null

export function mailer(): Mailer {
  if (!instance) {
    instance = config.mail.mailer === 'smtp' ? new SmtpMailer() : config.mail.mailer === 'array' ? new ArrayMailer() : new LogMailer()
  }
  return instance
}

export function setMailer(next: Mailer | null): void {
  instance = next
}
