'use server'

import { documentsConfigured } from './documents'
import { env } from './env'

export async function getRuntimeFeatureFlags() {
  return {
    // Receipt photos need the flag and a connected private Vercel Blob store.
    enableExpenseDocuments:
      env.NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS && documentsConfigured(),
    enableReceiptExtract: env.NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT,
    enableCategoryExtract: env.NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT,
  }
}

export type RuntimeFeatureFlags = Awaited<
  ReturnType<typeof getRuntimeFeatureFlags>
>
