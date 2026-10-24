import 'server-only'

import { getGroupIncludingDeleted } from '@/lib/api'
import { getRepository } from '@/lib/db'
import {
  issueUnlockToken,
  pinCookieName,
  UNLOCK_MAX_AGE_SECONDS,
  verifyUnlockToken,
} from '@/lib/group-access-token'
import { TRPCError } from '@trpc/server'
import { cookies, headers } from 'next/headers'

const PIN_WINDOW_MS = 15 * 60 * 1000
const PIN_MAX_FAILURES = 8
const PIN_LOCK_MS = 15 * 60 * 1000

export async function readUnlockCookie(
  groupId: string,
): Promise<string | undefined> {
  const jar = await cookies()
  return jar.get(pinCookieName(groupId))?.value
}

export async function isGroupUnlocked(
  groupId: string,
  pinHash?: string | null,
): Promise<boolean> {
  const token = await readUnlockCookie(groupId)
  if (!token) return false
  const hash =
    pinHash === undefined
      ? (await getRepository().getMeta(groupId))?.pinHash
      : pinHash
  if (!hash) return false
  return verifyUnlockToken(groupId, token, hash)
}

export async function groupRequiresPin(groupId: string): Promise<boolean> {
  const group = await getGroupIncludingDeleted(groupId)
  return Boolean(group?.hasPin)
}

export async function assertGroupUnlocked(groupId: string) {
  const group = await getGroupIncludingDeleted(groupId)
  if (!group) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' })
  }
  if (!group.hasPin) return
  if (await isGroupUnlocked(groupId)) return
  throw new TRPCError({
    code: 'UNAUTHORIZED',
    message: 'PIN required',
  })
}

export async function setUnlockCookie(groupId: string) {
  const group = await getRepository().getMeta(groupId)
  if (!group?.pinHash) return
  const token = await issueUnlockToken(groupId, group.pinHash)
  const jar = await cookies()
  jar.set(pinCookieName(groupId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: UNLOCK_MAX_AGE_SECONDS,
  })
}

export async function clientKeyFromRequest(): Promise<string> {
  const h = await headers()
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    h.get('cf-connecting-ip') ||
    'unknown'
  const data = new TextEncoder().encode(ip)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

// Across all addresses. The per-address limit alone does not stop an attacker
// who rotates IPs (an IPv6 /64 is plenty). 200 guesses a day keeps a 6-digit
// PIN out of reach; the cost is that a flood can block new unlocks of one
// group for a day. Devices already unlocked keep their cookie.
const PIN_GROUP_KEY = '*'
const PIN_GROUP_WINDOW_MS = 24 * 60 * 60 * 1000
const PIN_GROUP_MAX_ATTEMPTS = 200
const PIN_GROUP_LOCK_MS = 24 * 60 * 60 * 1000

export async function beginPinAttempt(groupId: string) {
  const clientKey = await clientKeyFromRequest()
  const now = Date.now()
  const [state, groupState] = await Promise.all([
    getRepository().reservePinAttempt(groupId, clientKey, now, {
      windowMs: PIN_WINDOW_MS,
      maxFailures: PIN_MAX_FAILURES,
      lockMs: PIN_LOCK_MS,
    }),
    getRepository().reservePinAttempt(groupId, PIN_GROUP_KEY, now, {
      windowMs: PIN_GROUP_WINDOW_MS,
      maxFailures: PIN_GROUP_MAX_ATTEMPTS,
      lockMs: PIN_GROUP_LOCK_MS,
    }),
  ])
  if (
    state.failCount > PIN_MAX_FAILURES ||
    groupState.failCount > PIN_GROUP_MAX_ATTEMPTS
  ) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many PIN attempts. Try again later.',
    })
  }
}

/**
 * Per-address limit for anonymous writes that need no group (create, import).
 * Reuses the PIN attempt table with a scope name in place of a group id.
 */
export async function assertRateLimit(
  scope: 'create-group' | 'import-group',
  limits: { windowMs: number; maxRequests: number },
) {
  const clientKey = await clientKeyFromRequest()
  const state = await getRepository().reservePinAttempt(
    `rate-limit-${scope}`,
    clientKey,
    Date.now(),
    {
      windowMs: limits.windowMs,
      maxFailures: limits.maxRequests,
      lockMs: limits.windowMs,
    },
  )
  if (state.failCount > limits.maxRequests) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests. Try again later.',
    })
  }
}

export async function clearPinFailures(groupId: string) {
  const clientKey = await clientKeyFromRequest()
  await getRepository().putPinAttempt(groupId, clientKey, {
    failCount: 0,
    windowStart: Date.now(),
    lockedUntil: null,
  })
}

export async function assertExportAccess(req: Request, groupId: string) {
  const group = await getRepository().getMeta(groupId)
  if (!group) return false
  if (!group.pinHash) return true
  const cookieHeader = req.headers.get('cookie') ?? ''
  const match = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${pinCookieName(groupId)}=`))
  const token = match?.slice(`${pinCookieName(groupId)}=`.length)
  if (!token || !group.pinHash) return false
  return verifyUnlockToken(groupId, decodeURIComponent(token), group.pinHash)
}
