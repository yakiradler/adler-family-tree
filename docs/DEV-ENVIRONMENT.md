# Dev environment — Mumbai (`oklwywuxglaefchjbhcw`)

## TL;DR

Production lives on **Frankfurt** (`wkbdqdytfjycbbcnzjuv` · eu-central-1) and
serves https://infinitree.vercel.app. Every other deployment — Vercel
preview branches and local `npm run dev` — talks to **Mumbai**
(`oklwywuxglaefchjbhcw` · ap-south-1), a separate Supabase project that
holds a full snapshot of the production data at the moment of the
2026-05-25 migration. Anything you do in Mumbai stays in Mumbai.

## How the wiring works

| Surface | `VITE_SUPABASE_URL` | `VITE_SUPABASE_ANON_KEY` | Source |
|---|---|---|---|
| Production (`infinitree.vercel.app`, `git main`) | Frankfurt | Frankfurt publishable | Vercel **Production** env |
| Preview deployments (any non-main branch) | Mumbai | Mumbai publishable | Vercel **Preview** env |
| Local `npm run dev` | Mumbai | Mumbai publishable | `.env.development.local` (gitignored) |
| Local `npm run build` (matches prod) | Frankfurt | Frankfurt publishable | `.env` |

`.env.development.local` overrides `.env` only in `development` mode,
so `npm run build` still produces a Frankfurt-targeted artifact.

## How to access a preview deployment

Vercel previews are SSO-protected. To open one in a normal browser
without logging into the Vercel dashboard, append the project's
automation bypass token to the URL:

```
https://<deployment>-yakir-adler-s-projects.vercel.app/?x-vercel-set-bypass-cookie=true&x-vercel-protection-bypass=gQEMZMghRw5uDY4MXblvE3DEet4E9zw4
```

Once Vercel sets the bypass cookie you can navigate within the
deployment normally. The token rotates from the Vercel dashboard
under Settings → Deployment Protection → Protection Bypass for
Automation.

## Promoting a preview to production

When the change is ready:

```bash
git checkout main
git merge <feature-branch>
git push origin main          # auto-deploys to Frankfurt prod
```

Or push directly: `vercel --prod` from `main`.

## Resetting Mumbai to mirror production

After accumulated dev experiments, Mumbai may diverge from Frankfurt.
To copy production back over the dev environment, re-run the same
migration script that originally seeded it (point `OLD`/`NEW` at
Frankfurt→Mumbai instead of Mumbai→Frankfurt):

```bash
npx tsx scripts/migrate-to-frankfurt.ts   # ← edit the OLD/NEW
                                          #   constants before running
```

## When to use which

| Want to | Use |
|---|---|
| See real users on the production tree | Production (infinitree.vercel.app) |
| Test a UI change with realistic data | Preview branch |
| Iterate on a migration / schema change | Local dev or preview branch |
| Reproduce a production bug | Preview branch (same code, separate DB) |
| Run a destructive script (DELETE, bulk update) | Local dev pointed at Mumbai |
