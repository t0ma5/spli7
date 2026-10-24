import { backupsToDelete } from '@/lib/backups'

function days(from: string, count: number): string[] {
  const start = new Date(`${from}T00:00:00.000Z`)
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(start)
    date.setUTCDate(date.getUTCDate() - i)
    return date.toISOString().slice(0, 10)
  })
}

describe('backup retention', () => {
  it('keeps everything while there are fewer than 30 days', () => {
    expect(backupsToDelete(days('2026-10-24', 30))).toEqual([])
  })

  it('keeps 30 days plus the first backup of each of 12 months', () => {
    const all = days('2026-10-24', 500)
    const removed = new Set(backupsToDelete(all))
    const kept = all.filter((date) => !removed.has(date))
    // 30 most recent, plus the 1st of each month from 2025-11 to 2026-09
    // (October's first is inside the 30 days and November 2025 is month 12).
    expect(kept).toHaveLength(30 + 11)
    expect(kept).toContain('2026-09-01')
    expect(kept).toContain('2025-11-01')
    expect(kept).not.toContain('2025-10-01')
    expect(kept).not.toContain('2026-09-02')
  })
})
