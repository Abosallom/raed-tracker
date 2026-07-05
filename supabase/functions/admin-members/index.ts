// Supabase Edge Function: admin-members
//
// The single server-side gate for ALL member management: list, create,
// reset-password, delete. The web app's admin checks are cosmetic UI gating —
// this function re-verifies the caller's JWT against the admin list below
// before touching the service-role client.
//
// Deploy (one time): Supabase Dashboard → Edge Functions → Deploy new function
// → name it `admin-members` → paste this file. Or CLI:
//   npx supabase functions deploy admin-members
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

interface RequestBody {
  action?: 'list' | 'create' | 'reset-password' | 'delete'
  email?: string
  password?: string
  username?: string
  userId?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // 1. Identify the caller from their JWT.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Not signed in' }, 401)
  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  )
  const { data: caller, error: callerErr } = await anonClient.auth.getUser(token)
  const callerEmail = caller?.user?.email?.toLowerCase()
  if (callerErr || !callerEmail) return json({ error: 'Not signed in' }, 401)

  // 2. Admin only.
  if (!ADMIN_EMAILS.includes(callerEmail)) {
    return json({ error: 'Only the app admin can manage members' }, 403)
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  switch (body.action) {
    case 'list': {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
      if (error) return json({ error: error.message }, 400)
      const members = data.users.map((u) => ({
        id: u.id,
        email: u.email ?? '',
        username:
          (u.user_metadata?.username as string | undefined) ??
          (u.email?.includes('@member.') ? u.email.split('@')[0] : null),
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        isAdmin: ADMIN_EMAILS.includes((u.email ?? '').toLowerCase()),
      }))
      return json({ members })
    }

    case 'create': {
      const email = body.email?.trim().toLowerCase()
      const password = body.password ?? ''
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: 'Invalid email' }, 400)
      }
      if (password.length < 6) return json({ error: 'Password too short (min 6)' }, 400)
      const { error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username: body.username?.trim() ?? '', created_by: callerEmail },
      })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    case 'reset-password': {
      if (!body.userId) return json({ error: 'Missing userId' }, 400)
      if ((body.password ?? '').length < 6) return json({ error: 'Password too short (min 6)' }, 400)
      const { data: target, error: getErr } = await admin.auth.admin.getUserById(body.userId)
      if (getErr || !target.user) return json({ error: 'Member not found' }, 404)
      if (ADMIN_EMAILS.includes((target.user.email ?? '').toLowerCase())) {
        return json({ error: 'Admins manage their own password on the Account page' }, 403)
      }
      const { error } = await admin.auth.admin.updateUserById(body.userId, {
        password: body.password,
      })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    case 'delete': {
      if (!body.userId) return json({ error: 'Missing userId' }, 400)
      const { data: target, error: getErr } = await admin.auth.admin.getUserById(body.userId)
      if (getErr || !target.user) return json({ error: 'Member not found' }, 404)
      if (ADMIN_EMAILS.includes((target.user.email ?? '').toLowerCase())) {
        return json({ error: 'Admin accounts cannot be removed from the app' }, 403)
      }
      // The member's cloud library row cascades away with the user
      // (libraries.user_id references auth.users ON DELETE CASCADE).
      const { error } = await admin.auth.admin.deleteUser(body.userId)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    default:
      return json({ error: 'Unknown action' }, 400)
  }
})
