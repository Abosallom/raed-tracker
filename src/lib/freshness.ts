// Background freshness engine (module pattern like toast.tsx).
//
// - refreshFollowedShows(): quietly re-fetches followed, non-paused shows whose
//   snapshot is older than 24h (or all of them with { force: true } for
//   user-initiated refreshes), updates the library store, and detects shows
//   that gained newly-aired episodes since the last refresh.
// - checkTrendingPulse(): compares the current top-10 trending shows against
//   the last set the user has seen, exposing a `hasNewTrending` flag for the
//   Explore tab dot.
//
// Never runs in demo mode; individual fetch errors are swallowed; runs never
// overlap. Subscribe via subscribeFreshness/getFreshnessSnapshot
// (useSyncExternalStore-friendly: the snapshot reference only changes on emit).

import { getShowDetail, isDemoMode, trendingShows } from '../api/tmdb'
import { airedEpisodeCount, useLibrary } from '../store/library'
import type { TrackedShow } from '../types'
import { showToast } from '../components/toast'

const REFRESHED_KEY = 'raedtracker_refreshed'
const TRENDING_SEEN_KEY = 'raedtracker_trending_seen'
const STALE_MS = 24 * 60 * 60 * 1000
const GAP_MS = 300
const MAX_PER_RUN = 25

export interface NewlyAired {
  showId: number
  name: string
  count: number
}

export interface FreshnessState {
  refreshing: boolean
  newlyAired: NewlyAired[]
  hasNewTrending: boolean
}

type Listener = () => void

let snapshot: FreshnessState = { refreshing: false, newlyAired: [], hasNewTrending: false }
const listeners = new Set<Listener>()

function emit(patch: Partial<FreshnessState>) {
  snapshot = { ...snapshot, ...patch }
  for (const l of listeners) l()
}

export function subscribeFreshness(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getFreshnessSnapshot(): FreshnessState {
  return snapshot
}

/** Clear the "new episodes" badge details after the user has seen them. */
export function markSeen() {
  if (snapshot.newlyAired.length === 0) return
  emit({ newlyAired: [] })
}

// ---------- refresh timestamps (localStorage map {showId: iso}) ----------

function readRefreshedMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(REFRESHED_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, string>
  } catch {
    // corrupted map — start fresh
  }
  return {}
}

function writeRefreshedAt(showId: number) {
  try {
    const map = readRefreshedMap()
    map[String(showId)] = new Date().toISOString()
    localStorage.setItem(REFRESHED_KEY, JSON.stringify(map))
  } catch {
    // storage full/unavailable — non-fatal
  }
}

function isStale(map: Record<string, string>, showId: number): boolean {
  const iso = map[String(showId)]
  if (!iso) return true
  const t = Date.parse(iso)
  return !Number.isFinite(t) || Date.now() - t > STALE_MS
}

/** Sum of aired episodes across all seasons of a tracked show. */
function totalAired(show: TrackedShow): number {
  let sum = 0
  for (const seasonStr of Object.keys(show.snapshot.seasonEpisodeCounts)) {
    sum += airedEpisodeCount(show, Number(seasonStr))
  }
  return sum
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------- background show refresh ----------

let currentRun: Promise<void> | null = null

/**
 * Refresh followed shows. Background runs skip shows refreshed within the
 * last 24h; user-initiated runs pass `{ force: true }` to bypass that gate.
 * If a run is already in flight, its promise is returned so callers (e.g.
 * pull-to-refresh) wait for the real run instead of resolving immediately.
 */
export function refreshFollowedShows(options?: { force?: boolean }): Promise<void> {
  if (isDemoMode()) return Promise.resolve()
  if (currentRun) return currentRun
  currentRun = runRefresh(options?.force === true).finally(() => {
    currentRun = null
  })
  return currentRun
}

async function runRefresh(force: boolean): Promise<void> {
  try {
    const map = readRefreshedMap()
    // Least-recently-refreshed first (never-refreshed sorts oldest), so runs
    // rotate through the whole library instead of always re-fetching the same
    // MAX_PER_RUN lowest-id shows when more than that are stale/forced.
    const candidates = Object.values(useLibrary.getState().shows)
      .filter((s) => !s.paused && (force || isStale(map, s.snapshot.id)))
      .sort(
        (a, b) =>
          (map[String(a.snapshot.id)] ?? '').localeCompare(map[String(b.snapshot.id)] ?? '') ||
          a.snapshot.id - b.snapshot.id,
      )
      .slice(0, MAX_PER_RUN)

    if (candidates.length === 0) return

    emit({ refreshing: true })
    const gains: NewlyAired[] = []

    for (let i = 0; i < candidates.length; i++) {
      const tracked = candidates[i]
      const id = tracked.snapshot.id
      try {
        const before = totalAired(tracked)
        const detail = await getShowDetail(id)
        useLibrary.getState().refreshShow(detail)
        writeRefreshedAt(id)
        const updated = useLibrary.getState().shows[id]
        if (updated) {
          const after = totalAired(updated)
          if (after > before) {
            gains.push({ showId: id, name: updated.snapshot.name, count: after - before })
          }
        }
      } catch {
        // Swallow individual fetch errors, but still record the attempt so a
        // permanently failing show (id gone from TMDB, wrong catalog) doesn't
        // stay "stale" forever and starve every higher-id show of refreshes.
        writeRefreshedAt(id)
      }
      if (i < candidates.length - 1) await sleep(GAP_MS)
    }

    if (gains.length > 0) {
      const total = gains.reduce((n, g) => n + g.count, 0)
      const what =
        total === 1
          ? `A new episode of ${gains[0].name} just aired`
          : `${total} new episodes of your shows just aired`
      showToast(what, '📡')
      emit({ refreshing: false, newlyAired: gains })
    } else {
      emit({ refreshing: false })
    }
  } finally {
    // Unexpected throw mid-run — don't leave the spinner stuck on.
    if (snapshot.refreshing) emit({ refreshing: false })
  }
}

// ---------- trending pulse ----------

let latestTrendingHash: string | null = null
let trendingRunning = false

export async function checkTrendingPulse(): Promise<void> {
  if (trendingRunning || isDemoMode()) return
  trendingRunning = true
  try {
    const results = await trendingShows()
    const hash = results
      .slice(0, 10)
      .map((r) => r.id)
      .join(',')
    latestTrendingHash = hash
    let seen: string | null = null
    try {
      seen = localStorage.getItem(TRENDING_SEEN_KEY)
    } catch {
      // storage unavailable
    }
    if (hash && hash !== seen) emit({ hasNewTrending: true })
  } catch {
    // network hiccup — no pulse this time
  } finally {
    trendingRunning = false
  }
}

/** The Explore page (or the /search location listener) calls this to clear the dot. */
export function markTrendingSeen() {
  if (latestTrendingHash != null) {
    try {
      localStorage.setItem(TRENDING_SEEN_KEY, latestTrendingHash)
    } catch {
      // storage unavailable — dot will just reappear next run
    }
  }
  if (snapshot.hasNewTrending) emit({ hasNewTrending: false })
}
