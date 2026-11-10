# Hooks Scope

These rules apply to custom hooks under `apps/labbai/**/hooks/**` and `apps/labbai/**/use-*.ts`.

See `.claude/rules/labbai-hooks.md` for the full conventions (single responsibility, props interface, refs for stable deps, `useCallback` for returned operations, loading/error tracking, async `try`/`catch`, separating logic from rendering).
