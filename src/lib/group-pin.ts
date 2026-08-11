export async function hashGroupPin(
  pin: string,
  groupId: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${groupId}:${pin}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function groupPinUnlockStorageKey(groupId: string) {
  return `group-pin-unlocked:${groupId}`
}
