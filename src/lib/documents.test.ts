jest.mock('nanoid', () => {
  let n = 0
  return { nanoid: () => `doc${String(++n).padStart(18, '0')}` }
})

import {
  cleanupExpiredGroups,
  createExpense,
  createGroup,
  createGroupFromImport,
  deleteExpense,
  getGroupForExport,
  softDeleteGroup,
  updateExpense,
} from '@/lib/api'
import { setRepositoryForTests } from '@/lib/db'
import { createMemoryRepository } from '@/lib/db/memory'
import {
  documentPathname,
  documentUrl,
  isGroupDocumentUrl,
  sniffImageType,
} from '@/lib/documents'
import { groupImportSchema } from '@/lib/schemas'
import * as blob from '@vercel/blob'

// Jest swaps in __mocks__/@vercel/blob.ts, the same instance api.ts uses.
const { __store, put } =
  blob as unknown as typeof import('../../__mocks__/@vercel/blob')

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function setup() {
  const group = await createGroup({
    name: 'Receipts',
    currency: '€',
    currencyCode: 'EUR',
    defaultSplitMode: 'EVENLY',
    fixedExpenseDateGroups: false,
    participants: [{ name: 'Ada' }],
  })
  const ada = group.participants[0].id
  const form = (documents: { id: string; url: string }[]) => ({
    expenseDate: new Date('2026-01-01'),
    title: 'Dinner',
    category: 0,
    amount: 100,
    paidBy: [{ participant: ada, amount: 100 }],
    paidFor: [{ participant: ada, shares: 1 }],
    splitMode: 'EVENLY' as const,
    saveDefaultSplittingOptions: false,
    isReimbursement: false,
    documents: documents.map((d) => ({ ...d, width: 10, height: 10 })),
    recurrenceRule: 'NONE' as const,
  })
  return { group, form }
}

async function upload(groupId: string, docId: string) {
  await put(
    documentPathname(groupId, docId),
    new Uint8Array([0xff, 0xd8, 0xff]),
    {
      contentType: 'image/jpeg',
    },
  )
  return { id: docId, url: documentUrl(groupId, docId) }
}

describe('receipt photos', () => {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  beforeEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = 'test'
    __store.clear()
    setRepositoryForTests(createMemoryRepository())
  })
  afterEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = token
    setRepositoryForTests(null)
  })

  it('tells images apart by their first bytes', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    )
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(
      'image/png',
    )
    expect(
      sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')),
    ).toBe('image/webp')
    expect(
      sniffImageType(new TextEncoder().encode('<svg onload=alert(1)>')),
    ).toBeNull()
  })

  it('only accepts this group’s own receipt routes', async () => {
    const { group, form } = await setup()
    const own = await upload(group.id, 'A'.repeat(21))
    await expect(createExpense(form([own]), group.id)).resolves.toBeTruthy()

    for (const url of [
      documentUrl('another-group', 'B'.repeat(21)),
      'https://evil.test/pixel.png',
    ]) {
      await expect(
        createExpense(form([{ id: 'x', url }]), group.id),
      ).rejects.toThrow('Invalid document URL')
    }
    expect(isGroupDocumentUrl(own.url, group.id)).toBe(true)
  })

  it('deletes the photo when it is removed or its expense is deleted', async () => {
    const { group, form } = await setup()
    const first = await upload(group.id, 'C'.repeat(21))
    const second = await upload(group.id, 'D'.repeat(21))
    const expense = await createExpense(form([first, second]), group.id)

    await updateExpense(group.id, expense.id, form([second]))
    await flush()
    expect(__store.has(documentPathname(group.id, first.id))).toBe(false)
    expect(__store.has(documentPathname(group.id, second.id))).toBe(true)

    await deleteExpense(group.id, expense.id)
    await flush()
    expect(__store.size).toBe(0)
  })

  it('purges a group’s photos when the group is hard-deleted', async () => {
    const { group, form } = await setup()
    await createExpense(
      form([await upload(group.id, 'E'.repeat(21))]),
      group.id,
    )
    await softDeleteGroup(group.id)
    const later = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000)
    await cleanupExpiredGroups(later)
    expect(__store.size).toBe(0)
  })

  it('copies receipts into an imported group and drops foreign links', async () => {
    const { group, form } = await setup()
    const own = await upload(group.id, 'F'.repeat(21))
    await createExpense(form([own]), group.id)
    const exported = JSON.parse(
      JSON.stringify(await getGroupForExport(group.id)),
    ) as { expenses: { documents: unknown[] }[] }
    exported.expenses[0].documents.push({
      url: 'https://s3.example.com/old.jpg',
      width: 1,
      height: 1,
    })

    const imported = await createGroupFromImport(
      groupImportSchema.parse(exported),
    )
    const copy = await getGroupForExport(imported.id)
    const docs = copy?.expenses[0].documents ?? []
    expect(docs).toHaveLength(1)
    expect(isGroupDocumentUrl(docs[0].url, imported.id)).toBe(true)
    expect(__store.size).toBe(2)
  })
})
