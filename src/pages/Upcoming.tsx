// Upcoming — day-grouped air-date schedule for followed shows + theater releases.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { SearchResult, ShowDetail, TrackedShow } from '../types'
import { episodeKey } from '../types'
import { getShowDetail, isDemoMode, upcomingMovies } from '../api/tmdb'
import { MOCK_SHOWS } from '../api/mockData'
import {
  isSeasonFinale,
  isSeasonPremiere,
  isSeriesPremiere,
  nextEpisode,
  seasonComplete,
  useLibrary,
  watchedCount,
} from '../store/library'
import { lastActivity } from '../lib/activity'
import { computeStreaks } from '../lib/streaks'
import { ErrorBox, PosterCard, PosterImage, SkeletonRow } from '../components/shared'
import { showToast } from '../components/toast'
import { fireConfetti } from '../components/Confetti'
import EpisodeSheet from '../components/EpisodeSheet'
import './upcoming.css'

// ---------- module-level cache (survives remounts, caps refetching) ----------

const MAX_SHOW_FETCHES = 40
const SHOW_DETAIL_TTL_MS = 6 * 60 * 60 * 1000 // long-lived tabs still see fresh air dates
const showDetailCache = new Map<number, { promise: Promise<ShowDetail>; at: number }>()

function cachedShowDetail(id: number): Promise<ShowDetail> {
  const hit = showDetailCache.get(id)
  if (hit && Date.now() - hit.at <= SHOW_DETAIL_TTL_MS) return hit.promise
  const promise = getShowDetail(id)
  // Don't poison the cache with failures — allow a retry next visit.
  promise.catch(() => showDetailCache.delete(id))
  showDetailCache.set(id, { promise, at: Date.now() })
  return promise
}

// ---------- filter persistence ----------

const FILTERS_KEY = 'raedtracker_upcoming_filters'

interface FilterPrefs {
  /** Single selected network; null = "All". */
  network: string | null
  hideTba: boolean
  /** Drop already-checked-off episodes (also toggleable from Settings ▸ Upcoming). */
  hideWatched: boolean
}

function loadFilters(): FilterPrefs {
  try {
    const raw = localStorage.getItem(FILTERS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FilterPrefs> & { networks?: unknown }
      // Migrate the legacy multi-select shape ({ networks: string[] }) to the
      // single-select one by keeping the first entry.
      let network: string | null = null
      if (typeof parsed.network === 'string') network = parsed.network
      else if (Array.isArray(parsed.networks)) {
        const first = parsed.networks.find((n): n is string => typeof n === 'string')
        network = first ?? null
      }
      return {
        network,
        hideTba: parsed.hideTba === true,
        hideWatched: parsed.hideWatched === true,
      }
    }
  } catch {
    /* corrupted prefs — fall through to defaults */
  }
  return { network: null, hideTba: false, hideWatched: false }
}

function saveFilters(prefs: FilterPrefs) {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(prefs))
  } catch {
    /* storage full/unavailable — filters just won't persist */
  }
}

// ---------- date helpers ----------

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

// ---------- air-time heuristic ----------
// TMDB doesn't give per-episode air *times*, so we approximate a plausible
// local drop time from the network. These are HEURISTIC defaults (streamers
// drop overnight/early-morning; linear channels air in primetime) — not real
// schedule data — used purely to give each row a leading "HH:MM" cell.
const NETWORK_AIRTIME: Record<string, string> = {
  HBO: '04:00',
  'HBO Max': '04:00',
  Max: '04:00',
  Netflix: '08:00',
  'Apple TV+': '07:00',
  'Apple TV Plus': '07:00',
  'Prime Video': '06:00',
  'Amazon Prime Video': '06:00',
  'Disney+': '08:00',
  'Disney Plus': '08:00',
  AMC: '02:00',
}
const DEFAULT_AIRTIME = '20:00'

function airTimeFor(network?: string): string {
  if (!network) return DEFAULT_AIRTIME
  return NETWORK_AIRTIME[network.trim()] ?? DEFAULT_AIRTIME
}

/** Whole days from today's local midnight (0 = today, negative = past). */
function daysFromToday(iso: string): number {
  const target = parseIsoDate(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

/** "Today" / "Tomorrow" / weekday for the next week / "JUL 12" beyond. */
function groupLabel(days: number, iso: string): string {
  const date = parseIsoDate(iso)
  // Past week gets named buckets instead of one lumped "Earlier this week":
  // Yesterday, then "Last <Weekday>" back to -6d.
  if (days < 0) {
    if (days === -1) return 'Yesterday'
    if (days >= -6) {
      return `Last ${date.toLocaleDateString('en-US', { weekday: 'long' })}`
    }
    return 'Earlier'
  }
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days <= 7) return date.toLocaleDateString('en-US', { weekday: 'long' })
  const label = date
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    .toUpperCase()
  return date.getFullYear() === new Date().getFullYear()
    ? label
    : `${label}, ${date.getFullYear()}`
}

function countdownLabel(days: number): string {
  if (days < 0) return `${-days}d ago`
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `in ${days} days`
}

// ---------- entries ----------

interface UpcomingEntry {
  showId: number
  showName: string
  poster_path: string | null
  season: number
  episode: number
  epName: string // '' when TBA
  airDate: string // ISO yyyy-mm-dd
  airTime: string // heuristic "HH:MM" from network
  days: number
  network?: string
  sample: boolean
  /** Aired within the last 7 days ("Earlier this week", checkable). */
  recent: boolean
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function epCode(e: UpcomingEntry): string {
  return `S${pad2(e.season)}E${pad2(e.episode)}`
}

function isTba(e: UpcomingEntry): boolean {
  return !e.epName || /^tba$/i.test(e.epName.trim())
}

function badgeFor(e: UpcomingEntry): 'PREMIERE' | 'NEW' | null {
  if (e.episode === 1) return 'PREMIERE'
  if (e.days <= 0) return 'NEW'
  return null
}

// ---------- row ----------

// Upcoming check-offs share the unified check path with MyShows/ShowDetail:
// milestone confetti + toasts (including lifetime hundreds/thousands and
// streak bests), the stale 'pause-this' sheet, and the reactionPrompt
// preference driving the deep-react EpisodeSheet.
const STALE_MS = 30 * 86400000 // a month without logging = stale

interface SheetInfo {
  showId: number
  showName: string
  season: number
  episode: number
  episodeTitle?: string
  variant?: 'default' | 'pause-this'
}

function CheckButton({
  entry,
  onOpenSheet,
}: {
  entry: UpcomingEntry
  onOpenSheet: (info: SheetInfo) => void
}) {
  const shows = useLibrary((s) => s.shows)
  const toggleEpisode = useLibrary((s) => s.toggleEpisode)
  const reactionPrompt = useLibrary((s) => s.reactionPrompt)
  const tracked = shows[entry.showId]
  if (!tracked) return null
  const watched = Boolean(tracked.watched[episodeKey(entry.season, entry.episode)])

  const handleClick = () => {
    // Snapshot pre-check state for milestone deltas (lifetime episode total,
    // longest streak, staleness) — same recipe as the Keep Watching queue.
    const before = useLibrary.getState()
    const wasStale = Date.now() - lastActivity(tracked) > STALE_MS
    let lifetimeBefore = 0
    for (const sh of Object.values(before.shows)) lifetimeBefore += watchedCount(sh)
    const streakBefore = computeStreaks(before.shows, before.movies)

    const nowWatched = toggleEpisode(entry.showId, entry.season, entry.episode)
    showToast(
      nowWatched ? `${epCode(entry)} marked watched ✓` : `${epCode(entry)} marked unwatched`,
      nowWatched ? '✅' : '↩️',
    )
    // Unchecking stays silent — no celebration, no reaction sheet.
    if (!nowWatched) return

    const after = useLibrary.getState()
    const updated = after.shows[entry.showId]
    let lifetimeAfter = 0
    for (const sh of Object.values(after.shows)) lifetimeAfter += watchedCount(sh)
    const streakAfter = computeStreaks(after.shows, after.movies)

    const s = entry.season
    const e = entry.episode
    const tenth = lifetimeAfter > 0 && lifetimeAfter % 10 === 0
    const hitHundred =
      Math.floor(lifetimeAfter / 100) > Math.floor(lifetimeBefore / 100) && lifetimeAfter >= 100
    const hitThousand =
      Math.floor(lifetimeAfter / 1000) > Math.floor(lifetimeBefore / 1000) && lifetimeAfter >= 1000
    const newBestStreak = streakAfter.longest > streakBefore.longest
    let milestone = false

    if (updated && nextEpisode(updated) === null) {
      fireConfetti()
      showToast(`All caught up on ${entry.showName} 🎉`, '🏆')
      milestone = true
    } else if (updated && seasonComplete(updated, s)) {
      fireConfetti()
      showToast(`Season ${s} complete! 🎉`, '🏆')
      milestone = true
    } else if (updated && isSeasonFinale(updated, s, e)) {
      fireConfetti()
      showToast(`Season ${s} finale watched 🎬`, '🏁')
      milestone = true
    } else if (hitThousand) {
      fireConfetti()
      showToast(`${lifetimeAfter.toLocaleString()} episodes watched! 🎉`, '🏆')
      milestone = true
    } else if (hitHundred) {
      fireConfetti({ intensity: 'micro' })
      showToast(`${lifetimeAfter} episodes watched! 🎉`, '💯')
      milestone = true
    } else if (newBestStreak) {
      fireConfetti({ intensity: 'micro' })
      showToast(`New best streak — ${streakAfter.longest} days! 🔥`, '🔥')
      milestone = true
    } else if (updated && isSeriesPremiere(updated, s, e)) {
      fireConfetti({ intensity: 'micro' })
      showToast(`${entry.showName} — series premiere! 🎉`, '🎬')
      milestone = true
    } else if (updated && isSeasonPremiere(updated, s, e)) {
      fireConfetti({ intensity: 'micro' })
      showToast(`Season ${s} premiere 🎬`, '🎬')
      milestone = true
    } else if (tenth) {
      fireConfetti({ intensity: 'micro' })
      showToast(`${lifetimeAfter} episodes watched! 🎉`, '🔟')
      milestone = true
    }

    const episodeTitle = isTba(entry) ? undefined : entry.epName

    // Checking an episode of a STALE show (no activity for >1 month before this
    // check) opens the EpisodeSheet in its 'pause-this' variant — takes
    // precedence over the reaction-frequency preference.
    if (wasStale && updated && nextEpisode(updated) !== null) {
      onOpenSheet({
        showId: entry.showId,
        showName: entry.showName,
        season: s,
        episode: e,
        episodeTitle,
        variant: 'pause-this',
      })
      return
    }

    // Reaction-sheet frequency: 'always' opens the deep-react sheet on every
    // check-off, 'milestones' only on the celebrations above, 'never' skips.
    const openSheet =
      reactionPrompt === 'always' || (reactionPrompt === 'milestones' && milestone)
    if (openSheet) {
      onOpenSheet({
        showId: entry.showId,
        showName: entry.showName,
        season: s,
        episode: e,
        episodeTitle,
      })
    }
  }

  return (
    <button
      className={`upcoming-check${watched ? ' on' : ''}`}
      title={watched ? `Mark ${epCode(entry)} unwatched` : `Mark ${epCode(entry)} watched`}
      aria-pressed={watched}
      onClick={handleClick}
    >
      ✓
    </button>
  )
}

function EpisodeRow({
  entry,
  onOpenSheet,
}: {
  entry: UpcomingEntry
  onOpenSheet: (info: SheetInfo) => void
}) {
  const badge = badgeFor(entry)
  return (
    <div className="upcoming-row">
      <Link className="upcoming-poster" to={`/show/${entry.showId}`}>
        <PosterImage path={entry.poster_path} title={entry.showName} />
      </Link>
      <div className="upcoming-info">
        <div className="upcoming-toprow">
          <span className="upcoming-airtime" title="Approx. local air time (network default)">
            {entry.airTime}
          </span>
          {entry.network && <span className="upcoming-net-badge">{entry.network}</span>}
          <Link className="upcoming-show-pill" to={`/show/${entry.showId}`}>
            <span className="upcoming-pill-name">{entry.showName}</span>
            <span className="upcoming-pill-arrow" aria-hidden="true">
              ›
            </span>
          </Link>
          {entry.sample && <span className="upcoming-sample">sample</span>}
        </div>
        <div className="upcoming-ep">
          <span className="upcoming-code">
            S{pad2(entry.season)} <span className="upcoming-code-sep">|</span> E{pad2(entry.episode)}
          </span>
          {badge && (
            <span className={`upcoming-badge ${badge === 'NEW' ? 'new' : 'premiere'}`}>
              {badge}
            </span>
          )}
        </div>
        <div className="upcoming-ep-title">{isTba(entry) ? 'TBA' : entry.epName}</div>
      </div>
      <div className="upcoming-when">
        <span
          className={`chip upcoming-days${entry.days === 0 ? ' today' : ''}${
            entry.days < 0 ? ' past' : ''
          }`}
        >
          {countdownLabel(entry.days)}
        </span>
        {entry.recent && <CheckButton entry={entry} onOpenSheet={onOpenSheet} />}
      </div>
    </div>
  )
}

/** Shimmering placeholders shaped like the day-grouped schedule. */
function UpcomingListSkeleton() {
  return (
    <div aria-hidden="true">
      {[3, 2].map((rows, gi) => (
        <div key={gi}>
          <div className="skeleton upcoming-skel-header" />
          <div className="upcoming-list">
            {Array.from({ length: rows }, (_, i) => (
              <div className="upcoming-row upcoming-row-skeleton" key={i}>
                <div className="skeleton upcoming-skel-poster" />
                <div className="upcoming-info">
                  <div className="skeleton skeleton-line" style={{ width: '30%', marginTop: 0 }} />
                  <div className="skeleton skeleton-line" style={{ width: '55%' }} />
                </div>
                <div className="skeleton upcoming-skel-chip" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------- movies ----------

function releaseChipLabel(m: SearchResult): string {
  if (!m.release_date) return 'TBA'
  const days = daysFromToday(m.release_date)
  if (days <= 0) return 'Out now'
  if (days === 1) return 'Tomorrow'
  if (days <= 30) return `in ${days} days`
  return parseIsoDate(m.release_date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

// ---------- page ----------

export default function Upcoming() {
  const shows = useLibrary((s) => s.shows)
  const demo = isDemoMode()

  // Stable key of followed non-paused ids so re-renders from watch-toggles
  // (new `shows` object) don't retrigger the fetch effect. Only the first
  // MAX_SHOW_FETCHES ids are fetched, so order by how likely each show is to
  // actually have something on the calendar (known upcoming episode first,
  // then still-airing shows, then most recently added) — NOT by TMDB id,
  // which silently starved the newest shows on large libraries.
  const followKey = useMemo(() => {
    const rank = (s: TrackedShow): number =>
      s.snapshot.nextEpisodeToAir?.airDate
        ? 0
        : /Returning|In Production/i.test(s.snapshot.status)
          ? 1
          : 2
    return Object.values(shows)
      .filter((s) => !s.paused)
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (a.snapshot.nextEpisodeToAir?.airDate ?? '').localeCompare(
            b.snapshot.nextEpisodeToAir?.airDate ?? '',
          ) ||
          b.addedAt.localeCompare(a.addedAt) ||
          a.snapshot.id - b.snapshot.id,
      )
      .map((s) => s.snapshot.id)
      .join(',')
  }, [shows])
  const followedCount = followKey ? followKey.split(',').length : 0
  const truncatedCount = Math.max(0, followedCount - MAX_SHOW_FETCHES)

  const [entries, setEntries] = useState<UpcomingEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [movies, setMovies] = useState<SearchResult[] | null>(null)
  const [moviesError, setMoviesError] = useState<string | null>(null)

  const [filters, setFilters] = useState<FilterPrefs>(loadFilters)
  useEffect(() => saveFilters(filters), [filters])

  // Deep-react EpisodeSheet opened by check-offs (unified check path).
  const [sheet, setSheet] = useState<SheetInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    const ids = followKey ? followKey.split(',').map(Number) : []

    async function load() {
      // Keep any already-rendered schedule visible while reloading: followKey
      // changes whenever the freshness engine advances a show's snapshot, and
      // blanking to the skeleton on every background refresh made the page
      // flash and reshuffle repeatedly during a refresh run. First load still
      // shows the skeleton (entries starts as null).
      setError(null)
      try {
        const allShows = useLibrary.getState().shows
        const details = await Promise.all(
          ids.slice(0, MAX_SHOW_FETCHES).map((id) => cachedShowDetail(id).catch(() => null)),
        )
        const collected: UpcomingEntry[] = []
        const seen = new Set<string>()

        const push = (e: UpcomingEntry) => {
          const key = `${e.showId}:${episodeKey(e.season, e.episode)}`
          if (seen.has(key)) return
          seen.add(key)
          collected.push(e)
        }

        for (const detail of details) {
          if (!detail) continue
          const network =
            allShows[detail.id]?.snapshot.network ?? detail.networks[0]?.name
          const next = detail.next_episode_to_air
          if (next?.air_date) {
            const days = daysFromToday(next.air_date)
            if (days >= -7) {
              push({
                showId: detail.id,
                showName: detail.name,
                poster_path: detail.poster_path,
                season: next.season_number,
                episode: next.episode_number,
                epName: next.name,
                airDate: next.air_date,
                airTime: airTimeFor(network),
                days,
                network,
                sample: false,
                recent: days < 0,
              })
            }
          }
          // "Earlier this week": the most recent aired episode, still checkable.
          const last = detail.last_episode_to_air
          if (last?.air_date) {
            const days = daysFromToday(last.air_date)
            if (days >= -7 && days <= 0) {
              push({
                showId: detail.id,
                showName: detail.name,
                poster_path: detail.poster_path,
                season: last.season_number,
                episode: last.episode_number,
                epName: last.name,
                airDate: last.air_date,
                airTime: airTimeFor(network),
                days,
                network,
                sample: false,
                recent: true,
              })
            }
          }
        }

        // Demo mode: merge sample shows' next episodes so the schedule has life.
        if (isDemoMode()) {
          const followed = new Set(Object.keys(allShows).map(Number))
          for (const s of MOCK_SHOWS) {
            if (followed.has(s.id)) continue
            const ep = s.next_episode_to_air
            if (ep?.air_date) {
              push({
                showId: s.id,
                showName: s.name,
                poster_path: s.poster_path,
                season: ep.season_number,
                episode: ep.episode_number,
                epName: ep.name,
                airDate: ep.air_date,
                airTime: airTimeFor(s.networks[0]?.name),
                days: daysFromToday(ep.air_date),
                network: s.networks[0]?.name,
                sample: true,
                recent: false,
              })
            }
          }
        }

        collected.sort(
          (a, b) => a.airDate.localeCompare(b.airDate) || a.showName.localeCompare(b.showName),
        )
        if (!cancelled) setEntries(collected)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load upcoming episodes.')
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [followKey])

  useEffect(() => {
    let cancelled = false
    upcomingMovies()
      .then((m) => {
        if (!cancelled) setMovies(m)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setMoviesError(e instanceof Error ? e.message : 'Failed to load upcoming movies.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Distinct networks present (from unfiltered entries), for the chip row.
  const networks = useMemo(() => {
    if (!entries) return []
    const set = new Set<string>()
    for (const e of entries) if (e.network) set.add(e.network)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [entries])

  // The selected network only *filters* once it actually exists in the loaded
  // entries (so a persisted pick for a network with nothing scheduled doesn't
  // blank the list). Chip styling, below, uses filters.network directly so the
  // tap sticks visibly even before entries resolve.
  const activeNetwork = useMemo(
    () => (filters.network && networks.includes(filters.network) ? filters.network : null),
    [filters.network, networks],
  )

  const groups = useMemo(() => {
    if (!entries) return []
    const visible = entries.filter((e) => {
      if (filters.hideTba && isTba(e)) return false
      if (
        filters.hideWatched &&
        shows[e.showId]?.watched[episodeKey(e.season, e.episode)]
      ) {
        return false
      }
      if (activeNetwork && e.network !== activeNetwork) return false
      return true
    })
    const out: { label: string; items: UpcomingEntry[] }[] = []
    for (const e of visible) {
      const label = groupLabel(e.days, e.airDate)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(e)
      else out.push({ label, items: [e] })
    }
    return out
  }, [entries, filters.hideTba, filters.hideWatched, shows, activeNetwork])

  // Single-select: tapping the active network clears it back to "All".
  const selectNetwork = (n: string) =>
    setFilters((f) => ({ ...f, network: f.network === n ? null : n }))

  const showEmptyState = !demo && followedCount === 0

  return (
    <div>
      <div className="toptabs" role="tablist" aria-label="Schedule view">
        <Link className="toptab" to="/" role="tab" aria-selected="false">
          Keep Watching
        </Link>
        <span className="toptab active" role="tab" aria-selected="true">
          Upcoming
        </span>
        <Link className="toptab" to="/watchlist" role="tab" aria-selected="false">
          Watch List
        </Link>
      </div>
      <p className="page-subtitle">
        Air dates for the shows you follow{demo ? ' — plus sample shows in demo mode' : ''}.
      </p>

      {showEmptyState ? (
        <div className="empty-state card upcoming-empty">
          <div className="upcoming-popcorn" aria-hidden="true">
            <span className="upcoming-popcorn-pop pop1">🍿</span>
            <span className="upcoming-popcorn-box">🍿</span>
            <span className="upcoming-popcorn-pop pop2">🍿</span>
          </div>
          <div className="upcoming-empty-title">Your upcoming list is empty!</div>
          <p style={{ maxWidth: 420, margin: '0 auto' }}>
            When you follow shows, their upcoming episodes land on this schedule so you never
            miss an air date. Find something to track and hit follow.
          </p>
          <div className="upcoming-empty-cta">
            <Link className="btn primary" to="/search">
              BROWSE ALL SHOWS
            </Link>
            <Link className="btn primary" to="/search">
              BROWSE ALL MOVIES
            </Link>
          </div>
        </div>
      ) : error ? (
        <ErrorBox message={error} />
      ) : entries === null ? (
        <UpcomingListSkeleton />
      ) : (
        <>
          {entries.length > 0 && (
            <div className="upcoming-filters" role="group" aria-label="Filters">
              {/* Single-select: exactly one of All / a network carries `.on`.
                  Styling reads filters.network directly so the tap sticks even
                  while entries are still loading. */}
              <button
                className={`chip upcoming-filter${filters.network === null ? ' on' : ''}`}
                aria-pressed={filters.network === null}
                onClick={() => setFilters((f) => ({ ...f, network: null }))}
              >
                All
              </button>
              {networks.map((n) => (
                <button
                  key={n}
                  className={`chip upcoming-filter${filters.network === n ? ' on' : ''}`}
                  aria-pressed={filters.network === n}
                  onClick={() => selectNetwork(n)}
                >
                  {n}
                </button>
              ))}
              <button
                className={`chip upcoming-filter upcoming-filter-tba${filters.hideTba ? ' on' : ''}`}
                aria-pressed={filters.hideTba}
                onClick={() => setFilters((f) => ({ ...f, hideTba: !f.hideTba }))}
              >
                Hide TBA
              </button>
              <button
                className={`chip upcoming-filter upcoming-filter-tba${
                  filters.hideWatched ? ' on' : ''
                }`}
                aria-pressed={filters.hideWatched}
                onClick={() => setFilters((f) => ({ ...f, hideWatched: !f.hideWatched }))}
              >
                Hide watched
              </button>
            </div>
          )}

          {entries.length === 0 ? (
            <div className="card upcoming-caughtup fade-in">
              <div style={{ fontSize: 28, marginBottom: 8 }}>🎉</div>
              You’re all caught up — none of your followed shows have a scheduled episode.
            </div>
          ) : groups.length === 0 ? (
            <div className="card upcoming-caughtup fade-in">
              <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
              Nothing matches these filters — try switching back to All.
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.label}>
                <h2 className="upcoming-day-header">
                  <span className="upcoming-day-label">{g.label}</span>
                  <span className="upcoming-day-line" aria-hidden="true" />
                  <span className="upcoming-group-count">{g.items.length}</span>
                </h2>
                <div className="upcoming-list stagger">
                  {g.items.map((e) => (
                    <EpisodeRow
                      key={`${e.showId}:s${e.season}e${e.episode}`}
                      entry={e}
                      onOpenSheet={setSheet}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
          {truncatedCount > 0 && (
            <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 14 }}>
              Schedule checked for the {MAX_SHOW_FETCHES} shows most likely to be airing —{' '}
              {truncatedCount} other followed {truncatedCount === 1 ? 'show was' : 'shows were'}{' '}
              not checked.
            </p>
          )}
        </>
      )}

      <h2 className="section-title" style={{ marginTop: 36 }}>
        In theaters soon
      </h2>
      {moviesError ? (
        <ErrorBox message={moviesError} />
      ) : movies === null ? (
        <SkeletonRow />
      ) : movies.length === 0 ? (
        <p style={{ color: 'var(--text-dim)' }}>No upcoming movies found.</p>
      ) : (
        <div className="media-row stagger">
          {movies.slice(0, 12).map((m) => (
            <div className="upcoming-movie" key={m.id}>
              <PosterCard item={m} />
              <span className="chip upcoming-release">📅 {releaseChipLabel(m)}</span>
            </div>
          ))}
        </div>
      )}

      {sheet && <EpisodeSheet {...sheet} onClose={() => setSheet(null)} />}
    </div>
  )
}
