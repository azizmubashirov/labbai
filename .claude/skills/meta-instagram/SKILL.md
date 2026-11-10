---
name: meta-instagram
description: Verified Meta platform constraints for Instagram messaging and comment automation in Labbai — App Review and access levels, per-account webhook subscription, single-callback routing, private replies, messaging windows, and loop/dedup pitfalls. Read before designing or changing anything under triggers/instagram, lib/webhooks/providers/instagram.ts, tools/instagram, or the Inbox Instagram channel.
---

# Meta and Instagram constraints

Labbai uses the **Instagram API with Instagram Login**: `graph.instagram.com`, OAuth provider `instagram`, scopes in `apps/labbai/lib/oauth/oauth.ts`. Facebook Page tokens are not part of this flow.

## Access and app mode

- **Webhook fields need Advanced Access.** Fields such as `comments` and `live_comments` require Advanced Access, which means App Review, and the app must be **Live**. In development mode, events reach only accounts that hold an app role (admin, developer or tester) and have accepted the invite, and even that delivery is not guaranteed.
- **Messaging needs `instagram_business_manage_messages`, comments need `instagram_business_manage_comments`.** Review requires a screencast of the real flow and a privacy policy. Business Verification is usually needed as well.
- **The account must be a professional account** (Business or Creator) and **public**. The owner must turn on *Settings → Messages → Connected tools → Allow access to messages* in the Instagram app.

## Webhook delivery

- **One Meta app has exactly one callback URL.** Every connected account's events arrive at that URL. Route each delivery by `entry[].id`, the Instagram professional account ID, to the workspace or workflow that owns that account. Never let a workflow act on an `entry.id` that is not its own credential's account.
- **Every account must be subscribed separately**, or Meta sends nothing for it:
  `POST https://graph.instagram.com/<version>/<ig-user-id>/subscribed_apps?subscribed_fields=messages,comments` with that account's token. Check the result with `GET .../subscribed_apps`. Subscribe on deploy or connect, and unsubscribe on undeploy. The provider hook for this is `createSubscription`/`deleteSubscription` in `lib/webhooks/providers/types.ts`.
- **Payload shapes:**
  - DMs: `entry[].messaging[]` with `sender.id`, `recipient.id`, `message.mid`, `message.text`, `attachments` and `reply_to`. Story replies carry `reply_to.story`. Story mentions arrive as an attachment of type `story_mention`. Echoes have `message.is_echo`.
  - Comments: `entry[].changes[]` with `field: "comments"` (or `"live_comments"`), and in `value`: `id` (the comment ID), `text`, `from { id, username }`, `media { id, media_product_type }`, and `parent_id` for replies.
- **Your own replies come back as events.** A public reply the account posts produces a `comments` event with `from.id === entry.id`, and a DM it sends produces an echo. Drop both, or the automation answers itself in a loop.
- **Dedup on the comment ID or message `mid`.** Meta retries deliveries.
- **Signatures.** `X-Hub-Signature-256` is an HMAC-SHA256 of the raw body with the app secret. The handshake is a GET with `hub.mode`, `hub.verify_token` and `hub.challenge`. See `lib/webhooks/providers/meta.ts`.

## Replying

- **Public reply:** `POST /<comment-id>/replies` with `message`.
- **Private reply** (DM in answer to a comment): `POST /<ig-user-id>/messages` with `recipient: { comment_id }`. You get **one private reply per comment**, and it must be sent **within 7 days** of the comment.
- **Messaging window:** a private reply does **not** open the 24-hour window. The window opens when the user writes back, or taps a postback or quick-reply button. A URL button does not open it. Inside the window, normal `recipient: { id }` messages work.
- **Message formats:** text messages are limited to about 1,000 characters (about 640 with buttons). Which rich formats a private reply may carry (quick replies, button or generic templates) must be checked against Meta's current docs before relying on them.
- **Rate limits:** treat private-reply volume as rate limited. Queue and pace sends instead of firing them all at once, and back off on error codes that signal throttling.

## Media for pickers

- **Fields to request:** `GET /<ig-user-id>/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp`.
- **Use `thumbnail_url` for VIDEO and REELS.** For those types `media_url` is the video file, not an image.
- **Do not store CDN URLs.** They expire, so fetch them fresh. The app CSP allows `https:` images.
