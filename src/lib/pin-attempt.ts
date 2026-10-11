import type { PinAttemptState } from '@/lib/db/repository'

export type PinAttemptLimits = {
  windowMs: number
  maxFailures: number
  lockMs: number
}

/**
 * One PIN failure. A lock that is still active counts the guess without
 * resetting the timer. An expired lock starts a new window at 1.
 */
export function nextPinAttemptState(
  existing: PinAttemptState | null,
  now: number,
  limits: PinAttemptLimits,
): PinAttemptState {
  const locked = existing?.lockedUntil != null && now < existing.lockedUntil
  if (locked && existing) {
    return {
      failCount: existing.failCount + 1,
      windowStart: existing.windowStart,
      lockedUntil: existing.lockedUntil,
    }
  }

  const lockExpired =
    existing?.lockedUntil != null && now >= existing.lockedUntil
  const inWindow =
    existing != null &&
    !lockExpired &&
    now - existing.windowStart < limits.windowMs
  const failCount = inWindow ? existing.failCount + 1 : 1
  const windowStart = inWindow ? existing.windowStart : now
  const lockedUntil =
    failCount >= limits.maxFailures ? now + limits.lockMs : null
  return { failCount, windowStart, lockedUntil }
}
