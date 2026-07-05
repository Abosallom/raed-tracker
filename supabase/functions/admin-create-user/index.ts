// Supabase Edge Function: admin-create-user
//
// THE REAL SECURITY GATE for member creation. The web app's admin checks are
// cosmetic UI gating — this function re-verifies the caller's JWT against the
// admin list below before touching the service-role client. Deploy via the
// Supabase Dashboard (Edge Functions → Deploy new function → name it
// `admin-create-user` → paste this file) or the CLI:
//   npx supabase functions deploy admin-create-user
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically — no extra secrets needed.

import { createClient } from 'npm:@supabase/supabase-js@2'

// Keep in sync with ADMIN_EMAILS in src/lib/admin.ts.
const ADMIN_EMAILS = ['az.alsaloom@gmail.com']

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // 1. Identify the caller from their JWT (anon-key client + their token).
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Not signed in' }, 401)

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  )
  const { data: caller, error: callerErr } = await anonClient.auth.getUser(token)
  const callerEmail = caller?.user?.email?.toLowerCase()
  if (callerErr || !callerEmail) return json({ error: 'Not signed in' }, 401)

  // 2. Only the admin may create members.
  if (!ADMIN_EMAILS.includes(callerEmail)) {
    return json({ error: 'Only the app admin can add members' }, 403)
  }

  // 3. Validate input.
  let body: { email?: string; password?: string; username?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }
  const email = body.email?.trim().toLowerCase()
  const password = body.password ?? ''
  const username = body.username?.trim() ?? ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Invalid email' }, 400)
  }
  if (password.length < 6) return json({ error: 'Password too short (min 6)' }, 400)

  // 4. Create the member, pre-confirmed (no email delivery needed for
  //    synthetic member addresses). Service-role client — server-side only.
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, created_by: callerEmail },
  })
  if (createErr) return json({ error: createErr.message }, 400)

  return json({ ok: true })
})
