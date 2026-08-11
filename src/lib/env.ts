import { ZodIssueCode, z } from 'zod'

const interpretEnvVarAsBool = (val: unknown): boolean => {
  if (typeof val !== 'string') return false
  return ['true', 'yes', '1', 'on'].includes(val.toLowerCase())
}

const envSchema = z
  .object({
    NEXT_PUBLIC_BASE_URL: z
      .string()
      .optional()
      .default('http://localhost:3000'),
    NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    NEXT_PUBLIC_DEFAULT_CURRENCY_CODE: z.string().optional(),
    NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
    NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT: z.preprocess(
      interpretEnvVarAsBool,
      z.boolean().default(false),
    ),
  })
  .superRefine((env, ctx) => {
    if (env.NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message:
          'Expense documents are not supported in the Cloudflare KV deploy yet. Keep NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS unset/false.',
      })
    }
    if (
      env.NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT ||
      env.NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT
    ) {
      ctx.addIssue({
        code: ZodIssueCode.custom,
        message:
          'Receipt/category extract features are not supported in the Cloudflare KV deploy yet. Keep those flags unset/false.',
      })
    }
  })

export const env = envSchema.parse(process.env)
