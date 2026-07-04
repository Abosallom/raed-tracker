import { useEffect, useMemo, useRef, useState } from 'react'
import type { Genre, MediaType, SearchResult } from '../types'
import {
  discoverByGenre,
  getGenres,
  isDemoMode,
  searchMulti,
  topRatedMovies,
  topRatedShows,
  trendingMovies,
  trendingShows,
} from '../api/tmdb'
import { useLibrary } from '../store/library'
import { showToast } from '../components/toast'
import { ErrorBox, PosterCard, SkeletonGrid, SkeletonRow } from '../components/shared'
import './search.css'

type Filter = 'all' | MediaType
type Tab = 'discover' | 'foryou' | 'genres'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'tv', label: 'Shows' },
  { key: 'movie', label: 'Movies' },
]

const TABS: { key: Tab; label: string; emoji: string }[] = [
  { key: 'discover', label: 'Discover', emoji: '🧭' },
  { key: 'foryou', label: 'For you', emoji: '✨' },
  { key: 'genres', label: 'Genres', emoji: '🎭' },
]

// ---------- module-level cache (bounds real-API fetching) ----------

const memCache = new Map<string, unknown>()

/**
 * Tiny cached fetch hook. Pass `key = null` to disable fetching entirely
 * (used to lazy-load tabs). Results live in a module-level Map so switching
 * tabs never refetches.
 */
function useCached<T>(
  key: string | null,
  fetcher: () => Promise<T>,
): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({
    key: '',
    data: null,
    error: null,
  })
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    if (!key) return
    const cached = memCache.get(key)
    if (cached !== undefined) {
      setState({ key, data: cached as T, error: null })
      return
    }
    let cancelled = false
    fetcherRef.current()
      .then((r) => {
        memCache.set(key, r)
        if (!cancelled) setState({ key, data: r, error: null })
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState({
            key,
            data: null,
            error: e instanceof Error ? e.message : 'Could not load — try again.',
          })
      })
    return () => {
      cancelled = true
    }
  }, [key])

  if (!key) return { data: null, error: null }
  if (state.key !== key) {
    // Key changed this render: serve the cache synchronously to avoid flicker.
    const cached = memCache.get(key)
    return { data: cached !== undefined ? (cached as T) : null, error: null }
  }
  return { data: state.data, error: state.error }
}

async function fetchGenrePage(
  type: MediaType,
  genreId: number,
  page: number,
): Promise<SearchResult[]> {
  const key = `discover:${type}:${genreId}:${page}`
  const hit = memCache.get(key)
  if (hit !== undefined) return hit as SearchResult[]
  const r = await discoverByGenre(type, genreId, page)
  memCache.set(key, r)
  return r
}

const MAX_PAGES = 5
const ROW_CAP = 12

// ---------- genre emoji ----------

const GENRE_EMOJI: [RegExp, string][] = [
  [/sci-?fi|science/i, '🚀'],
  [/action/i, '💥'],
  [/adventure/i, '🗺️'],
  [/animation/i, '🎨'],
  [/comedy/i, '😂'],
  [/crime/i, '🕵️'],
  [/documentary/i, '🎥'],
  [/drama/i, '🎭'],
  [/family/i, '👨‍👩‍👧'],
  [/fantasy/i, '🐉'],
  [/history/i, '🏛️'],
  [/horror/i, '👻'],
  [/kids/i, '🧸'],
  [/music/i, '🎵'],
  [/mystery/i, '🔍'],
  [/news/i, '📰'],
  [/reality/i, '📸'],
  [/romance/i, '💘'],
  [/soap/i, '🧼'],
  [/talk/i, '🎙️'],
  [/thriller/i, '🔪'],
  [/war/i, '⚔️'],
  [/western/i, '🤠'],
  [/tv movie/i, '📺'],
]

function genreEmoji(name: string): string {
  for (const [re, emoji] of GENRE_EMOJI) if (re.test(name)) return emoji
  return '🍿'
}

// ---------- recent searches (localStorage, best-effort) ----------

const RECENT_KEY = 'showtrackr_recent_searches'
const RECENT_MAX = 6

function loadRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX)
      : []
  } catch {
    return []
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* storage is best-effort */
  }
}

// ---------- quick-add poster card ----------

/** PosterCard plus a corner quick-add button that never triggers navigation. */
function QuickAddCard({ item }: { item: SearchResult }) {
  const onList = useLibrary((s) =>
    s.watchlist.some((w) => w.type === item.media_type && w.id === item.id),
  )
  const tracked = useLibrary((s) =>
    item.media_type === 'tv' ? Boolean(s.shows[item.id]) : Boolean(s.movies[item.id]),
  )
  const addToWatchlist = useLibrary((s) => s.addToWatchlist)
  const removeFromWatchlist = useLibrary((s) => s.removeFromWatchlist)
  const done = onList || tracked
  const label = onList
    ? 'Remove from watchlist'
    : tracked
      ? 'Already in your library'
      : 'Add to watchlist'

  return (
    <div className="explore-card">
      <PosterCard item={item} />
      <button
        className={`explore-quick-add${done ? ' done' : ''}`}
        title={label}
        aria-label={label}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (onList) {
            removeFromWatchlist(item.media_type, item.id)
            showToast(`Removed “${item.name}” from watchlist`, '➖')
          } else if (tracked) {
            showToast(`“${item.name}” is already in your library`, '✔️')
          } else {
            addToWatchlist({
              type: item.media_type,
              id: item.id,
              name: item.name,
              poster_path: item.poster_path,
            })
            showToast(`Added “${item.name}” to watchlist`, '🔖')
          }
        }}
      >
        {done ? '✓' : '+'}
      </button>
    </div>
  )
}

// ---------- horizontal row with skeleton/error states ----------

function ExploreRow({
  title,
  res,
}: {
  title: string
  res: { data: SearchResult[] | null; error: string | null }
}) {
  return (
    <section>
      <h2 className="section-title">{title}</h2>
      {res.error ? (
        <ErrorBox message={res.error} />
      ) : !res.data ? (
        <SkeletonRow />
      ) : res.data.length === 0 ? (
        <p className="explore-row-empty">Nothing here right now.</p>
      ) : (
        <div className="media-row stagger">
          {res.data.slice(0, ROW_CAP).map((it) => (
            <QuickAddCard key={`${it.media_type}:${it.id}`} item={it} />
          ))}
        </div>
      )}
    </section>
  )
}

// ---------- Discover tab ----------

function BrowseBanner({ type, onClick }: { type: MediaType; onClick: () => void }) {
  const tv = type === 'tv'
  return (
    <button className="explore-banner" onClick={onClick}>
      <span className="explore-banner-emoji">{tv ? '📺' : '🎬'}</span>
      <span className="explore-banner-text">
        <b>Browse all {tv ? 'shows' : 'movies'}</b>
        <small>
          Every genre, from {tv ? 'comedy to sci-fi' : 'thrillers to rom-coms'} — pick a lane.
        </small>
      </span>
      <span className="explore-banner-arrow" aria-hidden="true">
        →
      </span>
    </button>
  )
}

function DiscoverTab({ onBrowse }: { onBrowse: (t: MediaType) => void }) {
  const trendTv = useCached<SearchResult[]>('trending:tv', trendingShows)
  const trendMv = useCached<SearchResult[]>('trending:movie', trendingMovies)
  const topTv = useCached<SearchResult[]>('top:tv', topRatedShows)
  const topMv = useCached<SearchResult[]>('top:movie', topRatedMovies)
  return (
    <div className="fade-in">
      <ExploreRow title="🔥 Trending shows" res={trendTv} />
      <ExploreRow title="🍿 Trending movies" res={trendMv} />
      <BrowseBanner type="tv" onClick={() => onBrowse('tv')} />
      <ExploreRow title="🏆 Top rated shows" res={topTv} />
      <ExploreRow title="🎖️ Top rated movies" res={topMv} />
      <BrowseBanner type="movie" onClick={() => onBrowse('movie')} />
    </div>
  )
}

// ---------- For you tab ----------

interface MatchedGenre {
  name: string
  type: MediaType
  id: number
}

function GenreRow({ type, id, name }: MatchedGenre) {
  const res = useCached<SearchResult[]>(`discover:${type}:${id}:1`, () =>
    fetchGenrePage(type, id, 1),
  )
  return <ExploreRow title={`Because you watch ${name}`} res={res} />
}

function ForYouTab({ topGenres }: { topGenres: string[] }) {
  const needGenres = topGenres.length > 0
  const tvGenres = useCached<Genre[]>(needGenres ? 'genres:tv' : null, () => getGenres('tv'))
  const mvGenres = useCached<Genre[]>(needGenres ? 'genres:movie' : null, () => getGenres('movie'))
  const listsLoaded = tvGenres.data != null && mvGenres.data != null

  // Map genre names from library snapshots to TMDB ids (tv list first, then movie).
  const matched = useMemo<MatchedGenre[]>(() => {
    if (!tvGenres.data || !mvGenres.data) return []
    const out: MatchedGenre[] = []
    for (const name of topGenres) {
      const lower = name.toLowerCase()
      const tv = tvGenres.data.find((g) => g.name.toLowerCase() === lower)
      if (tv) {
        out.push({ name, type: 'tv', id: tv.id })
        continue
      }
      const mv = mvGenres.data.find((g) => g.name.toLowerCase() === lower)
      if (mv) out.push({ name, type: 'movie', id: mv.id })
      // unmatched genre names are skipped
    }
    return out
  }, [tvGenres.data, mvGenres.data, topGenres])

  const needFallback = !needGenres || (listsLoaded && matched.length === 0)
  const trendTv = useCached<SearchResult[]>(needFallback ? 'trending:tv' : null, trendingShows)
  const trendMv = useCached<SearchResult[]>(needFallback ? 'trending:movie' : null, trendingMovies)

  if (needFallback) {
    return (
      <div className="fade-in">
        <div className="explore-foryou-empty">
          <span className="explore-foryou-emoji">✨</span>
          <div>
            <b>Nothing personal yet</b>
            <p>
              Track a few shows or movies and this tab fills with rows tailored to your taste.
              Meanwhile, here’s what everyone’s watching.
            </p>
          </div>
        </div>
        <ExploreRow title="🔥 Trending shows" res={trendTv} />
        <ExploreRow title="🍿 Trending movies" res={trendMv} />
      </div>
    )
  }

  if (!listsLoaded) {
    return (
      <div aria-hidden="true">
        <SkeletonRow />
        <SkeletonRow />
      </div>
    )
  }

  return (
    <div className="fade-in">
      <p className="explore-foryou-sub">
        Based on your top genres: {matched.map((m) => m.name).join(', ')}.
      </p>
      {matched.map((m) => (
        <GenreRow key={`${m.type}:${m.id}`} type={m.type} id={m.id} name={m.name} />
      ))}
    </div>
  )
}

// ---------- Genres tab ----------

function GenreBrowse({
  type,
  genre,
  onBack,
}: {
  type: MediaType
  genre: Genre
  onBack: () => void
}) {
  const [items, setItems] = useState<SearchResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  // Demo mode serves the same sample list for every page — hide "load more".
  const [ended, setEnded] = useState(isDemoMode())

  useEffect(() => {
    let cancelled = false
    setItems(null)
    setError(null)
    setPage(1)
    setEnded(isDemoMode())
    fetchGenrePage(type, genre.id, 1)
      .then((r) => {
        if (cancelled) return
        setItems(r)
        if (r.length === 0) setEnded(true)
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Could not load this genre — try again.')
      })
    return () => {
      cancelled = true
    }
  }, [type, genre.id])

  const loadMore = () => {
    const next = page + 1
    setBusy(true)
    fetchGenrePage(type, genre.id, next)
      .then((r) => {
        const prev = items ?? []
        const seen = new Set(prev.map((i) => `${i.media_type}:${i.id}`))
        const fresh = r.filter((i) => !seen.has(`${i.media_type}:${i.id}`))
        setItems([...prev, ...fresh])
        setPage(next)
        if (fresh.length === 0 || next >= MAX_PAGES) setEnded(true)
      })
      .catch(() => {
        showToast('Could not load more — try again.', '⚠️')
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className="fade-in">
      <div className="explore-browse-head">
        <button className="search-chip" onClick={onBack}>
          ← All genres
        </button>
        <h2 className="explore-browse-title">
          {genreEmoji(genre.name)} {genre.name}{' '}
          <span>{type === 'tv' ? 'shows' : 'movies'}</span>
        </h2>
      </div>
      {error ? (
        <ErrorBox message={error} />
      ) : !items ? (
        <SkeletonGrid />
      ) : items.length === 0 ? (
        <div className="empty-state">
          <div className="big">🫥</div>
          <p>Nothing found in this genre.</p>
        </div>
      ) : (
        <>
          <div className="poster-grid stagger">
            {items.map((it) => (
              <QuickAddCard key={`${it.media_type}:${it.id}`} item={it} />
            ))}
          </div>
          {!ended && (
            <div className="explore-load-more">
              <button className="btn" disabled={busy} onClick={loadMore}>
                {busy ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function GenresTab({
  type,
  onType,
  selected,
  onSelect,
}: {
  type: MediaType
  onType: (t: MediaType) => void
  selected: Genre | null
  onSelect: (g: Genre | null) => void
}) {
  const genres = useCached<Genre[]>(`genres:${type}`, () => getGenres(type))
  return (
    <div className="fade-in">
      <div className="search-filters">
        <button
          className={`search-chip${type === 'tv' ? ' active' : ''}`}
          onClick={() => onType('tv')}
        >
          📺 Shows
        </button>
        <button
          className={`search-chip${type === 'movie' ? ' active' : ''}`}
          onClick={() => onType('movie')}
        >
          🎬 Movies
        </button>
      </div>
      {selected ? (
        <GenreBrowse type={type} genre={selected} onBack={() => onSelect(null)} />
      ) : genres.error ? (
        <ErrorBox message={genres.error} />
      ) : !genres.data ? (
        <div className="explore-genre-grid" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton explore-genre-skel" />
          ))}
        </div>
      ) : (
        <div className="explore-genre-grid stagger">
          {genres.data.map((g) => (
            <button key={g.id} className="explore-genre-card" onClick={() => onSelect(g)}>
              <span className="explore-genre-emoji">{genreEmoji(g.name)}</span>
              <span className="explore-genre-name">{g.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- page ----------

export default function Search() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const inputRef = useRef<HTMLInputElement>(null)

  // Explore hub state
  const [tab, setTab] = useState<Tab>('discover')
  const [genreType, setGenreType] = useState<MediaType>('tv')
  const [selectedGenre, setSelectedGenre] = useState<Genre | null>(null)

  const shows = useLibrary((s) => s.shows)
  const movies = useLibrary((s) => s.movies)

  /** Top 3 genres by frequency across library snapshots (shows + movies). */
  const topGenres = useMemo(() => {
    const freq = new Map<string, number>()
    for (const t of Object.values(shows))
      for (const g of t.snapshot.genres) freq.set(g, (freq.get(g) ?? 0) + 1)
    for (const m of Object.values(movies))
      for (const g of m.snapshot.genres) freq.set(g, (freq.get(g) ?? 0) + 1)
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name)
  }, [shows, movies])

  const goBrowse = (t: MediaType) => {
    setGenreType(t)
    setSelectedGenre(null)
    setTab('genres')
  }

  const q = query.trim()

  /** Remember a successful search; newer entries first, prefixes collapsed. */
  const rememberSearch = (term: string) => {
    setRecent((prev) => {
      const lower = term.toLowerCase()
      // Drop exact duplicates and shorter prefixes typed on the way here
      // ("bre" → "break" keeps only "break").
      const kept = prev.filter((r) => {
        const rl = r.toLowerCase()
        return rl !== lower && !lower.startsWith(rl)
      })
      const next = [term, ...kept].slice(0, RECENT_MAX)
      saveRecent(next)
      return next
    })
  }

  const clearRecent = () => {
    setRecent([])
    saveRecent([])
  }

  // Debounced search (300ms)
  useEffect(() => {
    if (!q) {
      setResults([])
      setSearching(false)
      setError(null)
      return
    }
    setSearching(true)
    setError(null)
    let cancelled = false
    const timer = setTimeout(() => {
      searchMulti(q)
        .then((r) => {
          if (cancelled) return
          setResults(r)
          setSearching(false)
          if (r.length > 0) rememberSearch(q)
        })
        .catch((e: unknown) => {
          if (cancelled) return
          setError(e instanceof Error ? e.message : 'Search failed — try again.')
          setSearching(false)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [q])

  const showCount = results.filter((r) => r.media_type === 'tv').length
  const movieCount = results.length - showCount
  const countFor = (f: Filter) =>
    f === 'all' ? results.length : f === 'tv' ? showCount : movieCount
  const filtered =
    filter === 'all' ? results : results.filter((r) => r.media_type === filter)

  return (
    <div>
      <h1 className="page-title">Explore</h1>
      <p className="page-subtitle">Search, discover, and find your next binge.</p>

      <div className="search-box">
        <span className="search-icon">🔍</span>
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search shows and movies…"
          autoFocus
          spellCheck={false}
        />
        {query && (
          <button
            className="search-clear"
            title="Clear search"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
          >
            ✕
          </button>
        )}
      </div>

      {!q ? (
        <>
          {isDemoMode() && (
            <p className="search-hint">
              Demo mode — try searching “ashfall” or “starlight”.
            </p>
          )}
          {recent.length > 0 && (
            <div className="search-recent fade-in">
              <span className="search-recent-label">Recent</span>
              {recent.map((r) => (
                <button
                  key={r}
                  className="search-chip"
                  title={`Search “${r}” again`}
                  onClick={() => {
                    setQuery(r)
                    inputRef.current?.focus()
                  }}
                >
                  {r}
                </button>
              ))}
              <button
                className="search-recent-clear"
                title="Clear recent searches"
                onClick={clearRecent}
              >
                Clear
              </button>
            </div>
          )}

          <div className="explore-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={`explore-tab${tab === t.key ? ' active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                <span aria-hidden="true">{t.emoji}</span> {t.label}
              </button>
            ))}
          </div>

          {tab === 'discover' && <DiscoverTab onBrowse={goBrowse} />}
          {tab === 'foryou' && <ForYouTab topGenres={topGenres} />}
          {tab === 'genres' && (
            <GenresTab
              type={genreType}
              onType={(t) => {
                setGenreType(t)
                setSelectedGenre(null)
              }}
              selected={selectedGenre}
              onSelect={setSelectedGenre}
            />
          )}
        </>
      ) : searching ? (
        <SkeletonGrid />
      ) : error ? (
        <ErrorBox message={error} />
      ) : results.length === 0 ? (
        <div className="empty-state">
          <div className="big">🕵️</div>
          <p>
            No results for <b>“{q}”</b>.
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 6 }}>
            Check the spelling or try a shorter search.
          </p>
        </div>
      ) : (
        <>
          <div className="search-filters">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`search-chip${filter === f.key ? ' active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="search-chip-count">{countFor(f.key)}</span>
              </button>
            ))}
            <span className="search-count fade-in" key={`${filter}|${q}`}>
              <b>{filtered.length}</b> result{filtered.length === 1 ? '' : 's'} for
              “{q}”
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state">
              <div className="big">
                {filter === 'tv' ? '📺' : '🎬'}
              </div>
              <p>
                No {filter === 'tv' ? 'shows' : 'movies'} match “{q}” — try
                another filter.
              </p>
            </div>
          ) : (
            <div className="poster-grid stagger">
              {filtered.map((it) => (
                <PosterCard key={`${it.media_type}:${it.id}`} item={it} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
