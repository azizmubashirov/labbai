# Labbai — handoff (2026-09-26)

Read `LABBAI_PLAN.md` first: it is the source of truth for every product decision.
This file is the operational state for whoever continues the work.

## What Labbai is

Fork of Sim v0.8.59 (simstudioai/sim, Apache-2.0) + Arena's local AI copilot
(`apps/sim/local-copilot`), rebranded later as Labbai. We do NOT sync with upstream Sim.
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
| 4 LLM: OpenAI only (gpt-5.5, gpt-5-mini default, gpt-4.1, gpt-4.1-mini, text-embedding-3-small); `OPENAI_BASE_URL` / `OPENAI_EXTRA_HEADERS` for a later Cloudflare switch | done |
| 6 Remove `apps/sim/ee`; access control, audit logs, credential groups, access requests, SCIM re-implemented clean-room (`lib/labbai/**`), always on | done |
| 7 Organization UI layer (`/o/**`), Sim Search, org Search MCP, org Assistant removed; kept org-backed features live in workspace settings; DB tables kept | done |
| + Sim cloud copilot path (Go mothership client, BYOK/API-key routes) and Local/Cloud switch removed — local copilot only | done |
| + Telemetry only to our own `TELEMETRY_ENDPOINT`; off when unset | done |
| Branding, part 1: name, text logo, favicons, email header, copy, agent identity | done (see below) |
| Branding, part 2: UZ/RU interface (i18n) + real logo | todo — owner: at the very end |
| Inbox (customer conversations from Telegram / WhatsApp / Instagram) | done (see below) |

LICENSE RULE (critical): `apps/sim/ee` was under the Sim Enterprise License. Never read,
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
  `packages/emcn/src/components/sim-wordmark/paths.ts`; app mark (green square with a white
  "L") in `packages/emcn/src/icons/sim.tsx`; favicons, `icon.svg`, email `wordmark.png`,
  `public/logo/wordmark.svg`. Component names (`SimWordmark`, `Sim`) are unchanged. To swap in a
  real logo later: replace those files and `EMAIL_WORDMARK_*` in `lib/branding/wordmark.ts`.
- Copy: product name in UI, emails, API/OpenAPI descriptions, MCP server, tool/trigger help
  text, agent identity ("Labbai" instead of "Arena Copilot"/"Sim"). Code identifiers,
  `@sim/*` packages and block/tool ids are unchanged.
- Removed: Sim social links/address in the email footer and their `/x`, `/github`, … redirects;
  Sim status-page notice; old Sim logo files. Logo links on chat and shared-file pages now open
  the app instead of sim.ai. `README.md` rewritten; `NOTICE` keeps the Sim attribution.
- Left as is: `docs.sim.ai` links on blocks and empty states (Labbai has no docs yet);
  `isHosted` / sim.ai host checks (always false on our domain).
- Fonts: `public/brand/fonts` holds Season Sans and Söhne from Sim — commercial fonts,
  check the license before production use (Inter is the free alternative).
- Pre-existing, not from branding: `bun run check:mcp-operations` fails on `main` (the
  access-requests discovery schema lacks a description).

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

- Live updates: new realtime room `workspace-inbox` (`@sim/realtime-protocol/rooms`, read access,
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

## How to verify (no local builds — the owner's Mac has 8 GB)

CI on every push to `main` (`.github/workflows/typecheck.yml`):
1. `bun install --frozen-lockfile` → `tsc --noEmit` (apps/sim) → vitest (local copilot +
   a few suites) → whole apps/sim vitest suite → results pushed to
   branch `ci-reports`:
   `https://raw.githubusercontent.com/azizmubashirov/labbai-sim/ci-reports/{status,typecheck,tests,full-tests,full-tests-failed,install}.txt`
2. `next build` job → `ci-build-report` branch (`status.txt`, `build.txt`).
3. `Build images` (`.github/workflows/build-images.yml`) runs only after the type-check
   workflow succeeds on `main` → pushes `ghcr.io/azizmubashirov/labbai-sim-{simstudio,realtime,migrations,cron}:latest`.

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
- No published ports. Ingress = the shared `edge` Cloudflare tunnel (`/home/ubuntu/edge`,
  routes set in the Cloudflare dashboard → Public hostnames):
  `studio.labbai.uz` → `http://labbai-app:3000`, `studio-ws.labbai.uz` → `http://labbai-realtime:3002`.
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
