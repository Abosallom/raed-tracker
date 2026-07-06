// Supabase Edge Function: delete-account
//
// SELF-SERVE account deletion — App Store guideline 5.1.1(v) requires that
// apps with accounts let users delete them in-app. The caller's JWT IS the
// authorization: a user can only ever delete themself. Admins keep the
// separate admin-members function for managing other members.
//
// Deletes (in order): the user's libraries row (their synced data), then the
// auth user itself. Irreversible by design.
//
// Deploy (one time): Supabase Dashboard → Edge Functions → Deploy new function
// → name it `delete-account` → paste this file. Or CLI:
//   npx supabase functions deploy delete-account
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically — no extra secrets needed.

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // Identify the caller from their own JWT — no body input is trusted.
  const authHeader = req.headers.get('Authorization') ?? ''
  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const {
    data: { user },
    error: userErr,
  } = await anon.auth.getUser()
  if (userErr || !user) return json({ error: 'Not signed in' }, 401)

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Their synced library first, then the account. If the library delete
  // fails we stop — better a failed deletion than an orphaned data row.
  const { error: libErr } = await service.from('libraries').delete().eq('user_id', user.id)
  if (libErr) return json({ error: `Could not delete library: ${libErr.message}` }, 500)

  const { error: delErr } = await service.auth.admin.deleteUser(user.id)
  if (delErr) return json({ error: `Could not delete account: ${delErr.message}` }, 500)

  return json({ ok: true })
})
