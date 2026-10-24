jest.mock('nanoid', () => {
  let n = 0
  return { nanoid: () => `pm${++n}` }
})

import {
  createGroup,
  createGroupFromImport,
  getGroup,
  getGroupForExport,
  updateGroup,
} from '@/lib/api'
import { setRepositoryForTests } from '@/lib/db'
import { diffGroupChildren } from '@/lib/db/group-patch'
import { createMemoryRepository } from '@/lib/db/memory'
import type { GroupDocument } from '@/lib/kv/types'
import { groupFormSchema, groupImportSchema } from '@/lib/schemas'

const sepa = {
  type: 'sepa' as const,
  name: 'Ada Lovelace',
  iban: 'FI2112345600000785',
}

function form(paymentMethods?: unknown[]) {
  return groupFormSchema.parse({
    name: 'Trip',
    currency: '€',
    currencyCode: 'EUR',
    participants: [{ name: 'Ada', paymentMethods }, { name: 'Bob' }],
  })
}

describe('participant payment methods', () => {
  beforeEach(() => setRepositoryForTests(createMemoryRepository()))
  afterEach(() => setRepositoryForTests(null))

  it('rejects an invalid IBAN in the group form', () => {
    const result = groupFormSchema.safeParse({
      name: 'Trip',
      currency: '€',
      currencyCode: 'EUR',
      participants: [
        {
          name: 'Ada',
          paymentMethods: [{ ...sepa, iban: 'FI2112345600000786' }],
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('saves, edits, exports and imports them', async () => {
    const group = await createGroup(form([sepa]))
    const ada = group.participants.find((p) => p.name === 'Ada')!
    expect(ada.paymentMethods).toEqual([sepa])

    // Editing only the payment details is a change worth saving.
    const values = form([{ type: 'mobilepay', phone: '+358 40 123 4567' }])
    values.participants = values.participants.map((p) => ({
      ...p,
      id: group.participants.find((g) => g.name === p.name)!.id,
    }))
    await updateGroup(group.id, values)
    const updated = await getGroup(group.id)
    expect(
      updated?.participants.find((p) => p.name === 'Ada')?.paymentMethods,
    ).toEqual([{ type: 'mobilepay', phone: '+358401234567' }])

    const exported = await getGroupForExport(group.id)
    expect(exported?.exportVersion).toBe(4)
    const imported = await createGroupFromImport(
      groupImportSchema.parse(JSON.parse(JSON.stringify(exported))),
    )
    expect(
      imported.participants.find((p) => p.name === 'Ada')?.paymentMethods,
    ).toEqual([{ type: 'mobilepay', phone: '+358401234567' }])
  })

  it('keeps stored methods when an older client omits them', async () => {
    const group = await createGroup(form([sepa]))
    await updateGroup(group.id, {
      ...form(),
      participants: group.participants.map(({ id, name }) => ({ id, name })),
    })
    const after = await getGroup(group.id)
    expect(
      after?.participants.find((p) => p.name === 'Ada')?.paymentMethods,
    ).toEqual([sepa])
  })

  it('imports drop methods this version cannot read', () => {
    const parsed = groupImportSchema.parse({
      name: 'Old',
      currency: '€',
      currencyCode: 'EUR',
      participants: [
        {
          id: 'a',
          name: 'Ada',
          paymentMethods: [sepa, { type: 'carrier-pigeon' }],
        },
        { id: 'b', name: 'Bob' },
      ],
      expenses: [],
    })
    expect(parsed.participants[0].paymentMethods).toEqual([sepa])
    expect(parsed.participants[1].paymentMethods).toEqual([])
  })

  it('counts a payment-details edit as a participant change', () => {
    const base = {
      participants: [
        { id: 'a', name: 'Ada', groupId: 'g', paymentMethods: [] },
      ],
      expenses: [],
      activities: [],
    } as unknown as GroupDocument
    const next = {
      ...base,
      participants: [{ ...base.participants[0], paymentMethods: [sepa] }],
    } as GroupDocument
    expect(diffGroupChildren(base, next).replaceParticipants).toBe(true)
  })
})
