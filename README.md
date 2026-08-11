[<img alt="Spliit" height="60" src="https://github.com/spliit-app/spliit/blob/main/public/logo-with-text.png?raw=true" />](https://spliit.app)

Spliit is a free and open source alternative to Splitwise. This fork is adapted to deploy on **Cloudflare Workers** (via OpenNext) with **Cloudflare KV** as the database — not Vercel Postgres / Prisma.

## Features

- [x] Create a group and share it with friends
- [x] Create expenses with description
- [x] Display group balances
- [x] Create reimbursement expenses
- [x] Progressive Web App
- [x] Select all/no participant for expenses
- [x] Split expenses unevenly
- [x] Mark a group as favorite
- [x] Tell the application who you are when opening a group
- [x] Assign a category to expenses
- [x] Search for expenses in a group
- [x] Export a group to JSON or CSV
- [x] Import a group from a Spliit JSON export (creates a **new** group with remapped IDs)
- [ ] Upload and attach images to expenses (removed — see below)
- [ ] Create expense by scanning a receipt (removed — see below)

## Stack

- [Next.js](https://nextjs.org/) for the web application
- [TailwindCSS](https://tailwindcss.com/) for the styling
- [shadcn/UI](https://ui.shadcn.com/) for the UI components
- [Cloudflare KV](https://developers.cloudflare.com/kv/) for persistence (denormalized group documents)
- [OpenNext Cloudflare](https://opennext.js.org/cloudflare) + [Workers](https://developers.cloudflare.com/workers/) for hosting

## Data model notes

- Each group is stored as a single KV value under `group:{groupId}`.
- Categories are seeded under the `categories` key.
- Concurrent edits to the same group use **last-write-wins** (no Durable Objects / transactions).
- Friend-sized groups fit this model; very large groups may hit KV value size limits.

## JSON import

On the **Groups** page, use **Import JSON** to upload a file produced by **Export to JSON**.

- Always creates a **new** group (does not overwrite an existing one).
- Regenerates group, participant, and expense IDs so imports never collide with live data.
- Restores participants, expenses, split modes, categories (by id), amounts, and dates.
- Does **not** restore expense attachments, notes, activity history, or active recurring-expense links (those were never part of the export format).

## Removed / disabled upstream features (S3 & OpenAI)

Upstream Spliit optional features that depended on **AWS S3** and **OpenAI** are **not available** in this Cloudflare KV fork:

| Feature | Upstream dependency | Status here |
| --- | --- | --- |
| Expense document / image uploads | S3 (or compatible object storage) | **Removed** from the critical path; UI/API stubs keep flags off. KV is not used for binaries. |
| Create expense from receipt scan | OpenAI + storage | **Disabled**; no OpenAI client or API keys. |
| Category extract from text/image | OpenAI | **Disabled**; same as above. |

What changed vs upstream:

- Prisma, Postgres, and Vercel-oriented DB wiring were replaced with the KV group-document API.
- S3/OpenAI packages and env vars were dropped; keep `NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS`, `NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT`, and `NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT` unset or `false` (see `.env.example`).
- Re-enabling uploads later would mean adding something like **R2** (not stuffing files into KV). Receipt/category AI would need a Workers-compatible provider and explicit product work.

## Run locally

1. Clone the repository
2. Copy `.env.example` to `.env` and `.dev.vars` (already present for Wrangler) as needed
3. Create a KV namespace and put its id in [`wrangler.jsonc`](wrangler.jsonc):

```bash
npx wrangler kv namespace create spliit-db
npx wrangler kv namespace create spliit-db --preview
```

4. Run `npm install`
5. Run `npm run dev` for Next.js local development (bindings via OpenNext), or `npm run preview` to build and run in the Workers runtime

## Deploy to Cloudflare

```bash
npm run deploy
```

This runs `opennextjs-cloudflare build` then deploys the Worker. Ensure the `DB` KV binding in `wrangler.jsonc` points at your namespace.

Alternatively, connect the repo to Cloudflare Workers Builds / Pages and use the same build command.

## Health check

- `GET /api/health/readiness` or `GET /api/health` — app ready, including KV connectivity
- `GET /api/health/liveness` — process alive only

## License

MIT, see [LICENSE](./LICENSE).
