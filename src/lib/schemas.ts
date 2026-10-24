import { evaluateAmountExpression } from '@/lib/amount-expression'
import type { SplitMode } from '@/lib/kv/types'
import {
  parsePaymentMethods,
  paymentMethodsSchema,
} from '@/lib/payment-methods'
import Decimal from 'decimal.js'

import * as z from 'zod'

export const GROUP_INFORMATION_MAX = 10_000
export const EXPENSE_NOTES_MAX = 5_000

export const groupFormSchema = z
  .object({
    name: z.string().min(2, 'min2').max(50, 'max50'),
    information: z.string().max(GROUP_INFORMATION_MAX, 'max10000').optional(),
    currency: z.string().min(1, 'min1').max(5, 'max5'),
    currencyCode: z.union([z.string().length(3).nullish(), z.literal('')]), // ISO-4217 currency code
    defaultSplitMode: z
      .enum(['EVENLY', 'BY_SHARES', 'BY_PERCENTAGE', 'BY_AMOUNT'])
      .default('EVENLY'),
    currentPin: z.string().max(32).optional(),
    newPin: z
      .union([z.string().regex(/^\d{6,8}$/, 'pinFormat'), z.literal('')])
      .optional(),
    clearPin: z.boolean().optional(),
    fixedExpenseDateGroups: z.boolean().default(false),
    participants: z
      .array(
        z.object({
          id: z.string().max(30).optional(),
          name: z.string().min(2, 'min2').max(50, 'max50'),
          paymentMethods: paymentMethodsSchema.optional(),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine(({ participants, newPin, clearPin }, ctx) => {
    participants.forEach((participant, i) => {
      participants.slice(0, i).forEach((otherParticipant) => {
        if (otherParticipant.name === participant.name) {
          ctx.addIssue({
            code: 'custom',
            message: 'duplicateParticipantName',
            path: ['participants', i, 'name'],
          })
        }
      })
    })
    if (newPin && clearPin) {
      ctx.addIssue({
        code: 'custom',
        message: 'pinConflict',
        path: ['newPin'],
      })
    }
  })

export type GroupFormValues = z.output<typeof groupFormSchema>
export type GroupFormInput = z.input<typeof groupFormSchema>

/**
 * A number, or the text a form input holds. Text is parsed after the union:
 * when every option of a zod 4 union fails, the form resolver shows the first
 * option's English message instead of the translated key.
 */
function numberOrText(requiredError?: string) {
  const error = (issue: { input?: unknown }) =>
    issue.input === undefined ? requiredError : undefined
  return z.union([z.number({ error }), z.string({ error })])
}

function parsedNumber(
  parse: (value: string) => number | null,
  requiredError?: string,
) {
  return numberOrText(requiredError).transform((value, ctx) => {
    if (typeof value === 'number') return value
    const valueAsNumber = parse(value)
    if (valueAsNumber === null || Number.isNaN(valueAsNumber)) {
      ctx.addIssue({
        code: 'custom',
        message: 'invalidNumber',
      })
      return z.NEVER
    }
    return valueAsNumber
  })
}

const inputCoercedToNumber = parsedNumber(Number)

const paidByAmountSchema = parsedNumber(
  evaluateAmountExpression,
  'amountRequired',
)
  .refine((amount) => amount != 0, 'amountNotZero')
  .refine((amount) => amount <= 10_000_000_00, 'amountTenMillion')

function rejectDuplicateParticipants(
  rows: { participant: string }[],
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>()
  rows.forEach(({ participant }, index) => {
    if (seen.has(participant)) {
      ctx.addIssue({
        code: 'custom',
        message: 'duplicateParticipant',
        path: [index, 'participant'],
      })
    }
    seen.add(participant)
  })
}

export const expenseFormSchema = z
  .object({
    expenseDate: z.coerce
      .date({
        // A cleared date field coerces to Invalid Date; zod's own text is
        // English only.
        error: (issue) =>
          issue.code === 'invalid_type' ? 'invalidDate' : undefined,
      })
      .refine((date) => {
        const max = new Date()
        max.setUTCFullYear(max.getUTCFullYear() + 1)
        return date <= max
      }, 'expenseDateTooFar')
      .refine((date) => {
        const min = new Date()
        min.setUTCFullYear(min.getUTCFullYear() - 5)
        return date >= min
      }, 'expenseDateTooOld'),
    title: z
      .string({
        error: (issue) =>
          issue.input === undefined ? 'titleRequired' : undefined,
      })
      .min(2, 'min2')
      .max(200, 'max200'),
    category: z.coerce.number().int().min(0).max(1000).default(0),
    /** Synced from sum of paidBy in the form; overwritten by transform. */
    amount: parsedNumber(evaluateAmountExpression).optional(),
    originalAmount: z
      .union([
        // Number first: on text that is no number both options fail with one
        // issue each, and the resolver then shows the first one.
        inputCoercedToNumber
          .refine((amount) => amount != 0, 'amountNotZero')
          .refine((amount) => amount <= 10_000_000_00, 'amountTenMillion'),
        z.literal('').transform(() => undefined),
      ])
      .optional(),
    originalCurrency: z.union([z.string().length(3).nullish(), z.literal('')]),
    conversionRate: z
      .union([
        inputCoercedToNumber.refine((amount) => amount > 0, 'ratePositive'),
        z.literal('').transform(() => undefined),
      ])
      .optional(),
    paidBy: z
      .array(
        z.object({
          participant: z
            .string({
              error: (issue) =>
                issue.input === undefined ? 'paidByRequired' : undefined,
            })
            .max(30),
          amount: paidByAmountSchema,
        }),
      )
      .min(1, 'paidByRequired')
      .max(100)
      .superRefine(rejectDuplicateParticipants),
    paidFor: z
      .array(
        z.object({
          participant: z.string().max(30),
          originalAmount: z.string().optional(), // For converting shares by amounts in original currency, not saved.
          shares: numberOrText().transform((value, ctx) => {
            if (
              typeof value === 'string' &&
              Number.isNaN(Number(value.replace(/,/g, '.')))
            )
              ctx.addIssue({
                code: 'custom',
                message: 'invalidNumber',
              })
            return value
          }),
        }),
      )
      .min(1, 'paidForMin1')
      .max(500)
      .superRefine(rejectDuplicateParticipants)
      .superRefine((paidFor, ctx) => {
        for (const { shares } of paidFor) {
          const shareNumber = Number(String(shares).replace(/,/g, '.'))
          if (!Number.isFinite(shareNumber) || shareNumber <= 0) {
            ctx.addIssue({
              code: 'custom',
              message: 'noZeroShares',
            })
          }
        }
      }),
    splitMode: z
      .enum(['EVENLY', 'BY_SHARES', 'BY_PERCENTAGE', 'BY_AMOUNT'])
      .default('EVENLY'),
    saveDefaultSplittingOptions: z.boolean(),
    isReimbursement: z.boolean(),
    documents: z
      .array(
        z.object({
          id: z.string().max(30),
          url: z
            .string()
            .max(200)
            .regex(
              /^\/api\/groups\/[A-Za-z0-9_-]{1,64}\/documents\/[A-Za-z0-9_-]{21}$/,
              'invalidDocument',
            ),
          width: z.number().int().min(1),
          height: z.number().int().min(1),
        }),
      )
      .max(100)
      .default([]),
    notes: z.string().max(EXPENSE_NOTES_MAX, 'max5000').optional(),
    recurrenceRule: z
      .enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'])
      .default('NONE'),
  })
  .superRefine((expense, ctx) => {
    const totalAmount = expense.paidBy.reduce(
      (sum, { amount }) => sum + Number(amount),
      0,
    )
    if (totalAmount === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'amountNotZero',
        path: ['paidBy'],
      })
    }
    if (Math.abs(totalAmount) > 10_000_000_00) {
      ctx.addIssue({
        code: 'custom',
        message: 'amountTenMillion',
        path: ['paidBy'],
      })
    }

    switch (expense.splitMode) {
      case 'EVENLY':
        break // noop
      case 'BY_SHARES':
        break // noop
      case 'BY_AMOUNT': {
        const sum = expense.paidFor.reduce((sum, { shares }) => {
          // Same normalisation as the share itself above. An emptied or
          // half-typed input is reported as an invalid share on its own; it
          // must not make the sum of the others throw.
          const value = String(shares).replace(/,/g, '.').trim()
          return value === '' || Number.isNaN(Number(value))
            ? sum
            : sum.add(value)
        }, new Decimal(0))
        // Sum the payers exactly too: as floats 10.10 + 20.20 is
        // 30.299999999999997, which no share total can ever equal.
        const paidTotal = expense.paidBy.reduce(
          (total, { amount }) =>
            Number.isFinite(Number(amount)) ? total.add(String(amount)) : total,
          new Decimal(0),
        )
        if (!sum.equals(paidTotal)) {
          // The message names the sum and how far off it is. Issue params do
          // not survive the form resolver, so the expense form computes those
          // values itself and hands them to the message.
          ctx.addIssue({
            code: 'custom',
            message: 'amountSum',
            path: ['paidFor'],
          })
        }
        break
      }
      case 'BY_PERCENTAGE': {
        const sum = expense.paidFor.reduce(
          (sum, { shares }) =>
            sum +
            (typeof shares === 'string'
              ? Math.round(Number(shares) * 100)
              : Number(shares)),
          0,
        )
        if (sum !== 10000) {
          ctx.addIssue({
            code: 'custom',
            message: 'percentageSum',
            path: ['paidFor'],
          })
        }
        break
      }
    }
  })
  .transform((expense) => {
    const amount = expense.paidBy.reduce(
      (sum, { amount }) => sum + Number(amount),
      0,
    )
    return {
      ...expense,
      amount,
      paidFor: expense.paidFor.map((paidFor) => {
        const shares = paidFor.shares
        if (typeof shares === 'string' && expense.splitMode !== 'BY_AMOUNT') {
          return {
            ...paidFor,
            shares: Math.round(Number(shares) * 100),
          }
        }
        return {
          ...paidFor,
          shares: Number(shares),
        }
      }),
    }
  })

export type ExpenseFormValues = z.output<typeof expenseFormSchema>
// Raw form input type (before zod transforms/coercions). react-hook-form
// operates on these values; the resolver produces ExpenseFormValues on submit.
export type ExpenseFormInput = z.input<typeof expenseFormSchema>

export type SplittingOptions = {
  // Used for saving default splitting options in localStorage
  splitMode: SplitMode
  paidFor: ExpenseFormValues['paidFor'] | null
}

/** Same bound as the expense form, in minor units, either sign. */
const IMPORT_AMOUNT_MAX = 10_000_000_00
const importAmountSchema = z
  .number()
  .int()
  .min(-IMPORT_AMOUNT_MAX, 'amountTenMillion')
  .max(IMPORT_AMOUNT_MAX, 'amountTenMillion')

const importPaidByEntrySchema = z.object({
  participantId: z.string().min(1),
  amount: importAmountSchema,
})

/** Matches the JSON shape produced by getGroupForExport /expenses/export/json */
export const groupImportSchema = z
  .object({
    exportVersion: z.number().int().optional(),
    id: z.string().optional(),
    name: z.string().min(1).max(50),
    information: z.string().max(GROUP_INFORMATION_MAX).nullish(),
    currency: z.string().min(1).max(5),
    currencyCode: z.union([z.string().length(3).nullish(), z.literal('')]),
    defaultSplitMode: z
      .enum(['EVENLY', 'BY_SHARES', 'BY_PERCENTAGE', 'BY_AMOUNT'])
      .nullish(),
    participants: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1).max(50),
          // Lenient: an export from another version may hold methods this
          // one does not know; those are dropped, not fatal.
          paymentMethods: z
            .unknown()
            .optional()
            .transform((value) => parsePaymentMethods(value ?? [])),
        }),
      )
      .min(1)
      .max(100),
    expenses: z
      .array(
        z.object({
          id: z.string().optional(),
          createdAt: z.coerce.date(),
          expenseDate: z.coerce.date(),
          title: z.string().min(1).max(200),
          category: z
            .object({
              id: z.number().int().optional(),
              grouping: z.string().optional(),
              name: z.string().optional(),
            })
            .nullish(),
          amount: importAmountSchema,
          originalAmount: z.number().int().nullish(),
          originalCurrency: z.string().nullish(),
          conversionRate: z.number().nullish(),
          paidBy: z.array(importPaidByEntrySchema).min(1).max(100).optional(),
          paidById: z.string().min(1).optional(),
          paidFor: z
            .array(
              z.object({
                participantId: z.string().min(1),
                shares: z.number().int(),
              }),
            )
            .min(1)
            .max(500),
          isReimbursement: z.boolean(),
          splitMode: z.enum([
            'EVENLY',
            'BY_SHARES',
            'BY_PERCENTAGE',
            'BY_AMOUNT',
          ]),
          recurrenceRule: z
            .enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'])
            .nullish(),
          notes: z.string().max(EXPENSE_NOTES_MAX).nullish(),
          documents: z
            .array(
              z.object({
                id: z.string().min(1).max(30).optional(),
                // Older exports may hold upstream S3 links; the importer only
                // copies this app's own receipts and drops the rest.
                url: z.string().max(2000),
                width: z.number().int().min(1),
                height: z.number().int().min(1),
              }),
            )
            .max(100)
            .optional()
            .default([]),
        }),
      )
      .max(10_000)
      .default([]),
    activities: z
      .array(
        z.object({
          time: z.coerce.date(),
          activityType: z.enum([
            'UPDATE_GROUP',
            'CREATE_EXPENSE',
            'UPDATE_EXPENSE',
            'DELETE_EXPENSE',
          ]),
          participantId: z.string().nullish(),
          expenseId: z.string().nullish(),
          data: z.string().max(2000).nullish(),
        }),
      )
      .max(50_000)
      .default([]),
  })
  .superRefine((data, ctx) => {
    const participantIds = new Set(data.participants.map((p) => p.id))
    const seenIds = new Set<string>()
    const seenNames = new Set<string>()
    data.participants.forEach((participant, index) => {
      if (seenIds.has(participant.id)) {
        ctx.addIssue({
          code: 'custom',
          message: 'duplicateParticipantId',
          path: ['participants', index, 'id'],
        })
      }
      seenIds.add(participant.id)
      if (seenNames.has(participant.name)) {
        ctx.addIssue({
          code: 'custom',
          message: 'duplicateParticipantName',
          path: ['participants', index, 'name'],
        })
      }
      seenNames.add(participant.name)
    })

    /** Flags a participant listed twice in one expense's paidBy or paidFor. */
    const checkUnique = (
      entries: { participantId: string }[],
      expenseIndex: number,
      field: 'paidBy' | 'paidFor',
    ) => {
      const seen = new Set<string>()
      entries.forEach((entry, index) => {
        if (seen.has(entry.participantId)) {
          ctx.addIssue({
            code: 'custom',
            message:
              field === 'paidBy' ? 'duplicatePaidBy' : 'duplicatePaidFor',
            path: ['expenses', expenseIndex, field, index, 'participantId'],
          })
        }
        seen.add(entry.participantId)
      })
    }

    data.expenses.forEach((expense, expenseIndex) => {
      const paidByEntries =
        expense.paidBy && expense.paidBy.length > 0
          ? expense.paidBy
          : expense.paidById
            ? [{ participantId: expense.paidById, amount: expense.amount }]
            : []

      checkUnique(paidByEntries, expenseIndex, 'paidBy')
      checkUnique(expense.paidFor, expenseIndex, 'paidFor')

      const paidTotal = paidByEntries.reduce(
        (sum, entry) => sum + entry.amount,
        0,
      )
      if (paidByEntries.length > 0 && paidTotal !== expense.amount) {
        ctx.addIssue({
          code: 'custom',
          message: 'paidBySum',
          path: ['expenses', expenseIndex, 'paidBy'],
        })
      }

      // Shares are weights, so they must all be positive. A BY_AMOUNT income
      // (negative amount) may instead carry all-negative shares, as earlier
      // imports stored refunds that way; mixed signs are always rejected.
      const sharesValid =
        expense.paidFor.every(({ shares }) => shares > 0) ||
        (expense.splitMode === 'BY_AMOUNT' &&
          expense.amount < 0 &&
          expense.paidFor.every(({ shares }) => shares < 0))
      if (!sharesValid) {
        ctx.addIssue({
          code: 'custom',
          message: 'noZeroShares',
          path: ['expenses', expenseIndex, 'paidFor'],
        })
      }

      if (paidByEntries.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'unknownPaidBy',
          path: ['expenses', expenseIndex, 'paidBy'],
        })
      }

      paidByEntries.forEach((entry, paidByIndex) => {
        if (!participantIds.has(entry.participantId)) {
          ctx.addIssue({
            code: 'custom',
            message: 'unknownPaidBy',
            path: [
              'expenses',
              expenseIndex,
              'paidBy',
              paidByIndex,
              'participantId',
            ],
          })
        }
      })

      expense.paidFor.forEach((paidFor, paidForIndex) => {
        if (!participantIds.has(paidFor.participantId)) {
          ctx.addIssue({
            code: 'custom',
            message: 'unknownPaidFor',
            path: [
              'expenses',
              expenseIndex,
              'paidFor',
              paidForIndex,
              'participantId',
            ],
          })
        }
      })
    })
  })

export type GroupImportValues = z.infer<typeof groupImportSchema>
