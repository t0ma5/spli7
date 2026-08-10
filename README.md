[<img alt="Spliit" height="60" src="https://github.com/spliit-app/spliit/blob/main/public/logo-with-text.png?raw=true" />](https://spliit.app)

Spliit is a free and open source alternative to Splitwise. This fork is adapted to deploy on **Cloudflare Pages / Workers** with **Cloudflare KV** as the database.

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
- [ ] Upload and attach images to expenses (deferred on Cloudflare KV deploy)
- [ ] Create expense by scanning a receipt (deferred on Cloudflare KV deploy)

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

## Opt-in features (not available yet)

Expense documents, receipt extract, and category extract from upstream Spliit depend on S3/OpenAI and are **disabled** on this Cloudflare KV deploy. Keep the related `NEXT_PUBLIC_ENABLE_*` flags unset/false.

## License

MIT, see [LICENSE](./LICENSE).
