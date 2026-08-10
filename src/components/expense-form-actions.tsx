'use server'

/**
 * Category extract via OpenAI is not available on the Cloudflare KV deploy.
 * Kept as a stub so the UI can remain gated behind feature flags.
 */
export async function extractCategoryFromTitle(_description: string) {
  throw new Error(
    'Category extract is not supported on the Cloudflare KV deploy.',
  )
}

export type TitleExtractedInfo = Awaited<
  ReturnType<typeof extractCategoryFromTitle>
>
