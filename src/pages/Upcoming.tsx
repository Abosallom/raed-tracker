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
} from '../store/library'
import { ErrorBox, PosterCard, PosterImage, SkeletonRow } from '../components/shared'
import { showToast } from '../components/toast'
import { fireConfetti } from '../components/Confetti'
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
      return { network, hideTba: parsed.hideTba === true }
    }
  } catch {
    /* corrupted prefs — fall through to defaults */
  }
  return { network: null, hideTba: false }
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

/** Whole days from today's local midnight (0 = today, negative = past). */
function daysFromToday(iso: string): number {
  const target = parseIsoDate(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

/** "Today" / "Tomorrow" / weekday for the next week / "JUL 12" beyond. */
function groupLabel(days: number, iso: string): string {
  if (days < 0) return 'Earlier this week'
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  const date = parseIsoDate(iso)
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

function CheckButton({ entry }: { entry: UpcomingEntry }) {
  const shows = useLibrary((s) => s.shows)
  const toggleEpisode = useLibrary((s) => s.toggleEpisode)
  const tracked = shows[entry.showId]
  if (!tracked) return null
  const watched = Boolean(tracked.watched[episodeKey(entry.season, entry.episode)])
  return (
    <button
      className={`upcoming-check${watched ? ' on' : ''}`}
      title={watched ? `Mark ${epCode(entry)} unwatched` : `Mark ${epCode(entry)} watched`}
      aria-pressed={watched}
      onClick={() => {
        const nowWatched = toggleEpisode(entry.showId, entry.season, entry.episode)
        showToast(
          nowWatched ? `${epCode(entry)} marked watched ✓` : `${epCode(entry)} marked unwatched`,
          nowWatched ? '✅' : '↩️',
        )
        if (nowWatched) {
          const updated = useLibrary.getState().shows[entry.showId]
          if (updated && nextEpisode(updated) === null) {
            fireConfetti()
            showToast(`All caught up on ${entry.showName} 🎉`, '🏆')
          } else if (updated && seasonComplete(updated, entry.season)) {
            fireConfetti()
            showToast(`Season ${entry.season} complete! 🎉`, '🏆')
          } else if (updated && isSeasonFinale(updated, entry.season, entry.episode)) {
            fireConfetti({ intensity: 'micro' })
            showToast(`Season ${entry.season} finale watched 🎬`, '🏁')
          } else if (updated && isSeriesPremiere(updated, entry.season, entry.episode)) {
            fireConfetti({ intensity: 'micro' })
            showToast(`${entry.showName} — series premiere! 🎉`, '🎬')
          } else if (updated && isSeasonPremiere(updated, entry.season, entry.episode)) {
            fireConfetti({ intensity: 'micro' })
            showToast(`Season ${entry.season} premiere 🎬`, '🎬')
          }
        }
      }}
    >
      ✓
    </button>
  )
}

function EpisodeRow({ entry }: { entry: UpcomingEntry }) {
  const badge = badgeFor(entry)
  return (
    <div className="upcoming-row">
      <Link className="upcoming-poster" to={`/show/${entry.showId}`}>
        <PosterImage path={entry.poster_path} title={entry.showName} />
      </Link>
      <div className="upcoming-info">
        <div className="upcoming-toprow">
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
        {entry.network && <span className="chip upcoming-network">{entry.network}</span>}
        <span
          className={`chip upcoming-days${entry.days === 0 ? ' today' : ''}${
            entry.days < 0 ? ' past' : ''
          }`}
        >
          {countdownLabel(entry.days)}
        </span>
        {entry.recent && <CheckButton entry={entry} />}
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
  }, [entries, filters.hideTba, activeNetwork])

  // Single-select: tapping the active network clears it back to "All".
  const selectNetwork = (n: string) =>
    setFilters((f) => ({ ...f, network: f.network === n ? null : n }))

  const showEmptyState = !demo && followedCount === 0

  return (
    <div>
      <div className="toptabs" role="tablist" aria-label="Schedule view">
        <Link className="toptab" to="/shows" role="tab" aria-selected="false">
          Watch List
        </Link>
        <span className="toptab active" role="tab" aria-selected="true">
          Upcoming
        </span>
      </div>
      <p className="page-subtitle">
        Air dates for the shows you follow{demo ? ' — plus sample shows in demo mode' : ''}.
      </p>

      {showEmptyState ? (
        <div className="empty-state card">
          <div className="big">📡</div>
          <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text)', marginBottom: 6 }}>
            Nothing on the calendar yet
          </div>
          <p style={{ maxWidth: 420, margin: '0 auto' }}>
            When you follow shows, their upcoming episodes land on this schedule so you never
            miss an air date. Find something to track and hit follow.
          </p>
          <div style={{ marginTop: 18, display: 'flex', gap: 10, justifyContent: 'center' }}>
            <Link className="btn primary" to="/search">
              Search shows
            </Link>
            <Link className="btn" to="/">
              Browse trending
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
                    <EpisodeRow key={`${e.showId}:s${e.season}e${e.episode}`} entry={e} />
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
    </div>
  )
}
