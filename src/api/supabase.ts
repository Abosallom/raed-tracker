// Supabase client — cloud accounts + library sync. When the env vars are not
// configured the client is null and the app runs local-only (no sync UI harm).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null

/** True when the app was built with Supabase credentials (sync available). */
export function isSyncAvailable(): boolean {
  return supabase !== null
}
