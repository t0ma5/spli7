---
name: spl1t-d1
description: spl1t data layer, PIN auth, and Turso/libSQL conventions. Use when editing groups, expenses, tRPC procedures, migrations, cron jobs, or anything that reads/writes group data.
---

# spl1t + Turso

## Database

- Primary store is **Turso** (libSQL/SQLite). Schema lives in `migrations/`.
- Application access: `getRepository()` in `src/lib/db/index.ts`. Tests inject `createMemoryRepository()`.
- Do not add Prisma, Postgres, D1 bindings, or write new `group:{id}` KV documents.
- Mutations go through `withGroupWrite` / `repo.save` (group metadata, imports, recurring materialization) or `withExpenseWrite` / `repo.mutateExpenses` (create/update/delete expense, logActivity) so those hot paths never `get()` the full group.
- Expense/activity lists use keyset cursors (`after` + `LIMIT`), not `OFFSET`. Balances/stats load compact expense rows (no documents/recurring links). Export reads `getMeta` + `listExpenses` / `listActivities` rather than `get()`.
- Amounts are **integer minor units**. Validate with `assertIntegerMinorUnits` on write.

## Runtime

- Production is Vercel project **spli7** (`https://spli7.vercel.app`). Hobby function duration is 300s; there is no 10ms CPU cap.
- Keep group reads/writes surgical. Turso Free meters **rows read**; unindexed scans can hit the monthly cap.

## PIN

- `assertGroupUnlocked(groupId)` on every group-scoped tRPC procedure and both export routes.
- Unlock cookie is HTTP-only HMAC (`PIN_SECRET`). Do not trust `sessionStorage`.
- Hash new PINs with PBKDF2 (`hashGroupPin`). Legacy SHA-256 hashes still verify and upgrade on success.

## Cron

- HTTP endpoints under `src/app/api/cron/` require `Authorization: Bearer $CRON_SECRET` (`src/lib/cron-auth.ts`).
- Vercel Cron in `vercel.json` hits `/api/cron/recurring` and `/api/cron/cleanup-groups` daily. Do not schedule cleanup unless inactivity uses `lastSeenAt` (already wired).

## Feature flags

- Keep `NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS`, `RECEIPT_EXTRACT`, and `CATEGORY_EXTRACT` false (`src/lib/env.ts` refuses boot otherwise).
