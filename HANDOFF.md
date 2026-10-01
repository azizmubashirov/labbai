# Labbai — handoff (2026-09-26)

Read `LABBAI_PLAN.md` first: it is the source of truth for every product decision.
This file is the operational state for whoever continues the work.

## What Labbai is

Fork of Sim v0.8.59 (simstudioai/sim, Apache-2.0) + Arena's local AI copilot
(`apps/labbai/local-copilot`), rebranded later as Labbai. We do NOT sync with upstream Sim.
Owner wants: **cleanup only for now, no new features**, then the owner tests it.

## Branches

- `main` — all cleanup steps done (see table). CI: tsc clean, whole vitest suite green (35 717 tests), next build OK; deployed to the test server 2026-09-26.
- `wip/ee-cleanup`, `claude/peaceful-maxwell-vbuk8b` — merged into `main`; can be deleted.
- `ci-reports`, `ci-build-report` — written by CI (see below). `arena-base` — old Arena code backup.

## Cleanup status (see LABBAI_PLAN.md "Order of work")

| Step | Status |
|---|---|
| 1 Docs, landing, desktop, CLI/SDK, helm, PII, sandboxes (JS-only Function), Pi/A2A/Mothership/video blocks, enrichments, Sim Mailer | done |
| 2 Integrations trimmed to ~10% (list in LABBAI_PLAN.md) | done |
| 3 Stripe and all payments removed; entitlements permissive; cost ledger kept | done |
| 4 LLM: OpenAI only (gpt-5.5, gpt-5-mini default, gpt-4.1, gpt-4.1-mini, text-embedding-3-small); transport switchable to Cloudflare AI Gateway (see "Cloudflare AI Gateway") | done |
| 6 Remove `apps/labbai/ee`; access control, audit logs, credential groups, access requests, SCIM re-implemented clean-room (`lib/labbai/**`), always on | done |
| 7 Organization UI layer (`/o/**`), Sim Search, org Search MCP, org Assistant removed; kept org-backed features live in workspace settings; DB tables kept | done |
| + Sim cloud copilot path (Go mothership client, BYOK/API-key routes) and Local/Cloud switch removed — local copilot only | done |
| + Telemetry only to our own `TELEMETRY_ENDPOINT`; off when unset | done |
| Branding, part 1: name, text logo, favicons, email header, copy, agent identity | done (see below) |
| Branding, part 2: UZ/RU interface (i18n) + real logo | todo — owner: at the very end |
| Inbox (customer conversations from Telegram / WhatsApp / Instagram) | done (see below) |
| Notifications (operator alerts via one platform Telegram bot) | phase 1 done (see below); alert buttons later |
| Telegram Business (agent answers in the owner's own Telegram account) | coded 2026-09-29 (see below); verify in CI and with a real Premium account |

LICENSE RULE (critical): `apps/labbai/ee` was under the Sim Enterprise License. Never read,
copy or restore `ee` source from git history. Requirements come only from Apache code.

### Known leftovers (harmless, optional follow-ups)

- Unreachable assistant/org branches: `requestMode === 'assistant'` in `tools/index.ts`,
  `executor/utils/credential-token.ts`, `application-delegation.ts`, org plumbing in
  `lib/copilot/request/lifecycle/{start,run}.ts`, `chat-status.ts` org owner.
  `mode: 'assistant'` is rejected at the boundary (`lib/copilot/chat/post.ts`,
  `lib/copilot/request/lifecycle/run.ts`) but still listed in `COPILOT_REQUEST_MODES`;
  removing it touches the credential path in `tools/index.ts` — do it as its own change.
- `fileId` selector-context key no kept block supplies; connect-OAuth modal
  "OAuth app configuration" fields (QuickBooks-only); `TRIGGER_ROUTING_FIELD` write guard
  (no trigger emits it any more).
- Biome: one `noDelete` in `lib/labbai/scim/protocol/group-patch.ts` (unsafe fix would keep
  the key as `undefined` — check SCIM semantics before changing).

### Branding (2026-09-26)

Owner decisions: text logo for now, keep the current colors, no support email or domain yet,
UZ/RU translation later as its own step.

- Brand config `lib/branding/defaults.ts`: name `Labbai`, no support email; terms/privacy
  links come from `NEXT_PUBLIC_TERMS_URL` / `NEXT_PUBLIC_PRIVACY_URL` and are hidden while
  unset (auth pages, email footer). `security.txt` returns 404 until a support email exists.
- Logo: "Labbai" wordmark outlined from Inter SemiBold (SIL OFL) in
  `packages/emcn/src/components/labbai-wordmark/paths.ts`; app mark (green square with a white
  "L") in `packages/emcn/src/icons/labbai.tsx`; favicons, `icon.svg`, email `wordmark.png`,
  `public/logo/wordmark.svg`. Components: `LabbaiWordmark`, `Labbai` (icon). To swap in a
  real logo later: replace those files and `EMAIL_WORDMARK_*` in `lib/branding/wordmark.ts`.
- Copy: product name in UI, emails, API/OpenAPI descriptions, MCP server, tool/trigger help
  text, agent identity ("Labbai" instead of "Arena Copilot"/"Sim").
- Removed: Sim social links/address in the email footer and their `/x`, `/github`, … redirects;
  Sim status-page notice; old Sim logo files. Logo links on chat and shared-file pages now open
  the app instead of sim.ai. `README.md` rewritten; `NOTICE` keeps the Sim attribution.
- Fonts: `public/brand/fonts` holds Season Sans and Söhne from Sim — commercial fonts,
  check the license before production use (Inter is the free alternative).
- Pre-existing, not from branding: `bun run check:mcp-operations` fails on `main` (the
  access-requests discovery schema lacks a description).

### Sim name removed from the code (2026-09-29)

- `apps/sim` → `apps/labbai`; workspace packages `@sim/*` → `@labbai/*` (root package
  `simstudio` → `labbai`); GHCR images `labbai-sim-{simstudio,…}` → `labbai-{app,realtime,migrations,cron}`;
  prod compose service `simstudio` → `app` (network aliases `labbai-app` / `labbai-realtime` unchanged).
- Sim-named identifiers/files renamed (`SimWordmark` → `LabbaiWordmark`, `lib/sim-search` →
  `lib/labbai-search`, `sim-auth-adapter` → `labbai-auth-adapter`, `SIM_*` constants → `LABBAI_*`, …),
  product word "Sim" → "Labbai" in comments, strings, prompts and docs; `docs.sim.ai` links and
  "view docs" affordances dropped; sim.ai hosted-mode checks neutralised (always false on our domain).
- Kept on purpose (persisted or on the wire): DB name `simstudio`, tables/columns/enums, migrations,
  `SIM_*` env var names, `NEXT_PUBLIC_*`, `X-Sim-*` HTTP headers, `SimApiKey` auth scheme,
  protocol values `'sim'` (copilot executor/route, trigger provider, `sim:` link scheme, `sim`
  sandbox global), block/trigger ids (`sim_workspace_event`, `triggers/sim`), `sk-sim-` API key
  prefix, `x-sim-*` MIME/drag types, generated mothership contracts (`lib/copilot/generated/*`).
- Server: copy the new `docker-compose.prod.yml` + `deploy.sh`; the next deploy pulls the new
  image names and `--remove-orphans` drops the old `labbai-simstudio-1` container.

### Inbox (2026-09-27)

Owner: the section is called **Inbox** (not "Chat"). Sidebar → Inbox, route `/workspace/[id]/inbox`.

- Data: `inbox_conversation` + `inbox_message` (migration `0381_labbai_inbox`, additive; verified by
  migrating a fresh Postgres 16 + pgvector 0.8 from 0000 to 0381).
- Inbound: `lib/webhooks/processor.ts` → `lib/inbox/webhook.ts` records every customer message from
  Telegram / WhatsApp / Instagram trigger deliveries (idempotent on provider message id) before
  preprocessing. If AI is off for every conversation in the delivery, the run is not queued and the
  provider still gets 200 (`reason: 'inbox-ai-off'`). Recording errors are logged, never fail delivery.
- Agent messages: `tools/index.ts` `executeTool` → `lib/inbox/outbound.ts` appends successful
  `telegram_message` / `whatsapp_send_message` / `instagram_send_text_message` calls made inside a
  workflow run to the matching existing thread (no new threads for unknown chats).
- Operator replies: `lib/inbox/send.ts` sends through the trigger that last received the thread:
  Telegram bot token; WhatsApp needs the new optional **Access Token (for Inbox replies)** field on
  the WhatsApp trigger; Instagram uses the account selected on the new trigger. A rejected reply is
  stored as `failed` with the reason and shown in the thread.
- New trigger `instagram_webhook` (Instagram block → trigger mode): Meta handshake + app-secret
  signature, customer DMs only (echoes skipped). WhatsApp and Instagram share
  `lib/webhooks/providers/meta.ts`.
- API: `lib/api/contracts/inbox.ts`, `lib/inbox/application/*` (operations `inbox.conversations.*`,
  session-only, `capability: 'none'`; AI toggles and delivered replies are audited),
  routes under `app/api/workspaces/[id]/inbox/conversations/**`.
- UI: `app/workspace/[workspaceId]/inbox/*` — list (search, channel, unread filters), thread,
  AI on/off switch, reply box (Enter sends), "Load earlier messages" (100 per page, keyset on
  `(created_at, id)` via `?before=<messageId>`), unread badge on the sidebar Inbox item
  (`GET .../inbox/unread`).

#### Inbox completion (2026-09-28)

- Live updates: new realtime room `workspace-inbox` (`@labbai/realtime-protocol/rooms`, read access,
  workspace-scoped). `notifyWorkspaceInboxChanged` fires after inbound messages, agent sends,
  operator replies and AI/read toggles; `useWorkspaceInboxRoom` (mounted in the sidebar and the
  Inbox) invalidates lists, threads and the badge. Polling stays as fallback: 60 s while the
  socket is connected, 5 s when it is not (e.g. no realtime server).
- Media: `inbox_message.attachments` jsonb (migration `0382_labbai_inbox_attachments`, additive,
  default `[]`). Channel parsers keep media ids/links only (Telegram photo/voice/audio/video/
  document/sticker/location, WhatsApp image/audio+voice/video/document/sticker/location, Instagram
  attachment URLs); contacts, polls and reactions become text. Bytes are never stored:
  `GET .../messages/[messageId]/attachments/[index]` (`lib/inbox/media.ts`) streams from Telegram
  `getFile`, WhatsApp Graph media (needs the trigger access token) or the Instagram CDN link.
  Meta links are only followed to Meta media hosts (checked on every redirect); 50 MB cap;
  non-media types are served as downloads with a sandbox CSP. The thread renders images, video,
  audio/voice players, document chips and map links, with a fallback when the channel no longer
  has the file.
- Telegram webhooks now register a random `secret_token` on deploy (`providerConfig.secretToken`)
  and reject updates without the matching `X-Telegram-Bot-Api-Secret-Token` (401). Webhooks
  deployed before this have no stored secret and keep working until their next deploy.
- Instagram contacts: on a customer's first message the name/username is looked up with the
  trigger's Instagram account (`lib/inbox/instagram-profile.ts`, 3 s timeout, best effort).
- Reply errors in plain words (`friendlyChannelError`): Instagram/WhatsApp 24-hour window,
  blocked Telegram bot, deleted Telegram account, rejected credentials.
- Verified: tsc (sim, realtime, platform-authz, realtime-protocol, db), Biome, affected vitest
  suites (sim 197 files / 2403 tests, realtime 418), migration on real Postgres, SQL checks
  (keyset paging across equal timestamps, attachment round trip, unread count, contact fill),
  Telegram secret check through the real webhook route, and the UI in a browser (media, load
  earlier keeping scroll position, sidebar badge).
- Remaining limits: WhatsApp free-form replies and Instagram replies only inside Meta's
  24-hour window; one Telegram bot / Meta app per workflow (last deploy wins).

#### Operator media (2026-09-28)

Operators send photos, files and voice messages from the reply box (paperclip → pick a file,
removable preview, the text box becomes the caption; mic → tap to record, timer, Cancel / Send,
5 min max). Written without local builds: verify with CI (tsc + vitest) and in a browser, and
test real sends per channel before relying on it.

- API: same reply endpoint, `attachment: { fileName, contentType, data (base64), voice? }` in
  `replyToInboxConversationContract`; `text` is optional when a file is attached (caption ≤ 1024).
  JSON + base64 because internal routes are contract JSON routes and the app accepts request
  bodies up to 10 MB (Next.js proxy default) → **7 MB per file** (`INBOX_OPERATOR_FILE_MAX_BYTES`).
- `lib/inbox/application/conversations.ts` checks the size, converts a recording, stores the file
  (`lib/inbox/operator-media.ts` → `StorageService.uploadFile`, key
  `workspace/<ws>/inbox/<conversation>/…`, no `workspace_files` row, so it is not in Files and
  not counted in storage usage), sends, and saves the message with
  `attachments: [{ kind, mimeType, fileName, storageKey }]` (no migration: jsonb). Sent/failed,
  audit ("Replied to X on telegram (photo)") and realtime notify work as for text. The thread
  streams operator files from storage (`media.ts`, key must be under the conversation's prefix).
- Kinds: JPEG/PNG → photo; recordings → voice; everything else (other images, PDF, video,
  audio files…) → file/document.
- Telegram: multipart `sendPhoto` / `sendVoice` / `sendDocument` with caption. Voice needs
  OGG/Opus (MP3/M4A also accepted); anything else goes as a document.
- WhatsApp: upload to `/{phone-number-id}/media`, then send `image` / `audio` / `document` by
  media id (caption on image/document, `filename` on documents). Audio has no caption, so the
  text follows as a normal text message. Photos ≤ 5 MB. 24-hour window error is explained as for
  text; `131053` → "WhatsApp did not accept this file".
- Instagram: `POST graph.instagram.com/<ig-user>/messages` with
  `attachment: { type: image|audio|video|file, payload: { url } }`, token resolved as the operator
  (`resolveExecutorCredentialToken`, credential access enforced); the caption follows as a text
  message. **Meta downloads the file from a public link**: a 1-hour presigned URL, available only
  with cloud storage (S3 / Azure Blob / GCS, reachable from the internet). With local disk storage
  (the test server today, app URL `http://localhost:3300`) Instagram files fail with a clear
  message; text replies still work.
- Voice format: browsers record WebM/Opus (Chrome), OGG/Opus (Firefox) or MP4/AAC (Safari). The
  server converts with ffmpeg (already in `docker/app.Dockerfile`, via `lib/media/ffmpeg.ts`):
  → OGG/Opus for Telegram and WhatsApp, → M4A/AAC for Instagram. If ffmpeg fails the original is
  sent as a file instead of a voice note.
- If a caption sent as a follow-up fails, the message is marked failed with
  "The file was delivered, but the text was not: …".
- Not done: several files in one reply, drag-and-drop/paste, video notes, stickers, removing
  stored files when a workspace is deleted, files over 7 MB (would need the upload-session flow).
- Pre-existing check failures not from this work (not in CI): `check:api-validation:strict`,
  `check:utils`, `check:react-query` flag local-copilot code; `check:mcp-operations` fails on the
  access-requests schema.

#### Inbox block — AI off/on from a workflow (2026-09-28)

New block **Inbox** (`blocks/blocks/inbox.ts`, category `blocks` like Memory/Table — first-party,
so no catalog BlockMeta/docs; it is not in the Agent tool picker) with one tool `inbox_set_ai`
(`tools/inbox/`). The workflow equivalent of the operator's AI switch, e.g. an
`escalate_to_human` workflow (called by an Agent as a workflow tool) notifies operators on
Telegram, then turns AI off so the agent stops replying and the operator takes over.

- Fields: Operation (`Turn AI off` = `turn_ai_off` default / `Turn AI on` = `turn_ai_on`),
  Channel (`telegram` | `whatsapp` | `instagram`), Customer Chat ID (`chatId`, e.g.
  `<telegram.message.chat.id>`; WhatsApp numbers normalized to digits), advanced Account ID
  (`accountId`: bot id / phone number id / IG account id) when several accounts share the chat
  (without it the most recently active thread wins). Outputs: `found`, `conversationId`,
  `aiEnabled` (`found=false` and nulls when the chat has no conversation — not an error).
- Execution: in-process operation (`lib/internal/inbox/execute-tool.ts`, registered in
  `lib/internal/tool-operations/registry.server.ts`) → executor delegation principal (audience
  `sim:inbox`) → application use case `setInboxAiForChatOperation`
  (`lib/inbox/application/conversations.ts`, operation `inbox.conversations.ai.set`, write role,
  `delegated`/`executor` only). Same repository write, `notifyWorkspaceInboxChanged` and audit
  ("Turned off AI replies for …", only when the value changes) as the operator switch.
- Authorization: the workspace is never taken from block input — it is the delegation's
  workspace, bound from the executing workflow; the funnel rejects a mismatch and the lookup
  (`findInboxConversationByChat`) filters by it. Manual runs need write on the workspace;
  deployed (webhook/schedule) runs act for the workspace.
- The reply the agent is already producing in that run is still sent; the next customer
  messages are not queued while AI is off (existing `inbox-ai-off` gate).
- `tools/generated/tool-{ids,metadata,outputs}.ts` were updated by hand with a script that
  mirrors `scripts/sync-tool-metadata.ts` (pure insertion of `inbox_set_ai`); run
  `bun run tool-metadata:check` when bun is available.

### Notifications — operator alerts on Telegram (2026-09-28, phase 1)

Port of Mehmon's notifications module as a platform feature. One platform Telegram bot sends
alerts for every workspace; workspace owners never see its token. Written without local builds:
verify with CI (tsc + vitest) and a real bot before relying on it. Inline buttons on alerts
(resume / snooze / approve) are **phase 2, not built**.

**Per workflow, on the canvas (owner decision 2026-09-29).** Notifications are configured with a
**Notifications block** placed on an agent workflow's canvas — not in workspace Settings (that
section was removed). Each workflow has its own recipients and rules: a workspace with two agent
workflows can alert from one and stay silent in the other. A workflow without the block alerts
nobody; a conversation with no workflow alerts nobody.

- Env (server only, `lib/core/config/env.ts`, `.env.example`): `NOTIFICATION_BOT_TOKEN`,
  `NOTIFICATION_BOT_USERNAME` (without @), `NOTIFICATION_BOT_WEBHOOK_SECRET` (A-Z a-z 0-9 _ -,
  e.g. `openssl rand -hex 24`), optional `NOTIFICATION_MODEL` (default `gpt-4.1-mini`, judged on
  the platform `OPENAI_API_KEY` / `OPENAI_BASE_URL`). Token + username unset → the feature is off:
  the Notifications block shows a "not set up on this server" help text, every hook returns before
  touching the DB or the model, the Notify block fails with a clear error.
- Register the webhook once per deployment (and whenever the URL or secret changes), from
  `apps/labbai` with the deployment's env: `bun run scripts/set-notification-webhook.ts`
  (`--check` only diagnoses: token owner vs username, registered URL, Telegram's last delivery
  error; `--url https://studio.labbai.uz` overrides `NEXT_PUBLIC_APP_URL`). Without bun:
  `curl -X POST https://api.telegram.org/bot$NOTIFICATION_BOT_TOKEN/setWebhook -d url=https://studio.labbai.uz/api/notifications/telegram/$NOTIFICATION_BOT_WEBHOOK_SECRET -d secret_token=$NOTIFICATION_BOT_WEBHOOK_SECRET`.
  The URL must be public https (the prod tunnel already routes `studio.labbai.uz`).
- Bot (`lib/notifications/bot.ts`, route `app/api/notifications/telegram/[secret]`): the path
  secret must match (else 404) and Telegram's `X-Telegram-Bot-Api-Secret-Token`, when sent, too
  (else 403). `/start notify_<token>` connects that chat (private or group, `/start@bot` works) to
  the recipient row; bare `/start` → welcome (points to the Notifications block); `/stop` →
  deactivates that chat's recipients (of every workflow).
  Replies are Uzbek and say "Labbai". It never runs an agent or touches a conversation.
- Data (migration `0383_labbai_notifications`, additive; **no new migration** for the per-workflow
  move — `workflow_id` stays nullable in the schema, the code always sets and filters it; rows
  with a null workflow, e.g. from the removed Settings page, are ignored): `notification_recipient`
  (workspace, workflow, title, chat_id, connect_token, verified/active, connected_at),
  `notification_trigger` (name, direction inbound|outbound|event, condition, event_key,
  extract_spec, pause_mode none|temporary|hard, pause_minutes, auto_resume, pause_notice,
  cooldown_minutes, once_per_conversation, is_active, workflow), `notification_event`
  (audit + dedup source of truth; written before delivery so a failed send still counts), and
  `inbox_conversation.ai_paused_until`.
- **Notifications block** (`blocks/blocks/notifications.ts`, type `notifications`, category
  `blocks`, `singleInstance`, no tools / inputs / outputs). A configuration block like the Note:
  it has no ports, edges to or from it are dropped (`isWorkflowAnnotationOnlyBlockType` in
  `@labbai/workflow-types`, `isAnnotationOnlyBlock` in `executor/constants.ts`), it is in
  `METADATA_ONLY_BLOCK_TYPES` so the DAG builder skips it, lint does not call it an orphan, and
  "run from block" is off for it. Both fields are `type: 'modal'` sub-blocks (the existing
  custom-component slot, `sub-block/components/modal-registry.ts`), `hideFromCopilot` +
  `hideFromPreview`:
  - **Recipients** (`modalId: 'notification-recipients'`, no stored value): "Connect Telegram"
    creates a recipient of THIS workflow at once and shows `t.me/<bot>?start=notify_<token>` plus
    the group command; the list shows Connected / Pending / Stopped (polls every 5 s while one is
    pending) with copy link, send test message, remove. Needs write on the workspace (same as
    editing the workflow). Shows a help text when the bot is not configured on the server.
  - **Rules** (`modalId: 'notification-rules'`, value = `NotificationRule[]`,
    `lib/notifications/rules.ts`): add / edit (modal) / turn on-off / delete. Per rule: name, when
    (customer message | agent reply | workflow event), condition (message rules), event
    (operator_handoff | booking_link_sent | payment_receipt, event rules), details to extract,
    pause AI (none | for a while | until an operator), pause minutes, auto resume, pause notice,
    cooldown minutes, once per conversation, active. Max 10 per workflow. The value is versioned
    with the workflow like any field.
- **Deploy sync** (`lib/notifications/deploy-sync.ts`): rules only take effect from the deployed
  version — **change a rule → redeploy**, like the rest of the workflow. Inside the deployment's
  activation transaction (`lib/workflows/deployment-outbox.ts`, next to the MCP tool sync; also
  the legacy side-effect sync path) the enabled Notifications block's valid rules become the
  workflow's `notification_trigger` rows: replace-all per workflow and idempotent — rows no rule
  backs are deleted, the rest upserted under a deterministic id
  `ntr_<workflowId>_<blockId>_<ruleId>`, so a redeploy keeps each rule's alert history (cooldown /
  once-per-conversation survive; event rows cascade only when a rule is removed). Activating an
  older version syncs that version's rules. Undeploy (`performFullUndeploy`, inside the undeploy
  transaction) deletes the workflow's triggers. Removing the block and redeploying removes them
  too. Recipients are not touched by deploys (they belong to the workflow; deleting the workflow
  cascades them).
- Evaluation (`lib/notifications/{hooks,service,evaluator}.ts`): after each customer message
  recorded by `lib/inbox/webhook.ts` (inbound) and each agent send recorded by
  `lib/inbox/outbound.ts` (outbound), only the active triggers of that direction of the
  conversation's workflow (`inbox_conversation.workflow_id`) are judged in the background — fire-and-forget, errors
  logged, never blocking or failing delivery. Triggers already spent (once-per-conversation or
  inside the cooldown) are dropped before the model call; one JSON call (Mehmon's prompt, English)
  judges all remaining triggers and extracts the requested details; malformed output = no alert.
  The judge's cost goes to the usage ledger (source `workflow`, the conversation's workflow owner).
- On fire: an HTML alert (title, customer, channel, reason, details, pause line, "Chatni ochish"
  link to the Inbox thread) to every verified active recipient of the trigger's workflow — never
  another workflow's chats. Pause: `hard` (or `temporary` without auto-resume) = AI off
  until an operator turns it on; `temporary` = `ai_enabled=false` + `ai_paused_until`, AI answers
  again by itself after it (checked by the inbound AI-off gate; reads settle an expired pause, the
  thread header shows "AI paused until HH:mm"; any operator toggle clears it; never shortens a
  longer pause, never puts a clock on AI a person switched off). The first pausing trigger also
  sends its `pause_notice` to the customer through the Inbox reply path (as the workflow owner)
  and stores it as an agent message.
- Limit of fire-and-forget: the pause lands a moment after the message, so the agent run already
  queued for that same message still answers; the next messages are gated (like the Inbox block).
  The pause notice can therefore follow the agent's reply. Two messages judged at the same moment
  can both fire before either event row exists (no lock, as in Mehmon).
- Notify block (`blocks/blocks/notify.ts`, tool `notify_send`, `tools/notify/*`,
  `lib/internal/notifications/execute-tool.ts`, use case `notifications.workflow.notify`,
  delegation audience `sim:notifications`): Operation `Fire event` (Event: operator_handoff |
  booking_link_sent | payment_receipt; Message = optional reason) or `Send message` (Message
  required); Channel, Customer Chat ID (required for events, optional for messages), advanced
  Account ID. The conversation is resolved like the Inbox block, only inside the run's workspace.
  Outputs `found`, `conversationId`, `fired`, `delivered`, `paused`. **Scoped to the TOP-LEVEL
  workflow of the run** (the executor delegation's root `workflowId` — a child run keeps it and
  only swaps `currentWorkflow`; never an id from the input): Fire event uses that workflow's
  deployed event rules, Send message goes to that workflow's recipients. So one shared
  `escalate_to_human` child workflow, called as a tool by several agent workflows, alerts the
  calling agent's recipients with the calling agent's event rules; the child needs no
  Notifications block. Used directly in an agent workflow, the root is that workflow. Caveat: a
  child started over HTTP (a separate execution, e.g. the API) is its own root. An event only alerts
  when an event rule watches it (no rule → `fired = 0`). Generated tool files updated by hand
  (insertion of `notify_send`; its description was reworded on 2026-09-29 in `tools/notify/send.ts`
  and `tools/generated/tool-metadata.ts` alike); run `bun run tool-metadata:check` when bun is
  available.
- API (recipients only — rules have no API, they are block values synced on deploy):
  `lib/api/contracts/notifications.ts`, use cases `lib/notifications/application/recipients.ts`
  (operations `notifications.recipients.{list,create,delete,test}`, session-only, **write** role,
  the workflow must belong to the workspace), routes
  `app/api/workspaces/[id]/notifications/workflows/[workflowId]/recipients` (GET list + configured
  + bot username + limits, POST create), `.../recipients/[recipientId]` (DELETE),
  `.../recipients/[recipientId]/test` (POST). The workspace-wide settings/trigger routes and the
  Settings → Notifications page were removed.
- Limits: 10 rules and 20 recipients per workflow; only Telegram as alert channel; rules are not
  editable by Copilot (hidden fields); no alert history page yet (rows are in
  `notification_event`); no condition drafting / dry run (Mehmon phase 3) and no starter
  templates; alerts are not audited in the activity log. The canvas card shows only the block
  header (both fields are hidden from the card).

### Telegram Business (2026-09-29)

Owner decision: Telegram Business lives **inside** the existing Telegram trigger and Telegram
tools (one bot has one webhook), not in a separate trigger. Written without local builds: verify
with CI (tsc + vitest) and a real Telegram Premium account before relying on it. No migration.

How to enable:
1. Telegram trigger → **Messages to receive**: `Bot chats` (default, the old behaviour) |
   `Business chats` | `Both` (`providerConfig.messageSource`). Deploy (changing it redeploys the
   webhook; `setWebhook` now always sends `allowed_updates`: `[]` = Telegram's default set for bot
   chats, the three Business types for Business chats, message/edited/channel types + Business
   types for Both).
2. The account owner (Telegram **Premium** is required for Telegram Business) opens Telegram
   Settings → Telegram Business → Chatbots, adds the bot and allows it to reply, and picks which
   chats it serves.
3. In the replying Telegram block (advanced field **Business connection ID**) map
   `<telegram.businessConnectionId>`. Empty = normal bot send, so one workflow answers both kinds
   of chat. The copilot is told to do this.

Behaviour:
- Trigger output for a `business_message` is the same shape as a `message`, `updateType:
  'business_message'`, plus new outputs `businessConnectionId` ('' for bot chats) and `isBusiness`.
- `lib/webhooks/providers/telegram.ts`: `shouldSkipEvent` drops updates the "Messages to receive"
  setting does not cover (a bot-chats trigger ignores all Business updates, so a bot connected to
  Business by mistake no longer runs empty workflows); `matchEvent` calls
  `lib/inbox/telegram-business.ts#handleTelegramBusinessDelivery` for Business updates only.
  Pure rules are in `lib/webhooks/providers/telegram-business.ts`.
- `business_connection` updates are stored on the webhook row, `providerConfig.businessConnections
  [<id>] = { ownerUserId, ownerChatId, canReply (Bot API 9 rights.can_reply or legacy can_reply),
  isEnabled, updatedAt }` (atomic JSON merge; `businessConnections` is a system-managed key, so it
  never counts as a config change). A connection the row does not know yet (e.g. after a redeploy
  recreated the row) is looked up once with `getBusinessConnection` (3 s timeout) and stored. No
  workflow run. A customer message on a connection that is disabled or may not reply does not
  run the workflow (`business-cannot-reply`).
- Owner filter (Mehmon's rule): in a private chat the customer's user id is the chat id, so a
  Business message whose `from.id` differs from `chat.id` (or equals the stored owner id) was sent
  by the account itself and never runs the workflow — decided without the database, so a failed
  write can never make the AI answer the owner. Messages the bot itself sent through the
  connection (`sender_business_bot` set: agent replies, Inbox operator replies) are dropped
  silently.
- Owner typing to a customer: recorded in the Inbox as an **operator** message (no operator user,
  shown as "Operator"; photos/voice/files kept as attachments) and the AI is paused for that
  thread for **15 minutes** (Mehmon `OPERATOR_PAUSE_MINUTES`) through the existing
  `pauseInboxConversationAi` temporary pause: never shortens a longer pause and never touches a
  conversation a person switched off (a person's OFF is sticky). Echoes of what Labbai sent in the
  last 150 s (same Telegram message id, or the same text as an agent / Inbox-operator message)
  are not recorded and do not pause, so a reply never pauses its own thread.
- Edited Business messages (`edited_business_message`) and `deleted_business_messages` never run
  the workflow (Mehmon: an edit is never answered a second time) and are not recorded.
- Inbox: a Business chat is its own thread, account id `<bot id>:business:<connection id>`
  (`telegramInboxAccountId` in `lib/inbox/channels.ts`), separate from the same customer's chat
  with the bot. Operator text replies (`telegram_message` with `businessConnectionId`) and
  operator files (multipart `business_connection_id`) go out through the connection as the
  owner. Agent sends with `businessConnectionId` are filed under the Business thread. The Inbox /
  Notify blocks' Account ID accepts the bot id and then also match that bot's Business threads.
  A plain-words error when the connection is off or may not reply.
- Tools: optional user-only `businessConnectionId` param on `telegram_message`, `send_photo`,
  `send_video`, `send_audio`, `send_animation`, `send_document` (internal operation, multipart),
  `send_location`, `send_contact`, `send_poll`, `send_chat_action`, `edit_message_text`; the body
  carries `business_connection_id` only when set. Retry config unchanged. Not added where the Bot
  API has no such field (forward, copy, delete, reaction, get chat/member) or to pin/unpin.
  `tools/generated/tool-metadata.ts` was updated by hand with a script (pure insertion of the param,
  last in each tool's params); run `bun run tool-metadata:check` when bun is available.
- Limits: Business chats are private chats only; a reconnect gives a new connection id, so the
  thread continues as a new Inbox thread; the bot only sees chats the owner allowed in
  Telegram's Chatbots settings; Telegram Business needs Premium on the owner's account; the owner
  pause is 15 min fixed (not configurable yet); Business message deletions are not reflected in
  the Inbox.

### Cloudflare AI Gateway (2026-10-01)

Owner decision: all OpenAI usage goes through the **Cloudflare AI Gateway with Unified Billing**
(Cloudflare credits pay; the OpenAI balance is no longer used). Transport only — the models are the
same OpenAI models (gpt-5.5, gpt-5-mini, gpt-4.1, gpt-4.1-mini, text-embedding-3-small, gpt-image-1,
vision / audio models), with plain OpenAI model names.

Server `.env`:

```
OPENAI_BASE_URL=https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/openai
CLOUDFLARE_AIG_TOKEN=<gateway token>
# OPENAI_API_KEY may stay or be removed — it is not used in gateway mode
```

`CLOUDFLARE_AIG_TOKEN` set = gateway mode: every OpenAI request goes to `OPENAI_BASE_URL` with
`cf-aig-authorization: Bearer <token>` and **no** `Authorization` header (a provider key would make
the gateway treat the call as a BYO OpenAI key). `OPENAI_API_KEY` is then not required; every
"OpenAI is not configured" check accepts the token. `OPENAI_EXTRA_HEADERS` still merges in (an
`Authorization` inside it is dropped in gateway mode). Unset = exactly the old behaviour.

One helper decides the transport: `apps/labbai/providers/openai/client-config.ts`
(`getOpenAIBaseUrl`, `getOpenAIAuthHeaders(apiKey)`, `isOpenAIGatewayMode`, and
`createOpenAIFetch` — a `fetch` for the `openai` SDK that deletes the `Authorization` header the SDK
always builds from its `apiKey`; the SDK gets the placeholder key `OPENAI_GATEWAY_API_KEY`). Routed
through it: Agent/Router/Evaluator provider (`/responses`) and its Files API uploads, local copilot
(main + specialists + engagement status, `/chat/completions`), wand (SDK), notification evaluator,
knowledge/tool embeddings, vision, copilot image generation, Image Generator block (v1 tool + v2
OpenAI path), OpenAI TTS and Whisper STT. Not routed: a copilot pinned to
`COPILOT_PROVIDER=azure-openai|openai-compatible` (its own `COPILOT_BASE_URL` / key).

In gateway mode a key a user pasted into a block (Vision, Image Generator, TTS, STT, Embeddings) or
a workspace BYOK key is **not sent** — those calls are paid from the platform's Cloudflare credits.
Embeddings are then billed to the workspace (`isBYOK: false`); Vision / Image Generator / TTS / STT
with a pasted key are **not** metered per workspace (any non-empty "key" works) — gate or meter
those blocks before customers get them.

Roll back: unset `CLOUDFLARE_AIG_TOKEN`, restore `OPENAI_BASE_URL` (remove it or set
`https://api.openai.com/v1`) and make sure `OPENAI_API_KEY` is set; restart the app (and workers).

## How to verify (no local builds — the owner's Mac has 8 GB)

CI on every push to `main` (`.github/workflows/ci.yml`), all jobs in parallel:
1. `tsc` — `bun install` (cached) → `tsc --noEmit` (apps/labbai) → local copilot tests.
2. `tests` — the whole apps/labbai vitest suite in 3 shards (`--shard=N/3`).
3. `next-build` — the app's `next build` outside Docker (its output is published).
4. `images` — builds the 4 images and pushes `ghcr.io/azizmubashirov/labbai-{app,realtime,migrations,cron}:<sha>`.
5. `promote` — only when 1–4 all passed: retags `:<sha>` → `:latest` (deploys pull `:latest`).
6. `report` — publishes `ci-reports` (`{status,typecheck,tests,full-tests,full-tests-failed,install}.txt`;
   `status.txt` has sha, tsc, tests, full_tests, next_build, images, latest) and `ci-build-report`
   (`status.txt`, `build.txt`): `https://raw.githubusercontent.com/azizmubashirov/labbai/ci-reports/status.txt`.

Job logs need repo-admin auth; the report branches exist so results are readable publicly.
To test a WIP branch in CI, merge it to `main` only when it type-checks, or temporarily
add the branch to the workflow `on.push.branches`.

`bun.lock` must be regenerated whenever a package.json changes (CI uses
`--frozen-lockfile`). With Docker: copy all package.json files + bun.lock + bunfig.toml +
patches/ into an empty dir and run
`docker run --rm -v $PWD:/w -w /w oven/bun:1.4.1-alpine bun install --lockfile-only`.

## Production server

- Host `46.8.195.221`, SSH as `ubuntu` (not root). It also runs Mehmon.AI (app.labbai.uz),
  Uysot and Paynet — never touch their containers. RAM is tight (5.3 GB total): Labbai app is
  capped at 1.5 GB, realtime at 384 MB.
- Stack in `/home/ubuntu/labbai`: `docker-compose.prod.yml` + `deploy.sh`
  (copies of `docker-compose.prod.yml` and `infra/labbai-prod/deploy.sh` from this repo),
  `.env` (secrets generated on the server, mode 600), `uploads/` (local file storage), DB volume `labbai_pg`.
- Deploy: `ssh ubuntu@46.8.195.221 sh /home/ubuntu/labbai/deploy.sh` (pull GHCR images, migrate, up).
- No published ports. Ingress = the `labbai-prod` Cloudflare tunnel (Mehmon's `mehmonai-cloudflared`, network `mehmonai_default`; the stack also joins the shared `edge` network, `/home/ubuntu/edge`,
  routes set in the Cloudflare dashboard → Public hostnames):
  `studio.labbai.uz` path `socket.io` → `http://labbai-realtime:3002` (must be listed first), then
  `studio.labbai.uz` → `http://labbai-app:3000`. `.env` `NEXT_PUBLIC_SOCKET_URL=https://studio.labbai.uz` (same origin).
- Owner fills in `OPENAI_API_KEY` (new, rotated) and `GOOGLE_CLIENT_ID/SECRET` in `.env`, and adds
  `https://studio.labbai.uz/api/auth/oauth2/callback/google-{email,drive,docs,sheets,calendar,forms}`
  to the Google OAuth client.

## Test server


- Host `147.93.62.159` (ssh alias `hostinger-root`), stack in `/root/labbai/arena`
  (its own `docker-compose.labbai.yml` on the server; no longer in the repo; DB volume `labbai_pg_v2`).
- Deploy: `sh /root/labbai/deploy-labbai.sh` (pull GHCR images, migrate, up).
- App bound to 127.0.0.1 only: `ssh -f -N -L 3300:127.0.0.1:3300 -L 3302:127.0.0.1:3302 hostinger-root`
  then open http://localhost:3300.
- Server `.env` has OPENAI_API_KEY, COPILOT_PROVIDER=openai, COPILOT_MODEL=gpt-5.5,
  NEXT_PUBLIC_PLATFORM_LLM_PROVIDERS=openai. Never paste secrets into chat or commits.
- The server is too weak to build images — always build in GitHub Actions.

## Latest state (2026-09-26, end of session)

- Deployed on the test server: `dc32a92a` — includes the local copilot fix (edit_workflow result
  was sanitized twice → `Object.entries(undefined)` failed every turn after a workflow edit).
  Lifecycle failures now log `stack`.
- Google OAuth: owner created a Google Cloud OAuth client (project "Labbai", Testing mode) and put
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` into the server `.env`; app recreated with them.
  Redirect URIs registered: `http://localhost:3300/api/auth/oauth2/callback/google-{email,drive,docs,sheets,calendar,forms}`.
  In Testing mode only listed Test users can connect (tokens expire after 7 days). Before real
  customers: domain + privacy policy + Google verification (Gmail `gmail.modify` and full `drive`
  are restricted scopes → CASA audit; consider narrower scopes).
- Next: owner tests the copilot (e.g. Telegram apartment-sales agent with Google Sheets).

## Known open issues (not cleanup)

Listed in LABBAI_PLAN.md "Open issues found in testing" (Google OAuth client, secret
rotation, file preview tool name, copilot enum reuse for model ids, etc.).
