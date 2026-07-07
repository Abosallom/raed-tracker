// Account management helpers (OTP sign-in, credentials, sessions, cloud data).
// Complements src/store/sync.ts, which owns the library-sync lifecycle.

import { supabase } from '../api/supabase'
import { invalidateLastPush } from './sync'

const NOT_CONFIGURED = 'Sync is not configured in this build.'

/** Email a 6-digit one-time code to an EXISTING account. */
export async function sendOtp(email: string): Promise<string | null> {
  if (!supabase) return NOT_CONFIGURED
  const { error } = await supabase.auth.signInWithOtp({
    email,
    // MUST be false: project signups are disabled (members are provisioned
    // by the admin), and Supabase rejects shouldCreateUser:true requests
    // outright when signups are off — even for EXISTING accounts. This broke
    // every OTP sign-in with "Signups not allowed for this instance".
    options: { shouldCreateUser: false },
  })
  if (error && /signups not allowed/i.test(error.message)) {
    return 'No account with that email — accounts are created by the admin. Check the address or ask for an invite.'
  }
  return error ? error.message : null
}

/** Verify the emailed code; on success Supabase creates the session. */
export async function verifyOtp(email: string, code: string): Promise<string | null> {
  if (!supabase) return NOT_CONFIGURED
  const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' })
  return error ? error.message : null
}

export interface AccountInfo {
  id: string
  email: string
  createdAt: string
  lastSignInAt: string | null
}

export async function getAccountInfo(): Promise<AccountInfo | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getUser()
  const u = data.user
  if (!u) return null
  return {
    id: u.id,
    email: u.email ?? '',
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
  }
}

export async function changePassword(password: string): Promise<string | null> {
  if (!supabase) return NOT_CONFIGURED
  const { error } = await supabase.auth.updateUser({ password })
  return error ? error.message : null
}

/** Sends confirmation links to the old and/or new address before switching. */
export async function changeEmail(email: string): Promise<string | null> {
  if (!supabase) return NOT_CONFIGURED
  const { error } = await supabase.auth.updateUser({ email })
  return error ? error.message : null
}

/** Revoke every session for this account (all devices), including this one. */
export async function signOutEverywhere(): Promise<string | null> {
  if (!supabase) return NOT_CONFIGURED
  const { error } = await supabase.auth.signOut({ scope: 'global' })
  return error ? error.message : null
}

/** Delete this account's cloud library row. Local data stays untouched. */
export async function deleteCloudData(): Promise<string | null> {
  if (!supabase) return NOT_CONFIGURED
  const { data } = await supabase.auth.getUser()
  const uid = data.user?.id
  if (!uid) return 'Not signed in.'
  const { error } = await supabase.from('libraries').delete().eq('user_id', uid)
  if (error) return error.message
  // The push dedupe cache still holds the just-deleted doc; drop it so the
  // next sync actually re-uploads the library as the UI promises.
  invalidateLastPush()
  return null
}
