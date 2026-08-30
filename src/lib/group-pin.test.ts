import {
  hashGroupPin,
  hashGroupPinLegacy,
  isLegacyPinHash,
  pinMatchesHash,
} from '@/lib/group-pin'

describe('group-pin', () => {
  it('hashes with PBKDF2 and verifies', async () => {
    const hash = await hashGroupPin('123456', 'group-1')
    expect(hash.startsWith('pbkdf2$100000$')).toBe(true)
    expect(await pinMatchesHash('123456', 'group-1', hash)).toBe(true)
    expect(await pinMatchesHash('000000', 'group-1', hash)).toBe(false)
    expect(await pinMatchesHash('123456', 'group-2', hash)).toBe(false)
  })

  it('still verifies legacy SHA-256 hashes', async () => {
    const legacy = await hashGroupPinLegacy('9999', 'legacy-group')
    expect(isLegacyPinHash(legacy)).toBe(true)
    expect(await pinMatchesHash('9999', 'legacy-group', legacy)).toBe(true)
    expect(await pinMatchesHash('0000', 'legacy-group', legacy)).toBe(false)
  })
})
