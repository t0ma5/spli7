import { SplitwiseExportLanguage } from './header-detection'

export type Shares = Record<string, number>
export type Deltas = Record<string, number>

export type ReimbursementModel = {
  description: string
  payer: string
  receiver: string
  amountC: number
}

export type GroupExpenseModel = {
  description: string
  payer: string
  participants: string[]
  totalC: number
  sharesC: Shares
}

export type ParsedRowModel = {
  groupExpenses: GroupExpenseModel[]
  reimbursements: ReimbursementModel[]
}

const REIMBURSEMENT_TEMPLATES: Record<string, string> = {
  de: '{payer} zahlt {receiver}',
  en: '{payer} pays {receiver}',
  fr: '{payer} paie {receiver}',
  es: '{payer} paga a {receiver}',
}

export const formatReimbursementTitle = (
  payerName: string,
  receiverName: string,
  language: SplitwiseExportLanguage,
): string => {
  const langKey = language === 'unknown' ? 'en' : language
  const template =
    REIMBURSEMENT_TEMPLATES[langKey] ?? REIMBURSEMENT_TEMPLATES['en']

  return template
    .replace('{payer}', payerName)
    .replace('{receiver}', receiverName)
}

const MAX_DELTA_DRIFT_CENTS = 1

export const parseExportRow = (
  description: string,
  isPaymentCategory: boolean,
  totalC: number,
  participants: string[],
  deltasC: Deltas,
): ParsedRowModel => {
  let sumDeltas = participants.reduce((s, p) => s + (deltasC[p] ?? 0), 0)
  if (sumDeltas !== 0) {
    const drift = sumDeltas
    const driftAbs = Math.abs(drift)
    if (driftAbs <= MAX_DELTA_DRIFT_CENTS && participants.length > 0) {
      const first = participants[0]
      if (first) {
        deltasC[first] = (deltasC[first] ?? 0) - drift
        sumDeltas = 0
      }
    }
  }

  if (sumDeltas !== 0) {
    throw new Error(
      `sum(deltas) != 0 (${sumDeltas}); row is inconsistent even after drift correction`,
    )
  }

  if (isPaymentCategory) {
    return {
      groupExpenses: [],
      reimbursements: decomposeDeltasToReimbursements(
        description,
        participants,
        deltasC,
      ),
    }
  }

  if (totalC <= 0) {
    throw new Error('totalC must be positive for Splitwise rows')
  }

  const { payments, shares } = reconstructPaymentsAndShares(
    totalC,
    participants,
    deltasC,
  )

  const groupExpenses: GroupExpenseModel[] = []

  for (const payer of participants) {
    const payAmt = payments[payer] ?? 0
    if (payAmt > 0) {
      const expenseShares: Shares = {}
      let remaining = payAmt

      for (const p of participants) {
        if (remaining <= 0) break
        const target = shares[p] ?? 0
        if (target > 0) {
          const take = Math.min(remaining, target)
          expenseShares[p] = take
          shares[p] = target - take
          remaining -= take
        }
      }

      if (remaining > 0) {
        expenseShares[payer] = (expenseShares[payer] ?? 0) + remaining
      }

      groupExpenses.push({
        description,
        payer,
        participants,
        totalC: payAmt,
        sharesC: filterZeroShares(expenseShares),
      })
    }
  }

  return { groupExpenses, reimbursements: [] }
}

const filterZeroShares = (shares: Shares): Shares => {
  const result: Shares = {}
  for (const [k, v] of Object.entries(shares)) {
    if (v > 0) result[k] = v
  }
  return result
}

const decomposeDeltasToReimbursements = (
  description: string,
  participants: string[],
  deltasC: Deltas,
): ReimbursementModel[] => {
  const positives: Array<[string, number]> = []
  const negatives: Array<[string, number]> = []
  for (const p of participants) {
    const d = deltasC[p] ?? 0
    if (d > 0) positives.push([p, d])
    else if (d < 0) negatives.push([p, -d])
  }

  const reimbursements: ReimbursementModel[] = []
  let i = 0
  let j = 0

  while (i < positives.length && j < negatives.length) {
    const posEntry = positives[i]
    const negEntry = negatives[j]
    if (!posEntry || !negEntry) break

    let [payer, budget] = posEntry
    let [recv, need] = negEntry
    const amt = Math.min(budget, need)
    if (amt > 0) {
      reimbursements.push({
        description,
        payer,
        receiver: recv,
        amountC: amt,
      })
      budget -= amt
      need -= amt
    }

    if (budget === 0) i += 1
    else positives[i] = [payer, budget]

    if (need === 0) j += 1
    else negatives[j] = [recv, need]
  }

  return reimbursements
}

const reconstructPaymentsAndShares = (
  totalC: number,
  participants: string[],
  deltasC: Deltas,
): { payments: Shares; shares: Shares } => {
  const N = participants.length

  if (N === 0) return { payments: {}, shares: {} }

  let maxDelta = -Infinity
  let primaryPayer = participants[0]
  let sumPos = 0

  for (const p of participants) {
    const d = deltasC[p] ?? 0
    if (d > maxDelta) {
      maxDelta = d
      primaryPayer = p
    }
    if (d > 0) {
      sumPos += d
    }
  }

  if (
    participants.length > 0 &&
    participants.every((p) => (deltasC[p] ?? 0) === 0)
  ) {
    const payments: Shares = {}
    const shares: Shares = {}
    const base = Math.floor(totalC / N)
    let rem = totalC % N

    for (const p of participants) {
      const amt = base + (rem > 0 ? 1 : 0)
      payments[p] = amt
      shares[p] = amt
      if (rem > 0) rem--
    }

    return { payments, shares }
  }

  let singlePayerPossible = true
  const singlePayerShares: Shares = {}

  for (const p of participants) {
    const pay = p === primaryPayer ? totalC : 0
    const d = deltasC[p] ?? 0
    const s = pay - d

    if (s < 0) {
      singlePayerPossible = false
      break
    }

    singlePayerShares[p] = s
  }

  if (singlePayerPossible) {
    const payments: Shares = {}
    payments[primaryPayer] = totalC
    return { payments, shares: singlePayerShares }
  }

  const equalBase = Math.floor(totalC / N)
  const equalPayments: Shares = {}
  let equalPossible = true
  const equalShares: Shares = {}

  for (const p of participants) {
    equalShares[p] = equalBase
  }

  let remainder = totalC % N
  for (let i = 0; i < remainder; i++) {
    equalShares[participants[i]]! += 1
  }

  for (const p of participants) {
    const s = equalShares[p]!
    const d = deltasC[p] ?? 0
    const pImplied = s + d

    if (pImplied < 0) {
      equalPossible = false
      break
    }

    equalPayments[p] = pImplied
  }

  if (equalPossible) {
    return { payments: equalPayments, shares: equalShares }
  }

  const payments: Shares = {}
  const shares: Shares = {}

  for (const p of participants) {
    const d = deltasC[p] ?? 0
    payments[p] = d > 0 ? d : 0
  }

  const unallocatedCost = totalC - sumPos
  if (primaryPayer) {
    payments[primaryPayer] = (payments[primaryPayer] ?? 0) + unallocatedCost
  }

  for (const p of participants) {
    const pay = payments[p] ?? 0
    const d = deltasC[p] ?? 0
    shares[p] = pay - d
  }

  return { payments, shares }
}
