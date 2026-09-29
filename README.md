# Labbai

Labbai is an AI workspace where teams build, deploy, and manage AI agents — visually in the
workflow builder or by asking Labbai in Chat.

Labbai is a modified version of [Sim](https://github.com/simstudioai/sim) v0.8.59
(Apache-2.0). It is developed independently and does not track upstream. See `NOTICE` and
`LICENSE`.

## Where to start

- `LABBAI_PLAN.md` — product decisions: what was removed, what is kept, what comes next.
- `HANDOFF.md` — operational state: branches, CI reports, test server, open work.
- `CLAUDE.md` and `.claude/rules/` — coding standards for this repository.

## Layout

```
apps/labbai/      Next.js app: UI, API routes, workflow builder, executor
apps/labbai/local-copilot/  the in-app agent (OpenAI-compatible)
apps/realtime/    Socket.IO server for the collaborative workflow builder
packages/         shared packages (@labbai/db, @labbai/auth, @labbai/emcn, …)
```

## Run it

Images are built in GitHub Actions and published to GHCR
(`ghcr.io/azizmubashirov/labbai-{app,realtime,migrations,cron}`).
`docker-compose.prod.yml` runs that stack on the production server; deploy steps are in `HANDOFF.md`.

Local development uses `bun`:

```bash
bun install
cd apps/labbai && bun run type-check
```

Required server settings are listed in `apps/labbai/.env.example`. The in-app agent needs
`OPENAI_API_KEY`.

## License

Apache License 2.0 — see `LICENSE`. Portions are copyright Sim Studio; see `NOTICE`.
