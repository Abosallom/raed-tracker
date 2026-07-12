// Movies hub — segmented tabs: Watch list / Watched / Upcoming.
// Watch list unions tracked-unwatched movies with movie watchlist entries;
// tiles are a dense poster mosaic with hover quick actions. The Watch list tab
// opens with a "Discover more" rail (TMDB popular/upcoming) for one-tap adds.

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLibrary } from '../store/library'
import { getMovieDetail, topRatedMovies, upcomingMovies } from '../api/tmdb'
import { ErrorBox, PosterImage, formatMinutes } from '../components/shared'
import { showToast } from '../components/toast'
import { fireConfetti } from '../components/Confetti'
import { EMOTIONS } from '../types'
import type { Emotion, SearchResult, TrackedMovie } from '../types'
import './movies.css'

type Tab = 'watchlist' | 'watched' | 'upcoming'
type SortKey = 'recent' | 'az' | 'runtime'

interface MoviesFilters {
  favOnly: boolean
  sort: SortKey
  genre: string | null // top-level genre name, or null = all
  decade: number | null // e.g. 2010; only meaningful on the Watched tab
}

const DEFAULT_FILTERS: MoviesFilters = {
  favOnly: false,
  sort: 'recent',
  genre: null,
  decade: null,
}

const FILTERS_STORAGE = 'raedtracker_movies_filters'

function loadFilters(): MoviesFilters {
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE)
    if (!raw) return DEFAULT_FILTERS
    const parsed = JSON.parse(raw) as Partial<MoviesFilters>
    return {
      favOnly: Boolean(parsed.favOnly),
      sort: parsed.sort === 'az' || parsed.sort === 'runtime' ? parsed.sort : 'recent',
      genre: typeof parsed.genre === 'string' ? parsed.genre : null,
      decade: typeof parsed.decade === 'number' ? parsed.decade : null,
    }
  } catch {
    return DEFAULT_FILTERS
  }
}

// Cap + module-level cache so the Upcoming tab fetches at most once per session.
const UPCOMING_CAP = 20
let upcomingCache: SearchResult[] | null = null

// Discover rail cache (topRated ∪ upcoming, deduped) — fetched once per session.
const DISCOVER_CAP = 18
let discoverCache: SearchResult[] | null = null

interface WatchItem {
  id: number
  title: string
  poster_path: string | null
  /** true = in the movie library (unwatched); false = watchlist-only entry. */
  tracked: boolean
  favorite: boolean
  addedAt: string
  runtime: number | null
  genre: string | null
}

function emotionEmoji(key: Emotion | undefined): string | null {
  if (!key) return null
  return EMOTIONS.find((e) => e.key === key)?.emoji ?? null
}

/** "1h 48m · Thriller" style meta line from runtime + top genre. */
function tileMeta(runtime: number | null, genre: string | null): string | null {
  const parts: string[] = []
  if (runtime && runtime > 0) parts.push(formatMinutes(runtime))
  if (genre) parts.push(genre)
  return parts.length ? parts.join(' · ') : null
}

function releaseChip(dateStr: string | undefined): { label: string; future: boolean } | null {
  if (!dateStr) return null
  const target = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (diff > 1) return { label: `in ${diff} days`, future: true }
  if (diff === 1) return { label: 'Tomorrow', future: true }
  if (diff === 0) return { label: 'Today', future: true }
  return {
    label: target.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    future: false,
  }
}

// ---------- discover rail ----------

function DiscoverCard({ item, onAdd }: { item: SearchResult; onAdd: (item: SearchResult) => void }) {
  const tracked = useLibrary((s) => Boolean(s.movies[item.id]))
  const onList = useLibrary((s) => s.watchlist.some((w) => w.type === 'movie' && w.id === item.id))
  const added = tracked || onList
  return (
    <div className="movies-disc-card">
      <Link className="movies-disc-poster" to={`/movie/${item.id}`} title={item.name}>
        <PosterImage path={item.poster_path} title={item.name} />
      </Link>
      <button
        className={`movies-disc-add${added ? ' on' : ''}`}
        title={added ? 'Already on your watch list' : `Add ${item.name} to watch list`}
        aria-label={added ? `${item.name} already on watch list` : `Add ${item.name} to watch list`}
        disabled={added}
        onClick={() => onAdd(item)}
      >
        {added ? '✓' : '+'}
      </button>
      <div className="movies-disc-title" title={item.name}>
        {item.name}
      </div>
    </div>
  )
}

function DiscoverRail({ items, onAdd }: { items: SearchResult[]; onAdd: (item: SearchResult) => void }) {
  if (items.length === 0) return null
  return (
    <section className="movies-disc fade-in" aria-label="Discover more movies">
      <div className="movies-disc-head">
        <span className="movies-disc-eyebrow">Discover more</span>
        <Link className="movies-disc-all" to="/search">
          Browse all →
        </Link>
      </div>
      <div className="movies-disc-rail stagger">
        {items.map((it) => (
          <DiscoverCard key={it.id} item={it} onAdd={onAdd} />
        ))}
      </div>
    </section>
  )
}

function DiscoverRailSkeleton() {
  return (
    <section className="movies-disc" aria-hidden="true">
      <div className="movies-disc-head">
        <span className="movies-disc-eyebrow">Discover more</span>
      </div>
      <div className="movies-disc-rail">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="movies-disc-card">
            <div className="skeleton movies-disc-poster" />
            <div className="skeleton skeleton-line" style={{ width: '80%', marginTop: 6 }} />
          </div>
        ))}
      </div>
    </section>
  )
}

// ---------- filters sheet ----------

function FiltersSheet({
  open,
  filters,
  genres,
  decades,
  onChange,
  onReset,
  onClose,
}: {
  open: boolean
  filters: MoviesFilters
  genres: string[]
  decades: number[]
  onChange: (patch: Partial<MoviesFilters>) => void
  onReset: () => void
  onClose: () => void
}) {
  const [closing, setClosing] = useState(false)
  const sheetRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    setClosing(false)
    const el = sheetRef.current
    el?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function requestClose() {
    if (reduce) {
      onClose()
      return
    }
    setClosing(true)
    window.setTimeout(onClose, 200)
  }

  const sorts: { key: SortKey; label: string }[] = [
    { key: 'recent', label: 'Recently added' },
    { key: 'az', label: 'A–Z' },
    { key: 'runtime', label: 'Runtime' },
  ]

  return (
    <div
      className={`movies-sheet-backdrop${closing ? ' closing' : ''}`}
      onClick={requestClose}
      role="presentation"
    >
      <div
        ref={sheetRef}
        className={`movies-sheet${closing ? ' closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Filter movies"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="movies-sheet-grip" aria-hidden="true" />
        <div className="movies-sheet-head">
          <h2 className="movies-sheet-title">Filter &amp; sort</h2>
          <button className="movies-sheet-close" aria-label="Close filters" onClick={requestClose}>
            ✕
          </button>
        </div>

        <div className="movies-sheet-section">
          <div className="movies-sheet-label">Sort by</div>
          <div className="movies-chip-row">
            {sorts.map((s) => (
              <button
                key={s.key}
                className={`movies-chip-opt${filters.sort === s.key ? ' on' : ''}`}
                aria-pressed={filters.sort === s.key}
                onClick={() => onChange({ sort: s.key })}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {genres.length > 0 && (
          <div className="movies-sheet-section">
            <div className="movies-sheet-label">Genre</div>
            <div className="movies-chip-row">
              <button
                className={`movies-chip-opt${filters.genre === null ? ' on' : ''}`}
                aria-pressed={filters.genre === null}
                onClick={() => onChange({ genre: null })}
              >
                All
              </button>
              {genres.map((g) => (
                <button
                  key={g}
                  className={`movies-chip-opt${filters.genre === g ? ' on' : ''}`}
                  aria-pressed={filters.genre === g}
                  onClick={() => onChange({ genre: filters.genre === g ? null : g })}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}

        {decades.length > 0 && (
          <div className="movies-sheet-section">
            <div className="movies-sheet-label">
              Decade <span className="movies-sheet-hint">(by year watched)</span>
            </div>
            <div className="movies-chip-row">
              <button
                className={`movies-chip-opt${filters.decade === null ? ' on' : ''}`}
                aria-pressed={filters.decade === null}
                onClick={() => onChange({ decade: null })}
              >
                All
              </button>
              {decades.map((d) => (
                <button
                  key={d}
                  className={`movies-chip-opt${filters.decade === d ? ' on' : ''}`}
                  aria-pressed={filters.decade === d}
                  onClick={() => onChange({ decade: filters.decade === d ? null : d })}
                >
                  {d}s
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="movies-sheet-section">
          <button
            className={`movies-fav-toggle${filters.favOnly ? ' on' : ''}`}
            role="switch"
            aria-checked={filters.favOnly}
            onClick={() => onChange({ favOnly: !filters.favOnly })}
          >
            <span className="movies-fav-star" aria-hidden="true">
              {filters.favOnly ? '★' : '☆'}
            </span>
            Favorites only
            <span className="movies-fav-knob" aria-hidden="true" />
          </button>
        </div>

        <div className="movies-sheet-foot">
          <button className="movies-sheet-reset" onClick={onReset}>
            Reset
          </button>
          <button className="btn primary movies-sheet-done" onClick={requestClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- mosaic tile ----------

function MosaicTile({
  id,
  title,
  poster_path,
  checked,
  busy,
  emotion,
  meta,
  onCheck,
  onRemove,
  removeTitle,
}: {
  id: number
  title: string
  poster_path: string | null
  checked: boolean
  busy?: boolean
  emotion?: string | null
  meta?: string | null
  onCheck: () => void
  onRemove: () => void
  removeTitle: string
}) {
  return (
    <div className="movies-tile">
      <Link className="movies-tile-link" to={`/movie/${id}`} title={title}>
        <PosterImage path={poster_path} title={title} />
        {/* Hover overlay carries the meta only — the title now lives in the
            always-visible caption below (bare posters were unidentifiable,
            and the overlay never shows on touch). */}
        {meta && (
          <span className="movies-tile-overlay" aria-hidden="true">
            <span className="movies-tile-text">
              <span className="movies-tile-meta">{meta}</span>
            </span>
          </span>
        )}
        {emotion && (
          <span className="movies-tile-emotion" title="Your reaction">
            {emotion}
          </span>
        )}
      </Link>
      <div className="movies-tile-caption">{title}</div>
      <button
        className={`movies-tile-btn check${checked ? ' on' : ''}`}
        title={checked ? 'Mark unwatched' : 'Mark watched'}
        aria-label={checked ? `Mark ${title} unwatched` : `Mark ${title} watched`}
        disabled={busy}
        onClick={onCheck}
      >
        {busy ? '…' : '✓'}
      </button>
      <button
        className="movies-tile-btn remove"
        title={removeTitle}
        aria-label={`${removeTitle}: ${title}`}
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  )
}

// ---------- upcoming ----------

function UpcomingRow({ item }: { item: SearchResult }) {
  const tracked = useLibrary((s) => Boolean(s.movies[item.id]))
  const onList = useLibrary((s) => s.watchlist.some((w) => w.type === 'movie' && w.id === item.id))
  const addToWatchlist = useLibrary((s) => s.addToWatchlist)
  const removeFromWatchlist = useLibrary((s) => s.removeFromWatchlist)
  const chip = releaseChip(item.release_date)

  return (
    <div className="movies-uprow">
      <Link className="movies-upposter" to={`/movie/${item.id}`} title={item.name}>
        <PosterImage path={item.poster_path} title={item.name} />
      </Link>
      <div className="movies-upinfo">
        <Link className="movies-uptitle" to={`/movie/${item.id}`} title={item.name}>
          {item.name}
        </Link>
        <div className="movies-upmeta">
          {chip && (
            <span className={`chip movies-upchip${chip.future ? ' future' : ''}`}>
              {chip.label}
            </span>
          )}
          {item.vote_average > 0 && (
            <span className="chip movies-upchip star">★ {item.vote_average.toFixed(1)}</span>
          )}
        </div>
      </div>
      {tracked ? (
        <span className="chip movies-upstate">✓ In library</span>
      ) : onList ? (
        <button
          className="btn small movies-upadd on"
          title="Remove from watchlist"
          onClick={() => {
            removeFromWatchlist('movie', item.id)
            showToast(`${item.name} removed from watchlist`, '↩️')
          }}
        >
          ✓ Watchlist
        </button>
      ) : (
        <button
          className="btn small primary movies-upadd"
          title="Add to watchlist"
          onClick={() => {
            addToWatchlist({ type: 'movie', id: item.id, name: item.name, poster_path: item.poster_path })
            showToast(`${item.name} added to watchlist`, '🍿')
          }}
        >
          + Watchlist
        </button>
      )}
    </div>
  )
}

function UpcomingSkeleton() {
  return (
    <div className="movies-uplist" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="movies-uprow">
          <div className="skeleton" style={{ width: 56, height: 84, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton skeleton-line" style={{ width: '45%', marginTop: 0 }} />
            <div className="skeleton skeleton-line" style={{ width: '26%' }} />
          </div>
          <div className="skeleton" style={{ width: 92, height: 30 }} />
        </div>
      ))}
    </div>
  )
}

// ---------- empty states ----------

function BrowseEmpty({ emoji, message }: { emoji: string; message: string }) {
  return (
    <div className="empty-state fade-in">
      <div className="big">{emoji}</div>
      <p style={{ marginBottom: 18 }}>{message}</p>
      <Link className="btn primary" to="/search">
        Browse all movies
      </Link>
    </div>
  )
}

// ---------- page ----------

export default function Movies() {
  const movies = useLibrary((s) => s.movies)
  const watchlist = useLibrary((s) => s.watchlist)
  const toggleMovieWatched = useLibrary((s) => s.toggleMovieWatched)
  const removeMovie = useLibrary((s) => s.removeMovie)
  const removeFromWatchlist = useLibrary((s) => s.removeFromWatchlist)
  const addMovie = useLibrary((s) => s.addMovie)
  const addToWatchlist = useLibrary((s) => s.addToWatchlist)

  const [tab, setTab] = useState<Tab>('watchlist')
  const [filters, setFilters] = useState<MoviesFilters>(loadFilters)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [busyIds, setBusyIds] = useState<number[]>([])
  const [upcoming, setUpcoming] = useState<SearchResult[] | null>(upcomingCache)
  const [upcomingError, setUpcomingError] = useState<string | null>(null)
  const [discover, setDiscover] = useState<SearchResult[] | null>(discoverCache)

  // Persist filters on change.
  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_STORAGE, JSON.stringify(filters))
    } catch {
      /* storage full / disabled — filters just won't persist */
    }
  }, [filters])

  const patchFilters = (patch: Partial<MoviesFilters>) =>
    setFilters((f) => ({ ...f, ...patch }))

  // Discover rail: topRated ∪ upcoming, deduped, capped. Fetched once when the
  // Watch list tab first mounts; degrades to whatever demo data resolves.
  useEffect(() => {
    if (tab !== 'watchlist' || discover !== null) return
    let cancelled = false
    Promise.allSettled([topRatedMovies(), upcomingMovies()])
      .then(([top, up]) => {
        const merged: SearchResult[] = []
        const seen = new Set<number>()
        const push = (list: SearchResult[]) => {
          for (const m of list) {
            if (seen.has(m.id)) continue
            seen.add(m.id)
            merged.push(m)
          }
        }
        if (top.status === 'fulfilled') push(top.value)
        if (up.status === 'fulfilled') push(up.value)
        discoverCache = merged.slice(0, DISCOVER_CAP)
        if (!cancelled) setDiscover(discoverCache)
      })
      .catch(() => {
        // All rejected — show nothing rather than an error (rail is optional).
        discoverCache = []
        if (!cancelled) setDiscover(discoverCache)
      })
    return () => {
      cancelled = true
    }
  }, [tab, discover])

  useEffect(() => {
    if (tab !== 'upcoming' || upcoming !== null) return
    let cancelled = false
    setUpcomingError(null)
    upcomingMovies()
      .then((list) => {
        upcomingCache = list.slice(0, UPCOMING_CAP)
        if (!cancelled) setUpcoming(upcomingCache)
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setUpcomingError(e instanceof Error ? e.message : 'Could not load upcoming movies.')
      })
    return () => {
      cancelled = true
    }
  }, [tab, upcoming])

  const all = Object.values(movies)

  const addDiscover = (item: SearchResult) => {
    addToWatchlist({ type: 'movie', id: item.id, name: item.name, poster_path: item.poster_path })
    showToast(`${item.name} added to watch list`, '🍿')
  }

  // Tab 1: tracked-but-unwatched ∪ movie watchlist entries, deduped by id
  // (any tracked movie wins over its watchlist twin).
  const watchItems: WatchItem[] = all
    .filter((m) => m.watched === null)
    .map((m) => ({
      id: m.snapshot.id,
      title: m.snapshot.title,
      poster_path: m.snapshot.poster_path,
      tracked: true,
      favorite: m.favorite,
      addedAt: m.addedAt,
      runtime: m.snapshot.runtime,
      genre: m.snapshot.genres[0] ?? null,
    }))
  for (const w of watchlist) {
    if (w.type === 'movie' && !movies[w.id]) {
      watchItems.push({
        id: w.id,
        title: w.name,
        poster_path: w.poster_path,
        tracked: false,
        favorite: false,
        addedAt: w.addedAt,
        runtime: null,
        genre: null,
      })
    }
  }

  // Tab 2: watched movies.
  const watchedList = all.filter((m) => m.watched !== null)

  // ---- filter option sets (derived from the visible tab's data) ----
  const activeSource = tab === 'watched' ? watchedList : []
  const watchGenreSet = new Set<string>()
  for (const it of watchItems) if (it.genre) watchGenreSet.add(it.genre)
  const watchedGenreSet = new Set<string>()
  for (const m of watchedList) for (const g of m.snapshot.genres) watchedGenreSet.add(g)
  const genreOptions = (tab === 'watched' ? [...watchedGenreSet] : [...watchGenreSet]).sort()

  // Decade derives from the year a movie was watched (MovieSnapshot lacks a
  // release year), so it's only offered on the Watched tab.
  const decadeSet = new Set<number>()
  for (const m of activeSource) {
    const y = Number((m.watched?.watchedAt ?? '').slice(0, 4))
    if (y) decadeSet.add(Math.floor(y / 10) * 10)
  }
  const decadeOptions = [...decadeSet].sort((a, b) => b - a)

  // ---- apply filters ----
  const byGenreWatch = (it: WatchItem) => !filters.genre || it.genre === filters.genre
  const byGenreWatched = (m: TrackedMovie) =>
    !filters.genre || m.snapshot.genres.includes(filters.genre)
  const byDecade = (m: TrackedMovie) => {
    if (filters.decade === null) return true
    const y = Number((m.watched?.watchedAt ?? '').slice(0, 4))
    return y >= filters.decade && y < filters.decade + 10
  }

  const sortWatch = (a: WatchItem, b: WatchItem) => {
    if (filters.sort === 'az') return a.title.localeCompare(b.title)
    if (filters.sort === 'runtime') return (b.runtime ?? 0) - (a.runtime ?? 0)
    return b.addedAt.localeCompare(a.addedAt)
  }
  const sortWatched = (a: TrackedMovie, b: TrackedMovie) => {
    if (filters.sort === 'az') return a.snapshot.title.localeCompare(b.snapshot.title)
    if (filters.sort === 'runtime') return b.snapshot.runtime - a.snapshot.runtime
    return (b.watched?.watchedAt ?? '').localeCompare(a.watched?.watchedAt ?? '')
  }

  const watchShown = watchItems
    .filter((i) => (!filters.favOnly || i.favorite) && byGenreWatch(i))
    .sort(sortWatch)

  const watchedShown = watchedList
    .filter((m) => (!filters.favOnly || m.favorite) && byGenreWatched(m) && byDecade(m))
    .sort(sortWatched)
  const watchedMinutes = watchedShown.reduce((sum, m) => sum + m.snapshot.runtime, 0)

  const filterActive =
    filters.favOnly ||
    filters.genre !== null ||
    filters.decade !== null ||
    filters.sort !== 'recent'
  const filterCount =
    (filters.favOnly ? 1 : 0) +
    (filters.genre !== null ? 1 : 0) +
    (filters.decade !== null ? 1 : 0) +
    (filters.sort !== 'recent' ? 1 : 0)

  const checkTracked = (id: number, title: string) => {
    const nowWatched = toggleMovieWatched(id)
    showToast(
      nowWatched ? `${title} watched ✓` : `${title} moved back to watch list`,
      nowWatched ? '🎬' : '↩️',
    )
    if (nowWatched) maybeCelebrateCleared(id)
  }

  const checkWatchlistOnly = async (id: number, title: string) => {
    if (busyIds.includes(id)) return
    setBusyIds((b) => [...b, id])
    try {
      const detail = await getMovieDetail(id)
      addMovie(detail) // no-op if already tracked; also clears the watchlist entry
      const nowWatched = toggleMovieWatched(id)
      showToast(
        nowWatched ? `${title} watched ✓` : `${title} moved back to watch list`,
        nowWatched ? '🎬' : '↩️',
      )
      if (nowWatched) maybeCelebrateCleared(id)
    } catch (e) {
      showToast(e instanceof Error ? e.message : `Couldn't load ${title}`, '⚠️')
    } finally {
      setBusyIds((b) => b.filter((x) => x !== id))
    }
  }

  // Celebrate emptying the watch list: fired when the item just removed/checked
  // off was the last one on it. `excludeId` is the item that just left, read
  // fresh from the store so the count reflects the just-applied mutation.
  const maybeCelebrateCleared = (excludeId: number) => {
    // Count the *unfiltered* watch list minus the departing item: unwatched
    // tracked movies (a watched-off tracked movie survives but no longer counts)
    // plus watchlist-only entries, deduped by id.
    const st = useLibrary.getState()
    const remaining = new Set<number>()
    for (const m of Object.values(st.movies)) {
      if (m.watched === null && m.snapshot.id !== excludeId) remaining.add(m.snapshot.id)
    }
    for (const w of st.watchlist) {
      if (w.type === 'movie' && w.id !== excludeId) remaining.add(w.id)
    }
    if (remaining.size === 0) {
      fireConfetti({ intensity: 'micro' })
      showToast('Watch list cleared! 🎉', '🎬')
    }
  }

  const removeWatchItem = (item: WatchItem) => {
    if (item.tracked) {
      removeMovie(item.id)
      showToast(`${item.title} removed from library`, '🗑️')
    } else {
      removeFromWatchlist('movie', item.id)
      showToast(`${item.title} removed from watchlist`, '🗑️')
    }
    maybeCelebrateCleared(item.id)
  }

  // Segment label "To watch" (not "Watch list") — a nav pill and a filter
  // segment sharing one name made users compare two near-identical controls.
  const tabs: { key: Tab; label: string; count: number | null }[] = [
    { key: 'watchlist', label: 'To watch', count: watchItems.length },
    { key: 'watched', label: 'Watched', count: watchedList.length },
    { key: 'upcoming', label: 'Upcoming', count: upcoming ? upcoming.length : null },
  ]

  return (
    <div>
      <div className="movies-head">
        <div>
          {/* No marketing subtitle — the segments already say what's here. */}
          <h1 className="page-title">Movies</h1>
        </div>
      </div>

      <div className="movies-toolbar">
        <div className="movies-seg" role="tablist" aria-label="Movie views">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`movies-seg-btn${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.count !== null && <span className="movies-seg-count">{t.count}</span>}
            </button>
          ))}
        </div>
        {tab !== 'upcoming' && (
          <button
            className={`movies-filter${filterActive ? ' on' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            title="Filter & sort"
            onClick={() => setSheetOpen(true)}
          >
            Filters
            {filterCount > 0 && <span className="movies-filter-badge">{filterCount}</span>}
          </button>
        )}
      </div>

      <FiltersSheet
        open={sheetOpen}
        filters={filters}
        genres={genreOptions}
        decades={tab === 'watched' ? decadeOptions : []}
        onChange={patchFilters}
        onReset={() => setFilters(DEFAULT_FILTERS)}
        onClose={() => setSheetOpen(false)}
      />

      {tab === 'watchlist' && (
        <>
          {watchShown.length === 0 ? (
            filterActive && watchItems.length > 0 ? (
              <div className="movies-empty-mini fade-in">
                No movies match your filters — tap Filters to adjust.
              </div>
            ) : (
              <BrowseEmpty emoji="🍿" message="Add movies you want to watch" />
            )
          ) : (
            <>
              <div className="movies-statline fade-in">
                <strong>{watchShown.length}</strong> {watchShown.length === 1 ? 'movie' : 'movies'}{' '}
                to watch
              </div>
              <div className="movies-mosaic stagger">
                {watchShown.map((it) => (
                  <MosaicTile
                    key={it.id}
                    id={it.id}
                    title={it.title}
                    poster_path={it.poster_path}
                    checked={false}
                    busy={busyIds.includes(it.id)}
                    meta={tileMeta(it.runtime, it.genre)}
                    onCheck={() => {
                      if (it.tracked) checkTracked(it.id, it.title)
                      else void checkWatchlistOnly(it.id, it.title)
                    }}
                    onRemove={() => removeWatchItem(it)}
                    removeTitle={it.tracked ? 'Remove from library' : 'Remove from watchlist'}
                  />
                ))}
              </div>
            </>
          )}

          {/* Discovery follows the user's own queue and never re-offers
              titles already in the library / on the watch list. */}
          {discover === null ? (
            <DiscoverRailSkeleton />
          ) : (
            <DiscoverRail
              items={discover.filter(
                (d) => !movies[d.id] && !watchlist.some((w) => w.type === 'movie' && w.id === d.id),
              )}
              onAdd={addDiscover}
            />
          )}
        </>
      )}

      {tab === 'watched' &&
        (watchedShown.length === 0 ? (
          filterActive && watchedList.length > 0 ? (
            <div className="movies-empty-mini fade-in">
              No watched movies match your filters — tap Filters to adjust.
            </div>
          ) : (
            <BrowseEmpty emoji="🎬" message="Nothing watched yet — check off a movie once you've seen it" />
          )
        ) : (
          <>
            <div className="movies-statline fade-in">
              <strong>{watchedShown.length}</strong>{' '}
              {watchedShown.length === 1 ? 'movie' : 'movies'} ·{' '}
              <strong>{formatMinutes(watchedMinutes)}</strong> watch time
            </div>
            <div className="movies-mosaic stagger">
              {watchedShown.map((m) => (
                <MosaicTile
                  key={m.snapshot.id}
                  id={m.snapshot.id}
                  title={m.snapshot.title}
                  poster_path={m.snapshot.poster_path}
                  checked
                  emotion={emotionEmoji(m.watched?.emotion)}
                  meta={tileMeta(m.snapshot.runtime, m.snapshot.genres[0] ?? null)}
                  onCheck={() => checkTracked(m.snapshot.id, m.snapshot.title)}
                  onRemove={() => {
                    removeMovie(m.snapshot.id)
                    showToast(`${m.snapshot.title} removed from library`, '🗑️')
                  }}
                  removeTitle="Remove from library"
                />
              ))}
            </div>
          </>
        ))}

      {tab === 'upcoming' &&
        (upcomingError ? (
          <ErrorBox message={upcomingError} />
        ) : upcoming === null ? (
          <UpcomingSkeleton />
        ) : upcoming.length === 0 ? (
          <BrowseEmpty emoji="🍿" message="Add movies you want to watch" />
        ) : (
          <div className="movies-uplist stagger">
            {upcoming.map((m) => (
              <UpcomingRow key={m.id} item={m} />
            ))}
          </div>
        ))}
    </div>
  )
}
