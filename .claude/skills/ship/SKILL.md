---
name: ship
description: Land finished work the way this repo does it — a `fix/` or `feat/` branch, the local checks that matter for the diff, a commit, and a `--no-ff` merge into local `main`. Pushing and deploying are separate steps that happen only when the user asks. Use when the user says to commit, merge, or "ship" a change.
argument-hint: "[optional scope notes]"
---

# Ship

The project lands work on `main` through local merges. There is no staging branch, no pull request, and no review bot. `origin` is `github.com/azizmubashirov/labbai`. A push to `main` starts CI (`.github/workflows/ci.yml`): type-check, tests, Next build and four GHCR images. When all of them pass, the `promote` job retags the images as `:latest`, and the server deploy pulls that tag.

## Ground rules

- Commit only when the user asked for it. Push only when the user asked for it. Deploy only when the user asked for it. Approving one of these does not approve the next.
- Never stash, reset, rebase shared history, or switch the branch of a checkout another session may be using. When you need a branch, use a worktree (`git worktree add`) or stay on the branch you are given.
- Commit only files this task changed. Leave `reports/`, `research_notes/` and other untracked notes alone unless the user named them.
- Bun is not always installed on the developer machine. If `bun`/`bunx` is missing, run the same tools from `node_modules/.bin` (`vitest`, `tsc`) and say so in the report.

## Steps

1. **Inspect.** Run `git status --short` and `git diff --stat`. Confirm every changed file belongs to this task.
2. **Branch.** Use `fix/<short-name>` for fixes, `feat/<short-name>` for features and `chore/<short-name>` for tooling. Skip this step only for a change the user asked to commit straight to `main`.
3. **Check what the diff touches.** Run only what applies, and fix failures rather than silencing them:
   - Any TypeScript under `apps/labbai`: `tsc --noEmit` in `apps/labbai`. CI runs the same command and blocks the `:latest` image on failure.
   - Tests next to every changed file, plus the suites of the folders the change reaches (for example `providers/`, `blocks/`, `executor/`).
   - `packages/db/migrations/**` or `packages/db/schema.ts`: run the `db-migrate` skill and `bun run check:migrations`.
   - API routes, contracts or client hooks: `bun run check:api-validation`.
   - UI code (`.tsx`, `components/`, `hooks/`, `stores/`): run the `cleanup` skill in report mode and apply what is clearly right.
4. **Commit.** Use `type(scope): description`, where type is one of `fix`, `feat`, `improvement`, `perf`, `chore`, `docs`, `test`. Add a body when the reason is not obvious: say what was wrong and how the change fixes it. End with the attribution line the session gives.
5. **Merge.** From the `main` checkout, run `git merge --no-ff <branch> -m "Merge branch '<branch>': <one-line summary>"`. This matches the existing history. Delete the branch with `git branch -d <branch>` once it is merged.
6. **Report.** Give the merge SHA, the checks you ran and their results, and anything you skipped. Say plainly that nothing was pushed or deployed.

## Push and deploy (only on request)

1. `git push origin main`.
2. Wait for the CI run to finish (`gh run watch` in the background). Deploy only after `promote` has succeeded. Otherwise the server pulls the previous `:latest`.
3. Deploy with the `labbai-deploy` skill.

## What never goes into commit messages

The repository is on GitHub. Keep customer and workspace names, IDs, phone numbers, tokens, server addresses and production data out of commit messages and code comments. Describe a bug by its mechanism, not by the incident that exposed it.
