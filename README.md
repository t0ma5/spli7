[<img alt="spli7" height="60" src="./public/logo/128x128.png" />](https://spli7.vercel.app)

**spli7** is an open source expense-tracking app based on [Spliit](https://github.com/spliit-app/spliit). This fork deploys on **Vercel** (project **spli7**) with **Turso** (libSQL/SQLite) as the database — not Prisma/Postgres.

**Live:** [https://spli7.vercel.app](https://spli7.vercel.app)

## Features

Legend: 🟢 from original [Spliit](https://github.com/spliit-app/spliit) · 🔴 new in this Vercel / Turso fork

- [x] 🟢 Create a group and share it with friends
- [x] 🟢 Create expenses with description
- [x] 🟢 Display group balances
- [x] 🟢 Create reimbursement expenses
- [x] 🟢 Progressive Web App (**spli7** home-screen name; service worker + offline page + update prompt)
- [x] 🟢 Select all/no participant for expenses
- [x] 🟢 Split expenses unevenly
- [x] 🟢 Mark a group as favorite
- [x] 🟢 Tell the application who you are when opening a group
- [x] 🟢 Assign a category to expenses
- [x] 🟢 Search for expenses in a group
- [x] 🟢 Export a group to JSON or CSV
- [x] 🔴 Import a group from a Spliit JSON export (creates a **new** group with remapped IDs)
- [x] 🔴 Import a group from a **Tricount** GDPR CSV or **Splitwise** CSV export (participants + expenses)
- [x] 🔴 Notes + activity history + **document links** in JSON export/import (`exportVersion: 3`)
- [x] 🔴 Copy an existing expense into a new draft
- [x] 🔴 Math expressions in the amount field
- [x] 🔴 Even-split cent remainder (no missing cents)
- [x] 🔴 Group default split mode
- [x] 🔴 Optional group PIN (server-enforced HTTP-only cookie; PBKDF2; rate limited)
- [x] 🔴 Share group via QR code
- [x] 🔴 Soft-delete / restore groups (30-day grace) + **24-month inactivity expiry**
- [x] 🔴 Security headers, CSV formula escape, Zod input caps, expense date bounds
- [x] 🔴 Error boundaries + Drawer accessibility titles
- [x] 🔴 Field-array validation messages (no literal “undefined”)
- [x] 🔴 Expense date defaults to local today (not UTC)
- [x] 🔴 Paste-friendly amount parsing (US/EU grouped currency)
- [x] 🔴 Keyboard navigation restored in category/currency selectors
- [x] 🔴 Mobile group tab icons
- [x] 🔴 **Stats:** period selector, summary, spending over time / by participant / by category, recurring estimate, drill-downs, monthly stacked chart, and **balance timeline**
- [x] 🔴 Global balance across groups on My groups
- [x] 🔴 Settle reimbursements in a currency other than the group’s
- [x] 🔴 Unified share math (balances, stats, CSV, and the expense form agree)
- [x] 🔴 Locale-aware week grouping on expenses and activity
- [x] 🔴 Translated page titles
- [x] 🔴 CSV export as per-expense saldo (reimbursements as Cost=0)
- [x] 🔴 Optional calendar-month expense grouping
- [x] 🔴 Drag-reorder / Sort A–Z participants
- [x] 🔴 Multiple payers per expense (legacy single paidById migrated on read)
- [x] 🔴 Extra currencies: **ARS**, **TRY**, **COP**, **JOD**, **MKD**, **MOP**, **MYR**, **VND**
- [x] 🔴 Large groups: keyset-paginated expense/activity lists, compact stats/balance reads, and create/update/delete that do not load the whole group
- [ ] ❌ Upload and attach images to expenses (removed — see below)
- [ ] ❌ Create expense by scanning a receipt (removed — see below)

## Stack

- [Next.js](https://nextjs.org/) for the web application
- [TailwindCSS](https://tailwindcss.com/) for the styling
- [shadcn/UI](https://ui.shadcn.com/) for the UI components
- [Turso](https://turso.tech/) (libSQL/SQLite) for persistence (SQL, transactions, optimistic concurrency)
- [Vercel](https://vercel.com/) for hosting (project **spli7**)

## Data model notes

- Groups, participants, expenses, payers, shares, and activity live in **SQLite** tables on Turso (see `migrations/0001_init.sql`, `0002_keyset_indexes.sql`).
- Concurrent edits use an integer `version` column and retry on conflict (not last-write-wins KV).
- Expense lists and activity history page with **keyset cursors** (`expense_date`/`created_at`/`id`, not `OFFSET`). Adding or editing one expense writes only that row (plus an activity), not the whole group. Balances and stats still need every expense but skip documents and recurring links.
- Optional group PIN is hashed with PBKDF2, never returned to clients, and enforced on tRPC + export routes via an HTTP-only cookie (`PIN_SECRET`).
- Groups track `lastActivityAt` on mutations and `lastSeenAt` on reads. After **24 months** without either, cleanup soft-deletes them; soft-deleted groups can be restored for **30 days**, then are hard-deleted.
- Cron (Bearer `CRON_SECRET`): `GET/POST /api/cron/cleanup-groups`, `/api/cron/recurring`, `/api/cron/backup`. Vercel Cron runs cleanup + recurring daily. Legacy KV import (`/api/cron/migrate-kv`) returns 410.

## Extra UX (this fork)

Ideas below track community demand from [Spliit Cloud’s roadmap](https://github.com/antonio-ivanovski/spliit-cloud/blob/main/ROADMAP.md), upstream Spliit issues/PRs, and hardening patterns from [anon-spliit](https://github.com/sora-grayscale/anon-spliit) (reimplemented for this SQLite/Turso fork — not a code port of their E2EE/auth stack).

| Feature                                      | Notes                                                                                                                                                    | Prior art                                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Copy expense**                             | From the expense list or edit header icon (opens create prefilled).                                                                                      | Upstream [#527](https://github.com/spliit-app/spliit/issues/527); shipped in Spliit Cloud                                                                             |
| **Amount math**                              | Expressions in the amount field (`10+5.50`, `5*8`, …) on blur/save.                                                                                      | Upstream [#184](https://github.com/spliit-app/spliit/pull/184); shipped in Spliit Cloud                                                                               |
| **Default split mode**                       | Stored on the group (device localStorage can still override).                                                                                            | Upstream [#366](https://github.com/spliit-app/spliit/pull/366); shipped in Spliit Cloud                                                                               |
| **Even-split cents**                         | Integer remainder allocation so balances don’t drop a cent.                                                                                              | Upstream [#374](https://github.com/spliit-app/spliit/issues/374) / [#427](https://github.com/spliit-app/spliit/pull/427); tracked by Spliit Cloud                     |
| **Share QR**                                 | QR in the share popover.                                                                                                                                 | Upstream [#500](https://github.com/spliit-app/spliit/pull/500); on Spliit Cloud roadmap                                                                               |
| **Optional group PIN**                       | 6–8 digits for new PINs; HTTP-only unlock cookie; PBKDF2 hash; rate limited.                                                                             | Upstream [#373](https://github.com/spliit-app/spliit/issues/373); on Spliit Cloud roadmap                                                                             |
| **Notes + history + document links in JSON** | Export/import round-trips expense notes, group information, activity history, and document **URLs** (`exportVersion: 3`).                                | Follow-up to upstream [#546](https://github.com/spliit-app/spliit/pull/546); expense notes also in [#165](https://github.com/spliit-app/spliit/pull/165)              |
| **Soft-delete + inactivity expiry**          | Manual soft-delete with 30-day restore; auto soft-delete after 24 months without activity; cron hard-deletes after grace.                                | Inspired by [anon-spliit](https://github.com/sora-grayscale/anon-spliit) deletion/auto-delete work and upstream [#420](https://github.com/spliit-app/spliit/pull/420) |
| **Local-today expense date**                 | New/duplicate/reimburse defaults use the local calendar day at UTC midnight, so the date input is not tomorrow (west of UTC) or yesterday (east of UTC). | Upstream [#629](https://github.com/spliit-app/spliit/pull/629)                                                                                                        |
| **Field-array form errors**                  | `FormMessage` reads `error.root.message` so split-mode refinements (percent/amount sums) never render the string `undefined`.                            | Upstream [#608](https://github.com/spliit-app/spliit/pull/608)                                                                                                        |
| **Paste amount parsing**                     | Normalizes pasted US/EU currency amounts in number fields.                                                                                               | Upstream [#531](https://github.com/spliit-app/spliit/pull/531)                                                                                                        |
| **Selector keyboard nav**                    | Category/currency pickers use cmdk CommandList.                                                                                                          | Upstream [#491](https://github.com/spliit-app/spliit/pull/491)                                                                                                        |
| **Mobile tab icons**                         | Icon-only tabs on small screens; labels from sm.                                                                                                         | Upstream [#539](https://github.com/spliit-app/spliit/pull/539)                                                                                                        |
| **Monthly spending + balance timeline**      | CSS stacked category charts, category breakdown, and balance timeline on Stats.                                                                          | Upstream [#532](https://github.com/spliit-app/spliit/pull/532) / [#555](https://github.com/spliit-app/spliit/pull/555)                                                |
| **Stats cards + drill-downs**                | Period selector, summary, spending over time / participant / category, recurring estimate, click-a-bar expense lists.                                    | Upstream [#584](https://github.com/spliit-app/spliit/pull/584) / [#586](https://github.com/spliit-app/spliit/pull/586)                                                |
| **Global balance**                           | Net across visited groups on My groups, bucketed by currency.                                                                                            | Upstream [#583](https://github.com/spliit-app/spliit/pull/583)                                                                                                        |
| **Settle in another currency**               | Reimbursements can show the transfer amount in a non-group currency; group amount stays authoritative.                                                   | Upstream [#588](https://github.com/spliit-app/spliit/pull/588)                                                                                                        |
| **Unified share math**                       | One apportionment for balances, stats, CSV, and the form (Hamilton remainder).                                                                           | Upstream [#562](https://github.com/spliit-app/spliit/pull/562)                                                                                                        |
| **Locale week start**                        | Expense/activity “this week” follows the UI locale, not Sunday.                                                                                          | Upstream [#559](https://github.com/spliit-app/spliit/pull/559)                                                                                                        |
| **PWA service worker**                       | Offline shell + update Reload toast; never caches API or mutations. Home-screen name **spli7**.                                                          | Upstream [#587](https://github.com/spliit-app/spliit/pull/587)                                                                                                        |
| **Splitwise import**                         | CSV reconstruction (EN/DE headers) via the same Import control.                                                                                          | Upstream [#483](https://github.com/spliit-app/spliit/pull/483)                                                                                                        |
| **CSV saldo export**                         | Participant columns are per-expense saldo; reimbursements Cost=0.                                                                                        | Upstream [#473](https://github.com/spliit-app/spliit/pull/473)                                                                                                        |
| **Translated page titles**                   | `generateMetadata` + next-intl on group pages.                                                                                                           | Upstream [#537](https://github.com/spliit-app/spliit/pull/537)                                                                                                        |
| **Calendar month grouping**                  | Optional group setting for roommate-style monthly lists.                                                                                                 | Upstream [#530](https://github.com/spliit-app/spliit/pull/530)                                                                                                        |
| **Multiple payers**                          | Split who paid an expense across several participants; balances/export/import aware. Legacy paidById migrates on read.                                   | Upstream [#396](https://github.com/spliit-app/spliit/pull/396)                                                                                                        |
| **Reorder participants**                     | Drag-and-drop + Sort A–Z; order persisted in SQLite.                                                                                                     | Upstream [#416](https://github.com/spliit-app/spliit/pull/416)                                                                                                        |
| **Tricount import**                          | GDPR CSV export via the same Import control as Spliit JSON.                                                                                              | Upstream [#526](https://github.com/spliit-app/spliit/pull/526)                                                                                                        |
| **Keep by-amount shares on reopen**          | Nested share inputs no longer register as their own fields, so reopening an uneven-by-amount expense does not even-split it.                             | Upstream [#638](https://github.com/spliit-app/spliit/pull/638)                                                                                                        |
| **Remainder + named split difference**       | Emptying a by-amount share suggests the remainder as a placeholder; the error names the sum and how far off it is.                                       | Upstream [#639](https://github.com/spliit-app/spliit/pull/639)                                                                                                        |
| **Group expenses by stored calendar day**    | Expense list headers use the DATE column’s calendar day, so the 1st of a month is not filed under last month west of UTC.                                | Upstream [#635](https://github.com/spliit-app/spliit/pull/635)                                                                                                        |
| **Export / input hardening**                 | CSV formula escape, Zod max caps, expense date bounds, security headers, error boundaries.                                                               | Patterns reviewed from [anon-spliit](https://github.com/sora-grayscale/anon-spliit) (adapted for this fork)                                                          |

## Stats (this fork)

On each group’s **Stats** tab:

- **Period** — all time, this month, last 30 days, this year, or a custom from/to range.
- **Summary / spending over time / by participant / by category / recurring** — same cards as upstream [#584](https://github.com/spliit-app/spliit/pull/584); bars drill into the expenses behind them ([#586](https://github.com/spliit-app/spliit/pull/586)).
- **Monthly spending** — stacked category chart for calendar months, with a category breakdown and legend controls.
- **Balance timeline** — cumulative balances over time for participants (engineering fixes on this fork for share math / timeline consistency).

Spending stats exclude reimbursements. Inspired by upstream [#532](https://github.com/spliit-app/spliit/pull/532) / [#555](https://github.com/spliit-app/spliit/pull/555) / [#584](https://github.com/spliit-app/spliit/pull/584); reimplemented against the group API.

## Group import JSON / Tricount / Splitwise (this fork)

On the **Groups** page, use **Import JSON** to upload:

1. A **Spliit JSON** export (this fork or upstream Spliit), or
2. A **Tricount** personal-data / GDPR **CSV** export, or
3. A **Splitwise** **CSV** export (English or German headers).

The format is detected automatically.

Shared behavior:

- Always creates a **new** group (does not overwrite an existing one).
- Regenerates group, participant, and expense IDs so imports never collide with live data.
- Does **not** import a group PIN (PIN must be set again after import).

### Spliit JSON

- Restores participants, expenses (including **multiple payers** when present), split modes, amounts, dates, **notes**, group **information**, and **activity history** (when present in the file).
- Categories: match by `id` when present; otherwise by `name` / `grouping` against the seeded list (many exports omit `id`).
- Newer exports include `exportVersion: 3`, expense `id`s (needed to re-link history), and expense **document links** (`url` / dimensions — not file bytes).
- Document URLs round-trip for migration between Spliit forks; binaries are not embedded, and links may 404 if the original storage expires. Recurring-expense links are still not restored.

### Tricount CSV

- Imports participants and expenses (amounts by share / impacted amounts).
- Uses the CSV default currency (Frankfurter `.dev` for missing cross-rates).
- Notes and activity history are Spliit-only; Tricount imports leave them empty.
- Prior art: upstream [#526](https://github.com/spliit-app/spliit/pull/526).

### Splitwise CSV

- Reconstructs expenses from Splitwise’s balance-delta CSV so resulting **balances match** the export (original split mode may be approximated).
- English and German headers/categories; other Splitwise UI languages: switch Splitwise to English before export.
- Prior art: upstream [#483](https://github.com/spliit-app/spliit/pull/483).

## Removed / disabled upstream features (S3 & OpenAI)

Upstream Spliit optional features that depended on **AWS S3** and **OpenAI** are **not available** in this fork:

| Feature                          | Upstream dependency               | Status here                                                                                      |
| -------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| Expense document / image uploads | S3 (or compatible object storage) | **Removed** from the critical path; UI/API stubs keep flags off. SQLite is not used for binaries. |
| Create expense from receipt scan | OpenAI + storage                  | **Disabled**; no OpenAI client or API keys.                                                      |
| Category extract from text/image | OpenAI                            | **Disabled**; same as above.                                                                     |

What changed vs upstream:

- Prisma and Postgres were replaced with **Turso** (same SQLite schema as the later D1 tables).
- S3/OpenAI packages and env vars were dropped; keep `NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS`, `NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT`, and `NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT` unset or `false` (see `.env.example`).
- Re-enabling uploads later would mean object storage. Receipt/category AI would need an explicit product decision.

## Why not Cloudflare Workers Free

Do **not** host this Next.js app on **Cloudflare Workers Free**. That plan caps CPU at **10 ms** per request. OpenNext SSR for this app measured ~23–90 ms (cold ~700 ms), so two people opening a group at once returned **Error 1102** (Worker exceeded resource limits).

Workers Paid (~$5/month) raises the CPU cap. This fork uses **Vercel Hobby** instead (300 s duration, 4 CPU-hours/month) plus Turso, so concurrent group loads do not 1102.

## Run locally

1. Clone the repository: `git clone https://github.com/t0ma5/spli7.git`
2. Copy `.env.example` to `.env.local` and set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, plus `PIN_SECRET` / `CRON_SECRET` if you need PIN or cron locally
3. Install and apply Turso migrations:

```bash
npm install
npm run db:migrate:local
```

4. Set `NEXT_PUBLIC_BASE_URL` (production is `https://spli7.vercel.app`)
5. Run `npm run dev`

## Deploy to Vercel

GitHub and Vercel are **not** linked by default. Treat them as two separate actions:

1. **GitHub** — `git push` updates the repo. CI (push) only runs types/lint/format/tests.
2. **Vercel** — `npx vercel --prod` (or `npm run deploy`) updates project **spli7**.

Requires **Node.js 22+**.

```bash
npx turso db create spli7
npx turso db show spli7 --url
npx turso db tokens create spli7
npm run db:migrate:remote
npx vercel --prod --yes --name spli7
```

Set these on the Vercel project:

- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`
- `PIN_SECRET` / `CRON_SECRET`
- `NEXT_PUBLIC_BASE_URL=https://spli7.vercel.app`

Turso migrations are **not** applied by `vercel --prod` — run `npm run db:migrate:remote` when `migrations/` changes.

### Ops notes

- Pushing code to GitHub does **not** update the live site until you deploy to Vercel (or link Git).
- Prefer `git` / GitHub CLI over the GitHub web “upload files” UI — uploads often drop directories.
- Vercel Cron in `vercel.json` calls `/api/cron/cleanup-groups` and `/api/cron/recurring` daily when `CRON_SECRET` is set.

## Health check

- `GET /api/health/readiness` or `GET /api/health` — app ready, including a read-only Turso probe
- `GET /api/health/liveness` — process alive only

## Credits & provenance

- **Original Spliit** — idea, UI, and core expense-splitting product by [Sebastien Castiel](https://github.com/scastiel) and contributors: [spliit-app/spliit](https://github.com/spliit-app/spliit) · [spliit.app](https://spliit.app).
- **[Spliit Cloud](https://spliit.cloud)** ([antonio-ivanovski/spliit-cloud](https://github.com/antonio-ivanovski/spliit-cloud)) — community fork that continues Spliit with new features. Several UX improvements in _this_ fork were prioritized from their [roadmap](https://github.com/antonio-ivanovski/spliit-cloud/blob/main/ROADMAP.md) and upstream issue links (reimplemented for SQLite, not a code port of their Postgres/API stack).
- **[anon-spliit](https://github.com/sora-grayscale/anon-spliit)** ([sora-grayscale](https://github.com/sora-grayscale)) — privacy-focused fork (E2EE, private instance, deletion/auto-delete). This fork adapted selected **lifecycle and hardening** ideas from that work; it does **not** port their end-to-end encryption or account/2FA stack.

## License

MIT, see [LICENSE](./LICENSE). Same license family as upstream Spliit and Spliit Cloud; retain their copyright notices where applicable.
