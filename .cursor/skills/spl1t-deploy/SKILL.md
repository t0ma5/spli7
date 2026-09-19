---
name: spl1t-deploy
description: >-
  Deploy spli7 to Vercel project spli7 (https://spli7.vercel.app), separately
  from GitHub. Use when the user asks to deploy, ship, npm run deploy, vercel
  --prod, or update spli7.vercel.app.
---

# spli7 GitHub vs Vercel deploy

GitHub and Vercel are **two independent actions** unless Git integration is linked. A git push does not go live by default. `npx vercel --prod` does not push git.

## Do not

- Do not add a GitHub Actions job that deploys unless the user asks.
- Do not treat CI on push as a production deploy. CI is types/lint/format/tests only.
- Do not deploy Prisma/Postgres PR branches (`pr/*` based on upstream). Production is **`main`** on Vercel project **spli7** + Turso.

## GitHub (source)

Commit and push as the user already instructed (`git push origin <branch>` after approval when required). That updates GitHub only.

## Vercel (live)

Live site: [https://spli7.vercel.app](https://spli7.vercel.app)

1. Be on **`main`** with the Vercel + Turso tree (`vercel.json`, `src/lib/db/sql.ts`).
2. Confirm Vercel CLI: `npx vercel whoami`. If not logged in, open Brave (`D:\SOFTWARE\Brave`) and run `npx vercel login`.
3. `npx vercel --prod --yes --name spli7` (or `npm run deploy`).
4. If `migrations/` changed, also `npm run db:migrate:remote` with `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
5. Env on the Vercel project: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `PIN_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_BASE_URL=https://spli7.vercel.app`.
