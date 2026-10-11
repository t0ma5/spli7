import { nextPinAttemptState } from '@/lib/pin-attempt'

const limits = { windowMs: 1_000, maxFailures: 3, lockMs: 5_000 }

describe('nextPinAttemptState', () => {
  it('counts parallel-style increments instead of rewriting the same total', () => {
    const first = nextPinAttemptState(null, 100, limits)
    const second = nextPinAttemptState(first, 110, limits)
    expect(second.failCount).toBe(2)
  })

  it('locks on the last allowed failure and rejects the next one', () => {
    let state = nextPinAttemptState(null, 0, limits)
    state = nextPinAttemptState(state, 10, limits)
    state = nextPinAttemptState(state, 20, limits)
    expect(state.failCount).toBe(3)
    expect(state.lockedUntil).toBe(20 + limits.lockMs)
    const duringLock = nextPinAttemptState(state, 30, limits)
    expect(duringLock.failCount).toBe(4)
    expect(duringLock.lockedUntil).toBe(state.lockedUntil)
  })

  it('starts a new window after the lock expires', () => {
    const locked = nextPinAttemptState(
      { failCount: 3, windowStart: 0, lockedUntil: 100 },
      100,
      limits,
    )
    expect(locked.failCount).toBe(1)
    expect(locked.lockedUntil).toBeNull()
  })
})
