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

export async function isGroupUnlocked(groupId: string): Promise<boolean> {
  const token = await readUnlockCookie(groupId)
  if (!token) return false
  return verifyUnlockToken(groupId, token)
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
  const token = await issueUnlockToken(groupId)
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

export async function assertPinNotRateLimited(groupId: string) {
  const clientKey = await clientKeyFromRequest()
  const repo = getRepository()
  const state = await repo.getPinAttempt(groupId, clientKey)
  if (!state) return
  if (state.lockedUntil && Date.now() < state.lockedUntil) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many PIN attempts. Try again later.',
    })
  }
}

export async function recordPinFailure(groupId: string) {
  const clientKey = await clientKeyFromRequest()
  const repo = getRepository()
  const now = Date.now()
  const existing = await repo.getPinAttempt(groupId, clientKey)
  const windowStart =
    existing && now - existing.windowStart < PIN_WINDOW_MS
      ? existing.windowStart
      : now
  const failCount =
    existing && now - existing.windowStart < PIN_WINDOW_MS
      ? existing.failCount + 1
      : 1
  const lockedUntil = failCount >= PIN_MAX_FAILURES ? now + PIN_LOCK_MS : null
  await repo.putPinAttempt(groupId, clientKey, {
    failCount,
    windowStart,
    lockedUntil,
  })
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
  const group = await getGroupIncludingDeleted(groupId)
  if (!group) return false
  if (!group.hasPin) return true
  const cookieHeader = req.headers.get('cookie') ?? ''
  const match = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${pinCookieName(groupId)}=`))
  const token = match?.slice(`${pinCookieName(groupId)}=`.length)
  if (!token) return false
  return verifyUnlockToken(groupId, decodeURIComponent(token))
}
