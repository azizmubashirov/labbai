#!/usr/bin/env bun

/**
 * Points the platform notification bot (Settings → Notifications) at this deployment and says
 * what is wrong when the bot stays silent. Ported from Mehmon's `set_notification_webhook` and
 * `check_notification_bot` commands. Idempotent: Telegram overwrites the previous webhook.
 *
 * Usage (from apps/sim, with the deployment's env loaded — bun reads .env itself):
 *   bun run scripts/set-notification-webhook.ts            # register the webhook
 *   bun run scripts/set-notification-webhook.ts --check    # diagnose only, change nothing
 *   bun run scripts/set-notification-webhook.ts --url https://studio.labbai.uz
 *
 * Required environment variables:
 *   NOTIFICATION_BOT_TOKEN            Bot token from @BotFather
 *   NOTIFICATION_BOT_USERNAME         The bot's username, without @
 *   NOTIFICATION_BOT_WEBHOOK_SECRET   A-Z a-z 0-9 _ - only (e.g. `openssl rand -hex 24`)
 *   NEXT_PUBLIC_APP_URL               Public https URL of the app (or pass --url)
 *
 * The webhook is `<app url>/api/notifications/telegram/<secret>`, registered with the same
 * secret as Telegram's `secret_token`, so the route checks both.
 */

const SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/

interface TelegramReply {
  ok?: boolean
  description?: string
  result?: Record<string, unknown>
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function telegram(
  token: string,
  method: string,
  body?: Record<string, unknown>
): Promise<TelegramReply> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return (await response.json().catch(() => ({}))) as TelegramReply
}

async function main(): Promise<number> {
  const token = process.env.NOTIFICATION_BOT_TOKEN?.trim() ?? ''
  const username = (process.env.NOTIFICATION_BOT_USERNAME?.trim() ?? '').replace(/^@/, '')
  const secret = process.env.NOTIFICATION_BOT_WEBHOOK_SECRET?.trim() ?? ''
  const appUrl = (argValue('--url') ?? process.env.NEXT_PUBLIC_APP_URL ?? '')
    .trim()
    .replace(/\/+$/, '')
  const checkOnly = process.argv.includes('--check')
  const problems: string[] = []

  if (!token) problems.push('NOTIFICATION_BOT_TOKEN is empty: the bot cannot send anything.')
  if (!username) problems.push('NOTIFICATION_BOT_USERNAME is empty: connect links cannot be built.')
  if (!secret) {
    problems.push('NOTIFICATION_BOT_WEBHOOK_SECRET is empty: the webhook answers every call 404.')
  } else if (!SECRET_PATTERN.test(secret)) {
    problems.push(
      'NOTIFICATION_BOT_WEBHOOK_SECRET may only contain A-Z a-z 0-9 _ - (Telegram rule; it is also a URL path segment).'
    )
  }
  if (!appUrl.startsWith('https://')) {
    problems.push(`The app URL must be public https for Telegram to reach it (got "${appUrl}").`)
  }
  if (problems.length > 0 || !token) return report(problems)

  const expected = `${appUrl}/api/notifications/telegram/${secret}`

  const me = await telegram(token, 'getMe')
  if (!me.ok) return report([`getMe failed (${me.description ?? 'no answer'}): the token is wrong.`])
  const realUsername = String(me.result?.username ?? '')
  console.log(`Bot: @${realUsername}`)
  if (realUsername.toLowerCase() !== username.toLowerCase()) {
    problems.push(
      `NOTIFICATION_BOT_USERNAME is "${username}" but the token belongs to "@${realUsername}": connect links point at the wrong bot.`
    )
  }

  if (!checkOnly) {
    const set = await telegram(token, 'setWebhook', {
      url: expected,
      secret_token: secret,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    })
    if (!set.ok) return report([...problems, `setWebhook failed: ${set.description ?? 'no answer'}`])
    console.log(`Webhook set → ${appUrl}/api/notifications/telegram/<secret>`)
  }

  const info = (await telegram(token, 'getWebhookInfo')).result ?? {}
  const registered = String(info.url ?? '')
  if (!registered) {
    problems.push('No webhook is registered: run this script without --check.')
  } else if (registered !== expected) {
    problems.push(
      'The registered webhook is not this deployment’s URL (different app URL or secret). Run this script without --check here.'
    )
  }
  if (typeof info.last_error_message === 'string' && info.last_error_message) {
    problems.push(
      `Telegram's last delivery failed: ${info.last_error_message}. A 404 means the secret differs from this server's; a timeout means the URL is not reachable from outside.`
    )
  }
  console.log(`Pending updates: ${String(info.pending_update_count ?? 0)}`)
  return report(problems)
}

function report(problems: string[]): number {
  if (problems.length === 0) {
    console.log('Everything checks out. Send /start to the bot: it should answer with its welcome.')
    return 0
  }
  console.error(`${problems.length} problem(s):`)
  problems.forEach((problem, index) => console.error(`  ${index + 1}. ${problem}`))
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })

export {}
