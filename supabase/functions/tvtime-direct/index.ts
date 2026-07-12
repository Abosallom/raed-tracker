// Supabase Edge Function: tvtime-direct
//
// "TV Time Direct" import relay. Lets a signed-in member pull their whole TV
// Time history straight from TV Time's own API — no files, no desktop. The
// client orchestrates the flow as several small per-action calls so no single
// invocation runs long or holds the whole library at once.
//
// SECURITY: this is a thin proxy. It NEVER stores or logs the member's TV Time
// password or JWT — the password is used once to obtain a TV Time JWT, and that
// JWT rides in the request BODY of later calls (the Authorization header stays
// the member's Supabase session token, which is what gates access here). No DB
// writes at all.
//
// Deploy: npx supabase functions deploy tvtime-direct --project-ref cjmzwvazmjbsjtsvpiba
// SUPABASE_URL / SUPABASE_ANON_KEY are injected automatically.

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

// TV Time blocks default fetch/urllib UAs at the Cloudflare edge; a custom UA
// passes. Keep it distinctive and honest.
const UA = 'raedtracker-import/1.0'
const AUTH_LOGIN = 'https://auth.tvtime.com/v1/login'
const MS = 'https://msapi.tvtime.com'

type ErrCode = 'bad-credentials' | 'blocked' | 'tvtime-down' | 'bad-request'
function fail(code: ErrCode, message: string, status = 400): Response {
  return json({ error: message, code }, status)
}

/** base64url with no padding — the sidecar expects the target URL encoded so. */
function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Fetch a TV Time API URL through the sidecar proxy (injects their API key),
 *  with a small retry on 429/5xx. Returns parsed JSON `data` or throws a tagged
 *  error the caller maps to an ErrCode. */
async function sidecar(target: string, jwt: string): Promise<unknown> {
  const url = `https://app.tvtime.com/sidecar?o_b64=${b64url(target)}`
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${jwt}`, 'User-Agent': UA, Accept: 'application/json' },
      })
    } catch {
      if (attempt === 2) throw new Error('tvtime-down')
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 2) throw new Error('tvtime-down')
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
      continue
    }
    if (res.status === 401 || res.status === 403) throw new Error('blocked')
    const text = await res.text()
    // A Cloudflare challenge returns HTML, not JSON.
    if (text.trimStart().startsWith('<')) throw new Error('blocked')
    try {
      const body = JSON.parse(text)
      return body?.data ?? body
    } catch {
      throw new Error('tvtime-down')
    }
  }
  throw new Error('tvtime-down')
}

/** USER_ID is the `id` claim of the TV Time JWT payload (no verification needed
 *  — it is only used to build the member's own data URLs). */
function userIdFromJwt(jwt: string): string | null {
  try {
    const payload = jwt.split('.')[1]
    const norm = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(norm))
    const id = claims.id ?? claims.user_id ?? claims.sub
    return id != null ? String(id) : null
  } catch {
    return null
  }
}

function mapThrown(e: unknown): Response {
  const m = e instanceof Error ? e.message : ''
  if (m === 'blocked') return fail('blocked', "TV Time's servers blocked the request.")
  return fail('tvtime-down', 'Could not reach TV Time (it may already be shut down).')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Gate: any signed-in member (getUser must succeed against the Supabase token).
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Not signed in' }, 401)
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
  const { data: caller, error: callerErr } = await anon.auth.getUser(token)
  if (callerErr || !caller?.user) return json({ error: 'Not signed in' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return fail('bad-request', 'Invalid request body')
  }
  const action = String(body.action ?? '')

  try {
    // --- login: exchange TV Time credentials for a JWT (used once) -----------
    if (action === 'login') {
      const username = String(body.username ?? '').trim()
      const password = String(body.password ?? '')
      if (!username || !password) return fail('bad-request', 'Missing email or password')
      let res: Response
      try {
        res = await fetch(AUTH_LOGIN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Accept: 'application/json' },
          body: JSON.stringify({ username, password }),
        })
      } catch {
        return fail('tvtime-down', 'Could not reach TV Time to sign in.')
      }
      if (res.status === 401 || res.status === 403) {
        return fail('bad-credentials', "TV Time didn't accept that email or password.")
      }
      if (res.status === 429 || res.status >= 500) {
        return fail('tvtime-down', 'TV Time is not responding — try again shortly.')
      }
      const text = await res.text()
      if (text.trimStart().startsWith('<')) return fail('blocked', "TV Time's servers blocked sign-in.")
      let jwt: string | undefined
      try {
        const data = JSON.parse(text)
        jwt = data?.data?.jwt_token ?? data?.jwt_token ?? data?.token
      } catch {
        return fail('tvtime-down', 'Unexpected response from TV Time.')
      }
      if (!jwt) return fail('bad-credentials', "TV Time didn't accept that email or password.")
      const userId = userIdFromJwt(jwt)
      if (!userId) return fail('tvtime-down', 'Could not read the TV Time account id.')
      return json({ jwt, userId })
    }

    // Remaining actions all need a TV Time JWT (passed through in the body).
    const jwt = String(body.tvtimeJwt ?? '')
    if (!jwt) return fail('bad-request', 'Missing TV Time session')

    // --- watches: the full episode watch log (one call, no pagination) -------
    if (action === 'watches') {
      const userId = String(body.userId ?? '')
      if (!userId) return fail('bad-request', 'Missing userId')
      const data = (await sidecar(
        `${MS}/prod/v1/tracking/watches/user/${userId}?entity_type=episode`,
        jwt,
      )) as { objects?: Record<string, unknown>[] }
      const watches = (data.objects ?? []).map((o) => ({
        episodeId: Number(o.episode_id),
        seriesId: Number(o.series_id),
        watchedAt: typeof o.watched_at === 'string' ? o.watched_at : undefined,
        rewatchCount: typeof o.rewatch_count === 'number' ? o.rewatch_count : undefined,
      }))
      return json({ watches })
    }

    // --- series-episodes: episode_id → {season, episode} maps (≤25 series) ----
    if (action === 'series-episodes') {
      const ids = Array.isArray(body.seriesIds) ? body.seriesIds.map(Number) : []
      if (ids.length === 0) return json({ series: [], failed: [] })
      if (ids.length > 25) return fail('bad-request', 'Too many series in one call (max 25)')
      const series: { seriesId: number; episodes: { id: number; season: number; episode: number }[] }[] = []
      const failed: number[] = []
      for (const sid of ids) {
        try {
          const data = (await sidecar(`${MS}/v1/series/${sid}/episodes`, jwt)) as
            | Record<string, unknown>[]
            | { episodes?: Record<string, unknown>[] }
          const list = Array.isArray(data) ? data : (data.episodes ?? [])
          series.push({
            seriesId: sid,
            episodes: list.map((e) => ({
              id: Number(e.id),
              season: Number((e.season as { number?: unknown })?.number ?? e.season_number ?? 0),
              episode: Number(e.number ?? e.episode_number ?? 0),
            })),
          })
        } catch {
          failed.push(sid)
        }
        await new Promise((r) => setTimeout(r, 150))
      }
      return json({ series, failed })
    }

    // --- movies: watched + watchlist (unwatched follows) ---------------------
    if (action === 'movies') {
      const userId = String(body.userId ?? '')
      if (!userId) return fail('bad-request', 'Missing userId')
      const data = (await sidecar(
        `${MS}/prod/v1/tracking/cgw/follows/user/${userId}?entity_type=movie`,
        jwt,
      )) as { objects?: Record<string, unknown>[] }
      const movies = (data.objects ?? []).map((o) => {
        const meta = (o.meta ?? {}) as Record<string, unknown>
        const ext = Array.isArray(meta.external_sources) ? meta.external_sources : []
        const tvdb = ext.find((s: Record<string, unknown>) => s.source === 'tvdb')
        const filters = Array.isArray(o.filter) ? o.filter : []
        const extended = (o.extended ?? {}) as Record<string, unknown>
        return {
          name: String(meta.name ?? o.name ?? ''),
          imdbId: typeof meta.imdb_id === 'string' ? meta.imdb_id : undefined,
          tvdbId: tvdb?.id != null ? String(tvdb.id) : undefined,
          watched: extended.is_watched === true || filters.includes('watched'),
          watchedAt: typeof o.watched_at === 'string' ? o.watched_at : undefined,
        }
      })
      return json({ movies })
    }

    // --- follows: series names + never-watched follows (best-effort) ---------
    if (action === 'follows') {
      const userId = String(body.userId ?? '')
      if (!userId) return fail('bad-request', 'Missing userId')
      try {
        const data = (await sidecar(
          `${MS}/prod/v1/tracking/cgw/follows/user/${userId}?entity_type=series`,
          jwt,
        )) as { objects?: Record<string, unknown>[] }
        const shows = (data.objects ?? []).map((o) => {
          const meta = (o.meta ?? {}) as Record<string, unknown>
          return { seriesId: Number(o.series_id ?? meta.id ?? 0), name: String(meta.name ?? o.name ?? '') }
        })
        return json({ shows })
      } catch {
        // Names are cosmetic (matching is tvdb-id-first) — never fail the import.
        return json({ shows: [] })
      }
    }

    return fail('bad-request', 'Unknown action')
  } catch (e) {
    return mapThrown(e)
  }
})
