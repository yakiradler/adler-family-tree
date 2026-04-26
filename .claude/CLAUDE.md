# Project context for Claude Code

This file is auto-loaded by Claude Code when entering the repository.
**Read [`AGENTS.md`](../AGENTS.md) first** — it contains the full
agent briefing (in Hebrew), including:

- Architecture overview + file map
- The optimistic-CRUD pattern in `useFamilyStore`
- RBAC rules (4 roles: guest/user/master/admin)
- i18n contract (every UI string flows through `t.<key>`)
- Workflow expectations (typecheck → build → smoke test → commit → push)
- Things that were already fixed and shouldn't be re-done
- Red-flag patterns to avoid

The owner (`yakiradler`) prefers Hebrew for conversation. Code,
comments, and commit messages stay in English unless he asks
otherwise.

After `AGENTS.md`, also skim `ARCHITECTURE.md` before any non-trivial
change, and `ROADMAP.md` if the task is a new feature.
