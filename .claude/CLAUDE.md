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

**For environment / workflow questions** — dev vs. production data,
preview links, how to promote a change — read
`docs/DEV-ENVIRONMENT.md`. Short version:
- Production (`main`, infinitree.vercel.app) uses the Frankfurt
  Supabase project `wkbdqdytfjycbbcnzjuv`. It holds real family
  data: never run SQL or scripts against it without the owner's
  explicit approval, and check the repo state before assuming a
  project is empty.
- Every Vercel preview branch and local `npm run dev` use the
  separate Mumbai project `oklwywuxglaefchjbhcw`.
- Flow: feature branch → preview deployment → PR to `main` → CI
  green → owner approves the merge.
- Never commit credentials. Maintenance scripts read the database
  password from `SUPABASE_DB_PASSWORD`.
