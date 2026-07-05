// Admin system: admin identity, admin/watcher mode, and member creation.
//
// SECURITY MODEL: everything in this file is UI gating only — the anon key in
// this bundle cannot create or list users. Real member creation happens in the
// `admin-create-user` Supabase Edge Function (supabase/functions/), which
// re-checks the caller's JWT server-side against its own admin list before
// using the service-role key. Never put privileged keys in client code.
//
// MEMBER MODEL: the admin creates each member with a USERNAME + password.
// Usernames map to synthetic emails (<username>@member.raedtracker.app) that
// Supabase accepts as identifiers without any email delivery (accounts are
// created pre-confirmed). Every member gets their own Supabase user, and the
// `libraries` table's row-level security gives each account a fully separate
// tracking library — members never see each other's shows.

import { useSyncExternalStore } from 'react'
import { supabase } from '../api/supabase'

export const ADMIN_EMAILS = ['az.alsaloom@gmail.com']

export const MEMBER_EMAIL_DOMAIN = 'member.raedtracker.app'

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase())
}

export function isValidUsername(u: string): boolean {
  return /^[a-z0-9_.-]{3,20}$/i.test(u)
}

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${MEMBER_EMAIL_DOMAIN}`
}

/** Pretty label for a signed-in identity: members show as their username. */
export function displayIdentity(email: string): string {
  return email.endsWith(`@${MEMBER_EMAIL_DOMAIN}`) ? email.split('@')[0] : email
}

/** Readable random password (no ambiguous characters). */
export function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
}

// ---------- admin/watcher mode + current identity (module store) ----------

const MODE_KEY = 'raedtracker_admin_mode'

interface AdminState {
  email: string | null
  isAdmin: boolean
  /** false = watcher mode: hide every admin affordance. */
  adminMode: boolean
}

let state: AdminState = {
  email: null,
  isAdmin: false,
  adminMode: localStorage.getItem(MODE_KEY) !== 'off',
}
const listeners = new Set<() => void>()

function setState(patch: Partial<AdminState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function setAdminMode(on: boolean) {
  localStorage.setItem(MODE_KEY, on ? 'on' : 'off')
  setState({ adminMode: on })
}

export function getAdminState(): AdminState {
  return state
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** React hook: { email, isAdmin, adminMode } — resolves async after auth loads. */
export function useAdminGate(): AdminState {
  return useSyncExternalStore(subscribe, getAdminState)
}

let authWired = false
export function initAdmin() {
  if (!supabase || authWired) return
  authWired = true
  void supabase.auth.getUser().then(({ data }) => {
    const email = data.user?.email ?? null
    setState({ email, isAdmin: isAdminEmail(email) })
  })
  supabase.auth.onAuthStateChange((_event, session) => {
    const email = session?.user?.email ?? null
    setState({ email, isAdmin: isAdminEmail(email) })
  })
}

// ---------- member management via the admin-members Edge Function ----------

export interface Member {
  id: string
  email: string
  username: string | null
  createdAt: string
  lastSignInAt: string | null
  isAdmin: boolean
}

export type AdminCallResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; kind: 'error'; message: string }
  | { ok: false; kind: 'function-missing' }

/**
 * Invoke the admin-members Edge Function and normalize its error surface.
 * FunctionsHttpError carries only a fixed literal message; the real reason
 * ({ error: '...' }) lives on error.context (the raw Response) — read it so
 * the admin sees actual failure reasons. A relay 404 / fetch failure means
 * the function has not been deployed yet.
 */
async function invokeAdmin<T>(body: Record<string, unknown>): Promise<AdminCallResult<T>> {
  if (!supabase) return { ok: false, kind: 'error', message: 'Sync is not configured.' }
  try {
    const { data, error } = await supabase.functions.invoke('admin-members', { body })
    if (error) {
      const ctx = (error as { context?: unknown }).context
      if (ctx instanceof Response) {
        if (ctx.status === 404) return { ok: false, kind: 'function-missing' }
        try {
          const parsed = (await ctx.clone().json()) as { error?: unknown }
          if (parsed && typeof parsed === 'object' && parsed.error) {
            return { ok: false, kind: 'error', message: String(parsed.error) }
          }
        } catch {
          // non-JSON body — fall through to the generic message
        }
      }
      const msg = String((error as Error).message ?? error)
      if (/fetch|404|not found|failed to send/i.test(msg)) {
        return { ok: false, kind: 'function-missing' }
      }
      return { ok: false, kind: 'error', message: msg }
    }
    if (data && typeof data === 'object' && 'error' in data && (data as { error?: unknown }).error) {
      return { ok: false, kind: 'error', message: String((data as { error: unknown }).error) }
    }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, kind: 'function-missing' }
  }
}

export async function createMember(
  username: string,
  password: string,
): Promise<AdminCallResult> {
  if (!isValidUsername(username)) {
    return {
      ok: false,
      kind: 'error',
      message: 'Username must be 3–20 characters: letters, numbers, dots, dashes, underscores.',
    }
  }
  if (password.length < 6) {
    return { ok: false, kind: 'error', message: 'Password must be at least 6 characters.' }
  }
  const res = await invokeAdmin<undefined>({
    action: 'create',
    email: usernameToEmail(username),
    password,
    username: username.trim(),
  })
  return res.ok ? { ok: true, data: undefined } : res
}

export async function listMembers(): Promise<AdminCallResult<Member[]>> {
  const res = await invokeAdmin<{ members: Member[] }>({ action: 'list' })
  if (!res.ok) return res
  return { ok: true, data: res.data?.members ?? [] }
}

export async function resetMemberPassword(
  userId: string,
  password: string,
): Promise<AdminCallResult> {
  if (password.length < 6) {
    return { ok: false, kind: 'error', message: 'Password must be at least 6 characters.' }
  }
  const res = await invokeAdmin<undefined>({ action: 'reset-password', userId, password })
  return res.ok ? { ok: true, data: undefined } : res
}

export async function deleteMember(userId: string): Promise<AdminCallResult> {
  const res = await invokeAdmin<undefined>({ action: 'delete', userId })
  return res.ok ? { ok: true, data: undefined } : res
}

/** Legacy alias shape used by the Admin page's create card. */
export type CreateMemberResult = AdminCallResult
