// "TV Time Direct" — pull a member's whole TV Time history via the tvtime-direct
// Edge Function and turn it into the exact same TvTimeImport model the file
// importer produces, so the Migrate preview/match/apply pipeline is untouched.
//
// The client orchestrates several small per-action calls (login → watches +
// movies + follows → chunked series-episodes) so no single Edge invocation runs
// long. buildImportFromDirect() is a pure function (unit-testable, no I/O).

import { supabase } from '../api/supabase'
import {
  mergeParsedFiles,
  type ImportedShow,
  type ParsedFile,
  type TvTimeImport,
} from './tvtime-import'

export type DirectErrorCode = 'bad-credentials' | 'blocked' | 'tvtime-down' | 'bad-request'

export type DirectCallResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'error'; code?: DirectErrorCode; message: string }
  | { ok: false; kind: 'function-missing' }

interface DirectWatch {
  episodeId: number
  seriesId: number
  watchedAt?: string
  rewatchCount?: number
}
interface DirectSeriesEpisodes {
  seriesId: number
  episodes: { id: number; season: number; episode: number }[]
}
interface DirectMovie {
  name: string
  imdbId?: string
  tvdbId?: string
  watched: boolean
  watchedAt?: string
}
interface DirectFollow {
  seriesId: number
  name: string
}

/** True when Direct import can run (built with Supabase + a signed-in session). */
export function directImportAvailable(): boolean {
  return supabase !== null
}

/**
 * Invoke the tvtime-direct Edge Function and normalize its error surface, the
 * same way invokeAdmin does in admin.ts: FunctionsHttpError hides the real
 * reason on error.context (the raw Response) — read it for the { error, code }.
 * A relay 404 / fetch failure means the function isn't deployed yet.
 */
async function invokeDirect<T>(body: Record<string, unknown>): Promise<DirectCallResult<T>> {
  if (!supabase) return { ok: false, kind: 'error', message: 'Sync is not configured.' }
  try {
    const { data, error } = await supabase.functions.invoke('tvtime-direct', { body })
    if (error) {
      const ctx = (error as { context?: unknown }).context
      if (ctx instanceof Response) {
        if (ctx.status === 404) return { ok: false, kind: 'function-missing' }
        try {
          const parsed = (await ctx.clone().json()) as { error?: unknown; code?: unknown }
          if (parsed && typeof parsed === 'object' && parsed.error) {
            return {
              ok: false,
              kind: 'error',
              code: parsed.code as DirectErrorCode | undefined,
              message: String(parsed.error),
            }
          }
        } catch {
          /* non-JSON body — generic message below */
        }
      }
      const msg = String((error as Error).message ?? error)
      if (/fetch|404|not found|failed to send/i.test(msg)) {
        return { ok: false, kind: 'function-missing' }
      }
      return { ok: false, kind: 'error', message: msg }
    }
    if (data && typeof data === 'object' && 'error' in data && (data as { error?: unknown }).error) {
      const d = data as { error: unknown; code?: unknown }
      return { ok: false, kind: 'error', code: d.code as DirectErrorCode | undefined, message: String(d.error) }
    }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, kind: 'function-missing' }
  }
}

/**
 * Pure: fold the raw Direct API rows into ONE authoritative ParsedFile, then run
 * it through mergeParsedFiles so dedupe, watchlist folding, sorting, and
 * diagnostics all behave exactly like a file import. Watches whose episode id
 * can't be mapped to a season/episode (specials, removed episodes) are counted
 * into the diagnostic note rather than silently dropped.
 */
export function buildImportFromDirect(input: {
  watches: DirectWatch[]
  seriesEpisodes: DirectSeriesEpisodes[]
  movies: DirectMovie[]
  follows: DirectFollow[]
}): TvTimeImport {
  const { watches, seriesEpisodes, movies, follows } = input

  // episode_id → {season, episode} across all fetched series.
  const epMap = new Map<number, { season: number; episode: number }>()
  for (const s of seriesEpisodes) {
    for (const e of s.episodes) {
      if (Number.isFinite(e.id)) epMap.set(e.id, { season: e.season, episode: e.episode })
    }
  }
  const nameBySeries = new Map<number, string>()
  for (const f of follows) if (f.name) nameBySeries.set(f.seriesId, f.name)

  // Group watches by series, mapping episode ids to season/episode numbers.
  const bySeries = new Map<number, ImportedShow>()
  let unmapped = 0
  for (const w of watches) {
    const map = epMap.get(w.episodeId)
    if (!map) {
      unmapped++
      continue
    }
    let show = bySeries.get(w.seriesId)
    if (!show) {
      show = {
        name: nameBySeries.get(w.seriesId) ?? `TVDB ${w.seriesId}`,
        tvdbId: String(w.seriesId),
        episodes: [],
      }
      bySeries.set(w.seriesId, show)
    }
    show.episodes.push({ season: map.season, episode: map.episode, watchedAt: w.watchedAt })
  }

  // Series followed but never watched → followed-only (so they still track).
  const follows2 = follows
    .filter((f) => !bySeries.has(f.seriesId))
    .map((f) => ({ name: f.name || `TVDB ${f.seriesId}`, tvdbId: String(f.seriesId) }))

  const file: ParsedFile = {
    file: 'TV Time account',
    kind: 'tvtime-direct',
    episodes: [],
    follows: follows2,
    movies: movies.map((m) => ({
      title: m.name,
      imdbId: m.imdbId && /^tt\d+$/i.test(m.imdbId) ? m.imdbId : undefined,
      tvdbId: m.tvdbId,
      watchedAt: m.watchedAt,
      watched: m.watched,
    })),
    emotions: [],
    shows: [...bySeries.values()],
    primary: true,
    totalRows: watches.length,
    skipped: unmapped,
    note: unmapped > 0 ? `${unmapped} watches for specials/removed episodes couldn't be mapped` : undefined,
  }
  return mergeParsedFiles([file])
}

export type DirectProgress = {
  phase: 'login' | 'shows' | 'movies' | 'building'
  done: number
  total: number
}

const CHUNK = 20

/**
 * Full Direct import: login, fetch the watch log + movies + follows, then fetch
 * per-series episode maps in chunks (with progress), and build the model. One
 * TV Time JWT is reused across every call. Honors cancelRef between chunks.
 */
export async function runDirectImport(
  creds: { username: string; password: string },
  onProgress: (p: DirectProgress) => void,
  cancelRef: { current: boolean },
): Promise<DirectCallResult<TvTimeImport>> {
  onProgress({ phase: 'login', done: 0, total: 1 })
  const login = await invokeDirect<{ jwt: string; userId: string }>({
    action: 'login',
    username: creds.username,
    password: creds.password,
  })
  if (!login.ok) return login
  const { jwt, userId } = login.data

  onProgress({ phase: 'login', done: 1, total: 1 })
  const watchesRes = await invokeDirect<{ watches: DirectWatch[] }>({ action: 'watches', tvtimeJwt: jwt, userId })
  if (!watchesRes.ok) return watchesRes
  const watches = watchesRes.data.watches

  onProgress({ phase: 'movies', done: 0, total: 1 })
  const moviesRes = await invokeDirect<{ movies: DirectMovie[] }>({ action: 'movies', tvtimeJwt: jwt, userId })
  const movies = moviesRes.ok ? moviesRes.data.movies : [] // movies are optional; don't fail the import

  const followsRes = await invokeDirect<{ shows: DirectFollow[] }>({ action: 'follows', tvtimeJwt: jwt, userId })
  const follows = followsRes.ok ? followsRes.data.shows : []
  onProgress({ phase: 'movies', done: 1, total: 1 })

  // Unique series ids from the watch log; fetch their episode maps in chunks.
  const seriesIds = [...new Set(watches.map((w) => w.seriesId).filter((n) => Number.isFinite(n)))]
  const seriesEpisodes: DirectSeriesEpisodes[] = []
  for (let i = 0; i < seriesIds.length; i += CHUNK) {
    if (cancelRef.current) return { ok: false, kind: 'error', message: 'Cancelled' }
    const chunk = seriesIds.slice(i, i + CHUNK)
    const res = await invokeDirect<{ series: DirectSeriesEpisodes[]; failed: number[] }>({
      action: 'series-episodes',
      tvtimeJwt: jwt,
      seriesIds: chunk,
    })
    if (!res.ok) return res
    seriesEpisodes.push(...res.data.series)
    onProgress({ phase: 'shows', done: Math.min(i + CHUNK, seriesIds.length), total: seriesIds.length })
  }

  onProgress({ phase: 'building', done: 0, total: 1 })
  const model = buildImportFromDirect({ watches, seriesEpisodes, movies, follows })
  onProgress({ phase: 'building', done: 1, total: 1 })
  return { ok: true, data: model }
}
