# Labbai — product decisions and cleanup plan

Labbai is a fork of Sim v0.8.59 (simstudioai/sim, Apache-2.0) with Arena's local copilot
ported in. We do not sync with upstream Sim; we develop it ourselves from here.

## Remove

- `apps/docs`, landing pages `apps/sim/app/(landing)`, `apps/sim/public/landing`, sim.ai
  marketing/SEO routes (`sitemap`, `llms.txt`, `changelog.xml`, contact / demo-requests / stars APIs)
- `apps/desktop` and desktop-only pieces: `browser-protocol`, `terminal-protocol`,
  `desktop-bridge`, desktop/browser/terminal settings, copilot browser_* / terminal tools
- `packages/sim-cli`, `sim-setup`, `cli`, `ts-sdk`, `python-sdk`, `helm`, CLI/desktop APIs
- Stripe billing: subscriptions, checkout, webhooks, upgrade and billing pages.
  No payments of any kind for now. Credit/balance screens are hidden and usage limits
  stay off; the internal cost ledger (`usage_log`) keeps recording what runs cost.
- Integrations: keep ~10% (list below), remove the rest with their tools, triggers,
  OAuth providers and knowledge connectors
- LLM providers: keep only OpenAI for now (owner has OpenAI budget); remove all others.
  Cloudflare AI Gateway (Unified Billing, one account) comes later, when the OpenAI budget
  runs out — the OpenAI provider takes an optional base URL / extra header so the switch
  is a config change.
- Sim cloud copilot path (Go mothership client) and the Local/Cloud switch — local copilot only
- Copilot providers other than the OpenAI-compatible one (Bedrock, Vertex, Gemini)
- PII service (`apps/pii`), Pi / A2A / Mothership blocks, video generation,
  Sim Mailer inbox, code sandboxes (E2B/Daytona; plain JS function block stays),
  enrichments, Ollama/vLLM compose files
- Settings: BYOK, self-host, mothership, sandboxes, billing/credits/upgrade
- Routes: `playground`, `slack-search` / enterprise search, `custom-blocks`
- Organization UI layer (`/o/[organizationId]`); keep the DB tables
- `enterprise-owner-claims` API

## Keep

- Workflow canvas, copilot chat, Tables, Knowledge, Files, Logs, Integrations, Skills,
  Scheduled tasks, Secrets, API keys, MCP, Custom tools, members + roles,
  Recently deleted, wand (AI field generation)
- Telemetry — pointed at our own endpoint (`TELEMETRY_ENDPOINT`), not simstudio.ai
- Activity log, Access requests, Credential groups, Authorized apps,
  SCIM, audit-logs API, permission groups

## Enterprise (`apps/sim/ee`) — license

`apps/sim/ee` is under the Sim Enterprise License: no production use without a Sim
subscription and no modification. The directory is removed. Features we keep that
lived there (Activity log / audit logs UI, Access requests, Credential groups, SCIM,
permission groups / access control) are re-implemented as Labbai code — same behavior,
our own implementation (not copied from `ee`). Apache-licensed parts outside `ee`
(e.g. `packages/audit`, `packages/platform-authz`) are reused.
Owner decision (2026-09-25): do it now as part of cleanup — clean-room: requirements come
only from Apache-licensed code (call sites outside `ee`, `packages/db` schema, API
contracts), never from `ee` source. Other `ee` features (SSO, whitelabeling, data
retention, data drains, workspace forking, session policy, organization stats/usage,
custom blocks) are removed, not re-implemented.

## Integrations kept (~10%)

Channels: Telegram, WhatsApp, Instagram, Twilio SMS, Gmail, SMTP ·
Google: Sheets, Drive, Docs, Calendar, Forms, Maps ·
CRM: HubSpot, Pipedrive, Notion, Airtable, Trello ·
Booking: Cal.com, Calendly, Zoom ·
Databases: PostgreSQL, MySQL, Supabase ·
Web/search: Firecrawl, Exa, Serper ·
Commerce: Shopify, WordPress · Voice: ElevenLabs.
Knowledge connectors: Google Drive, Google Docs, Notion.
Later: amoCRM, Bitrix24, Exely (not in Sim) — our own integrations.

## Models (OpenAI only for now)

Strong: `gpt-5.5` · Fast (default for Agent blocks): `gpt-5-mini` ·
Embeddings: `text-embedding-3-small`. Later via Cloudflare AI Gateway: add Claude /
Gemini / Workers AI.

## Build (new, after cleanup)

- **Inbox** (done 2026-09-27; see HANDOFF.md) — native section inside Labbai: every customer thread from
  Telegram / WhatsApp / Instagram (via Sim channel triggers) stored as a conversation,
  Telegram-like list + thread view, operator reply from the UI, per-conversation
  AI on/off (when off, the agent workflow skips that customer). Copilot-built channel
  agents feed this section automatically. Completed 2026-09-28: live updates over the
  realtime server, customer media (photos, voice, video, documents, locations), earlier
  history paging, sidebar unread badge, Telegram secret token, Instagram contact names,
  plain-language 24-hour-window errors. Open: operator media sending.
- **Cloudflare AI Gateway** (later, when the OpenAI budget runs out): point the OpenAI
  provider at the gateway; needs Account ID, Gateway ID, API token in server `.env`.
- **Branding** — Labbai name, text logo, emails: done. Still to do (owner: last): real logo,
  UZ / RU interface.
- Own integrations: amoCRM, Bitrix24, Exely.

## Open issues found in testing

- Google OAuth: our own client is set up (Testing mode, see HANDOFF.md). Before real
  customers: domain, privacy policy and Google verification.
- Secrets pasted into chat during testing (an OpenAI key, a Telegram bot token) must be
  rotated by the owner.
- Local copilot file writes use the `workspace_file` tool name; the new Sim file preview
  listens for `prepare_file_edit` — verify live preview manually.

## Order of work

Each step is its own commit, verified by CI (type check + tests) before the next:
small safe removals → integrations → Stripe → LLM providers (OpenAI only) →
`ee` removal + Labbai re-implementations → organization UI → branding (Labbai, UZ/RU).
