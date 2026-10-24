'use server'

import { env } from './env'

export async function getRuntimeFeatureFlags() {
  return {
    // Receipt photos need the flag and a Vercel Blob store (private).
    enableExpenseDocuments:
      env.NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS &&
      Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    enableReceiptExtract: env.NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT,
    enableCategoryExtract: env.NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT,
  }
}

export type RuntimeFeatureFlags = Awaited<
  ReturnType<typeof getRuntimeFeatureFlags>
>
