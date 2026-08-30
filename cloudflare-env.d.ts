/// <reference types="@cloudflare/workers-types" />

interface CloudflareEnv {
  DATABASE: D1Database
  /** Legacy KV namespace, used only for /api/cron/migrate-kv */
  DB?: KVNamespace
  ASSETS?: Fetcher
  WORKER_SELF_REFERENCE?: Fetcher
  NEXT_PUBLIC_BASE_URL?: string
  NEXT_PUBLIC_DEFAULT_CURRENCY_CODE?: string
  NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS?: string
  NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT?: string
  NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT?: string
  CRON_SECRET?: string
  PIN_SECRET?: string
}
