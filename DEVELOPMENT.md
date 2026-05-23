# Development Workflow

This project runs in TWO isolated environments:

| Where           | Production                  | Development                          |
| --------------- | --------------------------- | ------------------------------------ |
| Git branch      | `main`                      | `develop`                            |
| URL             | `infinitree.vercel.app`     | Vercel preview URL (auto-generated)  |
| Supabase        | real production project     | separate dev project                 |
| Banner          | none                        | red/orange "🧪 Preview" strip at top |

The goal: experiments and broken code can NEVER touch the real
family data. Only changes that pass all tests and are reviewed get
promoted to `main` → production.

---

## Day-to-day flow

```
feature work ─→ PR to develop ─→ CI tests ─→ merge to develop
                                                  ↓
                                      verify on preview URL
                                                  ↓
                                  PR develop → main → CI tests
                                                  ↓
                                            production deploy
```

1. **Feature work** lives on `claude/<feature-name>` branches.
2. **PRs target `develop`** — not `main`. CI runs typecheck +
   lint + tests + build. Merge only after CI is green.
3. **Verify on the preview URL**. Vercel auto-deploys `develop`
   to a stable URL after each merge. Try the change end-to-end
   against the dev Supabase project.
4. **Promote to production** by opening a PR from `develop` to
   `main`. CI runs again. When green and you're satisfied,
   squash-merge — Vercel deploys to `infinitree.vercel.app`.

If something breaks in production, revert the offending commit on
`main` and Vercel auto-rolls-back within minutes.

---

## One-time setup (you, in the Vercel + Supabase dashboards)

These are the manual steps that have to happen ONCE outside the
codebase. After this, the workflow above just works.

### 1. Create a second Supabase project for development

1. Go to [supabase.com](https://supabase.com) → New Project.
2. Name it something like `infinitree-dev`. Pick the free tier.
3. Once provisioned, run the same migrations as the production
   project (see `migrations/` if it exists, or copy the schema
   via the SQL editor).
4. Note down the new project's **URL** and **anon public key**
   from Settings → API.

### 2. Configure Vercel environment variables

In the Vercel dashboard → infinitree project → Settings → Environment Variables:

| Variable               | Production            | Preview                |
| ---------------------- | --------------------- | ---------------------- |
| `VITE_SUPABASE_URL`    | prod project URL      | **dev project URL**    |
| `VITE_SUPABASE_ANON_KEY` | prod anon key       | **dev anon key**       |
| `VITE_APP_ENV`         | `production`          | `preview`              |

Setting `VITE_APP_ENV` is what triggers the "🧪 Preview" banner
at the top of every non-prod deployment.

### 3. Configure GitHub branch protection on `main`

In the GitHub repo → Settings → Branches → Add rule for `main`:

- ✅ Require a pull request before merging
- ✅ Require status checks to pass before merging
  - Select: `Typecheck`, `Lint`, `Unit tests (Vitest)`, `Production build`
- ✅ Require branches to be up to date before merging
- ✅ Do not allow bypassing the above settings

This is what enforces "only code that passes tests reaches
production".

### 4. Create the `develop` branch (one-time)

```sh
git checkout main
git checkout -b develop
git push -u origin develop
```

Then in Vercel → Settings → Git → set `develop` as the primary
preview branch so it gets a stable URL.

---

## Running locally

```sh
npm install
npm run dev          # http://localhost:5173 — uses VITE_* from .env.local
```

For a local dev session pointed at the dev Supabase, create
`.env.local`:

```
VITE_SUPABASE_URL=<dev project URL>
VITE_SUPABASE_ANON_KEY=<dev anon key>
VITE_APP_ENV=development
```

`.env.local` is gitignored, so each developer's local config stays
on their machine.

---

## Tests

```sh
npm run typecheck    # tsc -b --noEmit
npm run lint         # eslint
npm run test         # vitest (watch mode)
npm run test:run     # vitest (single run, used in CI)
npm run build        # full production build
```

All four run on every PR via `.github/workflows/ci.yml`.

Adding tests: drop `*.test.ts` files anywhere under `src/`. They
auto-discover via the Vitest config in `vite.config.ts`. Start by
modelling the existing tests in `src/__tests__/lineage.test.ts`.

---

## Why this matters

The Adler family tree holds real personal data — names, dates,
photos, relationships. A bug merged straight to production can:

- corrupt the database with malformed updates
- leak data through a broken RLS policy
- crash the app for the user mid-edit

The dev environment is where we catch those before they ship. The
banner makes it impossible to think you're on production when
you're not; CI makes it impossible to merge code that doesn't
build; separate Supabase makes it impossible to accidentally
overwrite a real member while testing.

The cost is one extra layer of merging (`feature → develop →
main`) and a one-time setup. The value is sleep.
