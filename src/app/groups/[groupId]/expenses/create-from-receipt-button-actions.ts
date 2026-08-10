'use server'

/**
 * Receipt extract via OpenAI is not available on the Cloudflare KV deploy.
 * Kept as a stub so the UI can remain gated behind feature flags.
 */
export async function extractExpenseInformationFromImage(_imageUrl: string) {
  throw new Error(
    'Receipt extract is not supported on the Cloudflare KV deploy.',
  )
}

export type ReceiptExtractedInfo = Awaited<
  ReturnType<typeof extractExpenseInformationFromImage>
>
