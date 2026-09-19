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

  it('still verifies PBKDF2 hashes salted with the old spl1t prefix', async () => {
    const { subtle } = crypto
    const key = await subtle.importKey(
      'raw',
      new TextEncoder().encode('123456'),
      'PBKDF2',
      false,
      ['deriveBits'],
    )
    const bits = await subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: new TextEncoder().encode('spl1t-pin:group-1'),
        iterations: 100_000,
      },
      key,
      256,
    )
    const hex = Array.from(new Uint8Array(bits))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    const oldHash = `pbkdf2$100000$${hex}`
    expect(await pinMatchesHash('123456', 'group-1', oldHash)).toBe(true)
  })

  it('still verifies legacy SHA-256 hashes', async () => {
    const legacy = await hashGroupPinLegacy('9999', 'legacy-group')
    expect(isLegacyPinHash(legacy)).toBe(true)
    expect(await pinMatchesHash('9999', 'legacy-group', legacy)).toBe(true)
    expect(await pinMatchesHash('0000', 'legacy-group', legacy)).toBe(false)
  })
})
