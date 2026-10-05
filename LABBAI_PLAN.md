# Labbai — product decisions and cleanup plan

Labbai is a fork of Sim v0.8.59 (simstudioai/sim, Apache-2.0) with Arena's local copilot
ported in. We do not sync with upstream Sim; we develop it ourselves from here.

## Remove

- `apps/docs`, landing pages `apps/labbai/app/(landing)`, `apps/labbai/public/landing`, sim.ai
  marketing/SEO routes (`sitemap`, `llms.txt`, `changelog.xml`, contact / demo-requests / stars APIs)
- `apps/desktop` and desktop-only pieces: `browser-protocol`, `terminal-protocol`,
  `desktop-bridge`, desktop/browser/terminal settings, copilot browser_* / terminal tools
- `packages/sim-cli`, `sim-setup`, `cli`, `ts-sdk`, `python-sdk`, `helm`, CLI/desktop APIs
- Stripe billing: subscriptions, checkout, webhooks, upgrade and billing pages.
  No payments of any kind for now. Credit/balance screens are hidden and usage limits
  stay off; the internal cost ledger (`usage_log`) keeps recording what runs cost.
- Integrations: keep ~10% (list below), remove the rest with their tools, triggers,
  OAuth providers and knowledge connectors
- LLM providers: the old per-vendor providers stay removed. All models are managed from one
  place — Cloudflare (one account, one token, one balance via Unified Billing, gateway `labbai`):
  every OpenAI, Anthropic and Google chat model plus two Workers AI models through Cloudflare
  (coded 2026-10-01, see "Models" and HANDOFF.md "Cloudflare AI (one account for every model)").
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

## Enterprise (`apps/labbai/ee`) — license

`apps/labbai/ee` is under the Sim Enterprise License: no production use without a Sim
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

## Models (Cloudflare multi-provider)

Owner decision 2026-10-01: manage every model from Cloudflare (one account, one token, one
balance via Unified Billing, AI Gateway `labbai`). Env: `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_AI_GATEWAY` (default `labbai`) — "Cloudflare mode".

Owner decision 2026-10-01 (second): don't limit the list — in Cloudflare mode the pickers offer
**every** Claude, Gemini and OpenAI chat model Cloudflare serves through Unified Billing (static
catalog, from Cloudflare's model catalog read 2026-10-01; full table in HANDOFF.md).

- OpenAI (provider `openai`, Responses API through the gateway's `/openai` path, plain ids so
  existing workflows are unchanged): curated everywhere — strong `gpt-5.5` · fast, default for
  Agent blocks `gpt-5-mini` · `gpt-4.1` · `gpt-4.1-mini`; Cloudflare mode adds GPT-6 Astra / Sol /
  Luna, GPT-5.6 Sol / Terra / Luna, GPT-5.5 Pro, GPT-5.4 (+ Pro, mini, nano), GPT-5.1, GPT-5,
  GPT-5 nano, o4-mini, o3, o3-mini, GPT-4.1 nano, GPT-4o, GPT-4o mini. Embeddings
  `text-embedding-3-small`.
- Anthropic / Google / Workers AI (provider `cloudflare`, Cloudflare's unified
  `/ai/v1/chat/completions`, Cloudflare mode only): Claude Fable 5.1 / 5, Opus 5.5 / 5 / 4.8 /
  4.7 / 4.6 / 4.5, Sonnet 5 / 4.6 / 4.5 (legacy), Haiku 4.5; Gemini 3.8 / 3.7 / 3.6 / 3.5 Flash,
  3.5 Flash-Lite, 3.1 Pro, 3.1 Flash-Lite, 3 Flash, 2.5 Pro / Flash / Flash-Lite; Workers AI
  `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (strong open model), `@cf/zai-org/glm-4.7-flash`
  (cheap and fast).
- Pickers (Agent / Router / Evaluator / Guardrails / Translate blocks, fallback list, copilot)
  group models by vendor — OpenAI, Anthropic, Google, Workers AI — with readable names; the
  stored value is still the model id. No user key anywhere. Outside Cloudflare mode only the
  four curated OpenAI models show, and a stored Cloudflare-only id runs on the closest curated
  model (`gpt-5.5` for flagship ids, else `gpt-5-mini`).
- The copilot offers the same list minus the models it cannot run on Chat Completions with
  tools (GPT-5.4 / 5.5 Pro, GPT-5.6, GPT-6 Sol / Luna); its per-user default is stored as text
  (migration 0384).
- Without the Cloudflare vars: OpenAI directly with `OPENAI_API_KEY`, OpenAI models only.

## Build (new, after cleanup)

- **Inbox** (done 2026-09-27; see HANDOFF.md) — native section inside Labbai: every customer thread from
  Telegram / WhatsApp / Instagram (via Sim channel triggers) stored as a conversation,
  Telegram-like list + thread view, operator reply from the UI, per-conversation
  AI on/off (when off, the agent workflow skips that customer). Copilot-built channel
  agents feed this section automatically. Completed 2026-09-28: live updates over the
  realtime server, customer media (photos, voice, video, documents, locations), earlier
  history paging, sidebar unread badge, Telegram secret token, Instagram contact names,
  plain-language 24-hour-window errors. Operator media sending done 2026-09-28: photos, files
  and voice messages from the reply box (7 MB per file; WhatsApp photos 5 MB; captions 1024;
  voice converted to OGG/Opus for Telegram/WhatsApp and M4A for Instagram; Instagram files need
  cloud storage so Meta can fetch a public link).
- **Notifications** (phase 1 done 2026-09-28; see HANDOFF.md) — one platform Telegram bot
  (`NOTIFICATION_BOT_*` env) alerts operators: recipients connect with a `t.me` link, triggers are
  the operator's own words judged by an LLM on each Inbox customer / agent message, or workflow
  events from the new Notify block; a trigger can pause AI (for a while or until an operator turns
  it on) and send the customer a notice. Owner decision 2026-09-29: configured **per workflow on
  the canvas** with a Notifications block (recipients + rules), not in workspace Settings; rules
  take effect on deploy (change a rule → redeploy). Later: inline buttons on alerts (resume AI,
  snooze, approve), alert history, condition drafting / dry run.
- **Telegram Business** (coded 2026-09-29; see HANDOFF.md) — owner decision: inside the existing
  Telegram trigger and Telegram tools, not a separate trigger (one bot has one webhook). Trigger
  setting "Messages to receive": Bot chats (default) | Business chats | Both; Business messages
  get the same trigger output plus `businessConnectionId` / `isBusiness`. Messages the account
  owner types to a customer never run the workflow: they are recorded in the Inbox as operator
  messages and pause the AI in that chat for 15 minutes (a person's OFF stays off). Edited
  Business messages are not answered again. Telegram send tools and the Inbox reply through the
  Business connection.
- **Binora CRM link** (coded 2026-09-29; see HANDOFF.md) — owner decision: operators work in
  **Binora** (CRM + Asterisk call-center), Labbai is the channel + AI engine. First client: a tour
  firm. Every chat of an agent workflow (Telegram, WhatsApp, Instagram) becomes a lead in a Binora
  funnel with all messages (customer, AI, operators); Binora operators reply and switch the AI from
  the lead card. Labbai speaks Binora's existing ADR-052 protocol (the one Mehmon.AI implemented and
  never launched), so it replaces Mehmon for this. Configured per workflow on the canvas with a
  **Binora CRM** block (like Notifications); mirroring runs while the deployed version has the block.
  Universal by design: a `crm_link` row with a provider (Binora now; amoCRM / Bitrix24 later).
- **Cloudflare AI** — coded 2026-10-01 (not deployed): one Cloudflare account for every model.
  `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (+ optional `CLOUDFLARE_AI_GATEWAY`) route
  OpenAI (gateway `/openai`: Agent, copilot, wand, notifications, embeddings, vision, images,
  speech) and every Claude / Gemini chat model plus two Workers AI models (unified chat
  completions) through Cloudflare Unified Billing; the full model list (2026-10-01, second step)
  needs `migrate` for 0384 on deploy. The earlier `CLOUDFLARE_AIG_TOKEN` + `OPENAI_BASE_URL` setup still
  works as a legacy alias. Rollback and details: HANDOFF.md "Cloudflare AI (one account for
  every model)".
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
