const PBKDF2_ITERATIONS = 100_000
const PBKDF2_PREFIX = 'pbkdf2$'

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return bytesToHex(new Uint8Array(digest))
}

export async function hashGroupPin(
  pin: string,
  groupId: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(`spl1t-pin:${groupId}`),
      iterations: PBKDF2_ITERATIONS,
    },
    key,
    256,
  )
  return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}$${bytesToHex(new Uint8Array(bits))}`
}

/** Legacy SHA-256 used before the D1/PIN hardening. */
export async function hashGroupPinLegacy(
  pin: string,
  groupId: string,
): Promise<string> {
  return sha256Hex(`${groupId}:${pin}`)
}

export async function pinMatchesHash(
  pin: string,
  groupId: string,
  pinHash: string,
): Promise<boolean> {
  if (pinHash.startsWith(PBKDF2_PREFIX)) {
    const expected = await hashGroupPin(pin, groupId)
    return expected === pinHash
  }
  const legacy = await hashGroupPinLegacy(pin, groupId)
  return legacy === pinHash
}

export function isLegacyPinHash(pinHash: string): boolean {
  return !pinHash.startsWith(PBKDF2_PREFIX)
}

export function groupPinUnlockStorageKey(groupId: string) {
  return `group-pin-unlocked:${groupId}`
}

export function pinCookieName(groupId: string) {
  return `spl1t_pin_${groupId}`
}
