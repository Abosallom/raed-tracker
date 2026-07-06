import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Link } from 'react-router-dom'
import type {
  ActivityItem,
  Genre,
  MediaType,
  SearchResult,
  TrackedMovie,
  TrackedShow,
} from '../types'
import { EMOTIONS } from '../types'
import {
  backdropUrl,
  discoverByGenre,
  getGenres,
  getTrailerKey,
  isDemoMode,
  popularShows,
  posterUrl,
  searchMulti,
  topRatedMovies,
  topRatedShows,
  trendingMovies,
  trendingShows,
  youtubeUrl,
} from '../api/tmdb'
import { useLibrary } from '../store/library'
import { showToast } from '../components/toast'
import { ErrorBox, PosterCard, SkeletonGrid, SkeletonRow, timeAgo } from '../components/shared'
import {
  compactNumber as compactNum,
  generateActivityFeed,
  watchedByCount,
  watcherCluster,
} from '../api/social'
import type { GroupSort } from '../api/groups'
import { GROUPS, loadJoined, saveJoined, sortGroups } from '../api/groups'
import './search.css'

type Filter = 'all' | MediaType
type Tab = 'feed' | 'discover' | 'groups' | 'activity'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'tv', label: 'Shows' },
  { key: 'movie', label: 'Movies' },
]

const TABS: { key: Tab; label: string; emoji: string }[] = [
  { key: 'feed', label: 'Feed', emoji: '📡' },
  { key: 'discover', label: 'Discover', emoji: '🧭' },
  { key: 'groups', label: 'Groups', emoji: '👥' },
  { key: 'activity', label: 'Activity', emoji: '✨' },
]

// ---------- last active tab (sessionStorage, best-effort) ----------

const TAB_KEY = 'showtrackr_explore_tab'

function loadTab(): Tab {
  try {
    const t = sessionStorage.getItem(TAB_KEY)
    return t === 'feed' || t === 'discover' || t === 'groups' || t === 'activity' ? t : 'feed'
  } catch {
    return 'feed'
  }
}

function saveTab(t: Tab) {
  try {
    sessionStorage.setItem(TAB_KEY, t)
  } catch {
    /* storage is best-effort */
  }
}

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

// ---------- quick-add (shared by poster cards and feed cards) ----------

/** Watchlist quick-action state + toggle for one search result. */
function useQuickAdd(item: SearchResult) {
  const onList = useLibrary((s) =>
    s.watchlist.some((w) => w.type === item.media_type && w.id === item.id),
  )
  const tracked = useLibrary((s) =>
    item.media_type === 'tv' ? Boolean(s.shows[item.id]) : Boolean(s.movies[item.id]),
  )
  const addToWatchlist = useLibrary((s) => s.addToWatchlist)
  const removeFromWatchlist = useLibrary((s) => s.removeFromWatchlist)

  const toggle = () => {
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
  }

  return { onList, tracked, toggle }
}

/** PosterCard plus a corner quick-add button that never triggers navigation. */
function QuickAddCard({ item }: { item: SearchResult }) {
  const { onList, tracked, toggle } = useQuickAdd(item)
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
          toggle()
        }}
      >
        {done ? '✓' : '+'}
      </button>
    </div>
  )
}

// ---------- Feed tab ----------

const FEED_PAGES = 3

/** Alternate shows and movies: [tv, movie, tv, movie, …] then leftovers. */
function interleave(a: SearchResult[], b: SearchResult[]): SearchResult[] {
  const out: SearchResult[] = []
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (i < a.length) out.push(a[i])
    if (i < b.length) out.push(b[i])
  }
  return out
}

/**
 * Feed pages. Trending has no pagination in our API layer, so page 2 reuses
 * top-rated and page 3 popular shows; ids are deduped by the caller.
 */
async function fetchFeedPage(page: number): Promise<SearchResult[]> {
  const key = `feed:${page}`
  const hit = memCache.get(key)
  if (hit !== undefined) return hit as SearchResult[]
  let r: SearchResult[]
  if (page === 1) {
    const [tv, mv] = await Promise.all([trendingShows(), trendingMovies()])
    r = interleave(tv, mv)
  } else if (page === 2) {
    const [tv, mv] = await Promise.all([topRatedShows(), topRatedMovies()])
    r = interleave(tv, mv)
  } else {
    r = await popularShows()
  }
  memCache.set(key, r)
  return r
}

const compactNumber = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** Resolved trailer keys so a second click never refetches. */
const trailerKeyCache = new Map<string, string | null>()

function FeedCard({
  item,
  genreNames,
  delay,
}: {
  item: SearchResult
  genreNames: Map<number, string>
  delay: number
}) {
  const [loaded, setLoaded] = useState(false)
  const [trailerBusy, setTrailerBusy] = useState(false)
  const { onList, tracked, toggle } = useQuickAdd(item)
  const done = onList || tracked

  const url = backdropUrl(item.backdrop_path, 'w780')
  const year = (item.first_air_date ?? item.release_date ?? '').slice(0, 4)
  const genres = (item.genre_ids ?? [])
    .map((id) => genreNames.get(id))
    .filter((n): n is string => Boolean(n))
    .slice(0, 3)
  const meta = [year, ...genres].filter(Boolean).join(' · ')
  const votes = item.vote_count ?? 0

  const openTrailer = (key: string | null) => {
    if (key) window.open(youtubeUrl(key), '_blank', 'noopener')
    else showToast('No trailer found', '🎬')
  }

  const onTrailer = (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (trailerBusy) return
    const cacheKey = `${item.media_type}:${item.id}`
    if (trailerKeyCache.has(cacheKey)) {
      openTrailer(trailerKeyCache.get(cacheKey) ?? null)
      return
    }
    setTrailerBusy(true)
    getTrailerKey(item.media_type, item.id)
      .then((key) => {
        trailerKeyCache.set(cacheKey, key)
        openTrailer(key)
      })
      .finally(() => setTrailerBusy(false))
  }

  return (
    <Link
      className="feed-card"
      to={item.media_type === 'tv' ? `/show/${item.id}` : `/movie/${item.id}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {url ? (
        <img
          ref={(img) => {
            // Cached images can complete before onLoad is attached.
            if (img && img.complete && img.naturalWidth > 0) setLoaded(true)
          }}
          className="feed-backdrop"
          src={url}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          style={{ opacity: loaded ? 1 : 0 }}
        />
      ) : (
        <span className="feed-fallback-name" aria-hidden="true">
          {item.name}
        </span>
      )}
      <span className="feed-type-chip">
        {item.media_type === 'tv' ? '📺 Show' : '🎬 Movie'}
      </span>
      <div className="feed-scrim" aria-hidden="true" />
      <div className="feed-info">
        <h3 className="feed-title">{item.name}</h3>
        {meta && <p className="feed-meta">{meta}</p>}
        {item.vote_average > 0 && (
          <p className="feed-rating">
            <span className="feed-star" aria-hidden="true">
              ★
            </span>{' '}
            {item.vote_average.toFixed(1)}
            {votes > 0 && (
              <span className="feed-votes"> · {compactNumber.format(votes)} ratings</span>
            )}
          </p>
        )}
        <div className="feed-actions">
          <button
            className={`feed-action${done ? ' done' : ''}`}
            title={
              onList
                ? 'Remove from watchlist'
                : tracked
                  ? 'Already in your library'
                  : 'Add to watchlist'
            }
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              toggle()
            }}
          >
            {onList ? '✓ Watchlisted' : tracked ? '✓ In library' : '＋ Watchlist'}
          </button>
          <button
            className="feed-action feed-trailer"
            aria-busy={trailerBusy}
            disabled={trailerBusy}
            onClick={onTrailer}
          >
            {trailerBusy ? (
              <span className="feed-chip-spinner" aria-hidden="true" />
            ) : (
              <span aria-hidden="true">▶</span>
            )}{' '}
            Trailer
          </button>
        </div>
      </div>
    </Link>
  )
}

function FeedTab() {
  const [items, setItems] = useState<SearchResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  // Demo mode serves the same sample lists for every page — hide "Show more".
  const [ended, setEnded] = useState(isDemoMode())
  // First index of the most recently appended page, so only new cards stagger.
  const [batchStart, setBatchStart] = useState(0)

  // Genre id -> name lookup for the "year · genres" line (best-effort).
  const tvGenres = useCached<Genre[]>('genres:tv', () => getGenres('tv'))
  const mvGenres = useCached<Genre[]>('genres:movie', () => getGenres('movie'))
  const genreNames = useMemo(() => {
    const m = new Map<number, string>()
    for (const g of mvGenres.data ?? []) m.set(g.id, g.name)
    for (const g of tvGenres.data ?? []) m.set(g.id, g.name) // tv wins ties
    return m
  }, [tvGenres.data, mvGenres.data])

  useEffect(() => {
    let cancelled = false
    fetchFeedPage(1)
      .then((r) => {
        if (cancelled) return
        const seen = new Set<string>()
        const uniq = r.filter((i) => {
          const k = `${i.media_type}:${i.id}`
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
        setItems(uniq)
        if (uniq.length === 0) setEnded(true)
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Could not load the feed — try again.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const loadMore = () => {
    const next = page + 1
    setBusy(true)
    fetchFeedPage(next)
      .then((r) => {
        const prev = items ?? []
        const seen = new Set(prev.map((i) => `${i.media_type}:${i.id}`))
        const fresh = r.filter((i) => {
          const k = `${i.media_type}:${i.id}`
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
        setBatchStart(prev.length)
        setItems([...prev, ...fresh])
        setPage(next)
        if (fresh.length === 0 || next >= FEED_PAGES) setEnded(true)
      })
      .catch(() => {
        showToast('Could not load more — try again.', '⚠️')
      })
      .finally(() => setBusy(false))
  }

  if (error) return <ErrorBox message={error} />

  if (!items) {
    return (
      <div className="feed-list" aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="skeleton feed-skel" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <div className="big">📡</div>
        <p>The feed is quiet right now — check back soon.</p>
      </div>
    )
  }

  return (
    <div className="fade-in">
      <div className="feed-list">
        {items.map((it, i) => (
          <FeedCard
            key={`${it.media_type}:${it.id}`}
            item={it}
            genreNames={genreNames}
            delay={Math.min(Math.max(i - batchStart, 0), 5) * 70}
          />
        ))}
      </div>
      {!ended && (
        <div className="explore-load-more">
          <button className="btn" disabled={busy} onClick={loadMore}>
            {busy ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
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

function DiscoverTab({
  topGenres,
  genreType,
  onGenreType,
  selectedGenre,
  onSelectGenre,
}: {
  topGenres: string[]
  genreType: MediaType
  onGenreType: (t: MediaType) => void
  selectedGenre: Genre | null
  onSelectGenre: (g: Genre | null) => void
}) {
  const trendTv = useCached<SearchResult[]>('trending:tv', trendingShows)
  const trendMv = useCached<SearchResult[]>('trending:movie', trendingMovies)
  const topTv = useCached<SearchResult[]>('top:tv', topRatedShows)
  const topMv = useCached<SearchResult[]>('top:movie', topRatedMovies)

  // "Browse all" CTAs now just jump straight into the folded-in genre hub,
  // pre-selecting the media type so the grid below is scrolled into view.
  const jumpToGenreHub = (t: MediaType) => {
    onGenreType(t)
    onSelectGenre(null)
  }

  return (
    <div className="fade-in">
      <ExploreRow title="🔥 Trending shows" res={trendTv} />
      <ExploreRow title="🍿 Trending movies" res={trendMv} />
      <BrowseBanner type="tv" onClick={() => jumpToGenreHub('tv')} />
      <ExploreRow title="🏆 Top rated shows" res={topTv} />
      <ExploreRow title="🎖️ Top rated movies" res={topMv} />
      <BrowseBanner type="movie" onClick={() => jumpToGenreHub('movie')} />

      <ForYouSection topGenres={topGenres} />

      <section className="discover-genre-hub">
        <h2 className="section-title">🎭 Browse by genre</h2>
        <GenresTab
          type={genreType}
          onType={(t) => {
            onGenreType(t)
            onSelectGenre(null)
          }}
          selected={selectedGenre}
          onSelect={onSelectGenre}
        />
      </section>
    </div>
  )
}

// ---------- "For you" section (folded into Discover) ----------

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

/**
 * "Because you watch …" rows for the current library's top genres. Renders
 * nothing when there's no personalization signal — Discover already surfaces
 * trending titles above this section, so there's no empty-state to show.
 */
function ForYouSection({ topGenres }: { topGenres: string[] }) {
  const needGenres = topGenres.length > 0
  const tvGenres = useCached<Genre[]>(needGenres ? 'genres:tv' : null, () => getGenres('tv'))
  const mvGenres = useCached<Genre[]>(needGenres ? 'genres:movie' : null, () => getGenres('movie'))

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

  if (!needGenres || matched.length === 0) return null

  return (
    <section>
      <h2 className="section-title">✨ For you</h2>
      <p className="explore-foryou-sub">
        Based on your top genres: {matched.map((m) => m.name).join(', ')}.
      </p>
      {matched.map((m) => (
        <GenreRow key={`${m.type}:${m.id}`} type={m.type} id={m.id} name={m.name} />
      ))}
    </section>
  )
}

// ---------- Activity tab ----------

type FeedSource = {
  mediaType: MediaType
  mediaId: number
  mediaName: string
  poster_path: string | null
}

const KIND_VERB: Record<string, string> = {
  watched: 'watched',
  favorited: 'favorited',
  commented: 'commented on',
}

function emotionEmoji(key: string | undefined): string | null {
  if (!key) return null
  return EMOTIONS.find((e) => e.key === key)?.emoji ?? null
}

function ActivityCard({
  item,
  voteCount,
  delay,
}: {
  item: ActivityItem
  voteCount?: number
  delay: number
}) {
  const { user } = item
  const to = item.mediaType === 'tv' ? `/show/${item.mediaId}` : `/movie/${item.mediaId}`
  const poster = posterUrl(item.poster_path, 'w185')
  const cluster = watcherCluster(item.mediaId, 3)
  const watchers = watchedByCount(item.mediaId, voteCount)
  const reaction = emotionEmoji(item.reaction)

  const epLabel =
    item.kind === 'watched' && item.mediaType === 'tv' && item.season && item.episode
      ? `S${item.season}E${item.episode} of `
      : ''
  const verb = KIND_VERB[item.kind] ?? 'watched'

  return (
    <article className="activity-card" style={{ animationDelay: `${delay}ms` }}>
      <Link
        to={`/user/${user.id}`}
        className="activity-avatar"
        aria-label={`${user.name}'s profile`}
      >
        {user.avatar}
      </Link>
      <div className="activity-body">
        <p className="activity-line">
          <Link to={`/user/${user.id}`} className="activity-user">
            {user.name}
          </Link>{' '}
          <span className="activity-verb">{verb}</span>{' '}
          {epLabel && <span className="activity-ep">{epLabel}</span>}
          <Link to={to} className="activity-media">
            {item.mediaName}
          </Link>
          {reaction && (
            <span className="activity-reaction" aria-hidden="true">
              {' '}
              {reaction}
            </span>
          )}
        </p>
        <div className="activity-meta">
          <span className="activity-cluster" aria-hidden="true">
            {cluster.map((u, i) => (
              <span key={u.id} className="activity-cluster-avatar" style={{ zIndex: 3 - i }}>
                {u.avatar}
              </span>
            ))}
          </span>
          <span className="activity-watchers">Watched by +{compactNum(watchers)}</span>
          <span className="activity-dot" aria-hidden="true">
            ·
          </span>
          <span className="activity-time">{timeAgo(item.createdAt)}</span>
        </div>
      </div>
      <Link to={to} className="activity-poster" aria-label={item.mediaName}>
        {poster ? (
          <img src={poster} alt="" loading="lazy" />
        ) : (
          <span className="activity-poster-fallback" aria-hidden="true">
            {item.mediaType === 'tv' ? '📺' : '🎬'}
          </span>
        )}
      </Link>
    </article>
  )
}

function ActivityTab({
  shows,
  movies,
}: {
  shows: Record<number, TrackedShow>
  movies: Record<number, TrackedMovie>
}) {
  // Trending titles seed the feed when the library is thin, and also supply
  // vote counts so "Watched by +NNN" scales with a title's real popularity.
  const trendTv = useCached<SearchResult[]>('trending:tv', trendingShows)
  const trendMv = useCached<SearchResult[]>('trending:movie', trendingMovies)

  const fallback = useMemo<FeedSource[]>(() => {
    const src: FeedSource[] = []
    for (const s of [...(trendTv.data ?? []), ...(trendMv.data ?? [])]) {
      src.push({
        mediaType: s.media_type,
        mediaId: s.id,
        mediaName: s.name,
        poster_path: s.poster_path,
      })
    }
    return src
  }, [trendTv.data, trendMv.data])

  const voteCounts = useMemo(() => {
    const m = new Map<number, number>()
    for (const s of [...(trendTv.data ?? []), ...(trendMv.data ?? [])])
      if (s.vote_count != null) m.set(s.id, s.vote_count)
    return m
  }, [trendTv.data, trendMv.data])

  const feed = useMemo(
    () => generateActivityFeed(shows, movies, fallback, 24),
    [shows, movies, fallback],
  )

  const hasLibrary = Object.keys(shows).length + Object.keys(movies).length > 0

  if (feed.length === 0) {
    // Library empty AND trending not yet loaded (or unavailable).
    if (!hasLibrary && (trendTv.error || trendMv.error))
      return <ErrorBox message={trendTv.error ?? trendMv.error ?? 'Could not load activity.'} />
    return (
      <div className="feed-list" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton activity-skel" />
        ))}
      </div>
    )
  }

  return (
    <div className="fade-in">
      <div className="activity-list">
        {feed.map((it, i) => (
          <ActivityCard
            key={it.id}
            item={it}
            voteCount={voteCounts.get(it.mediaId)}
            delay={Math.min(i, 8) * 55}
          />
        ))}
      </div>
    </div>
  )
}

// ---------- Groups tab ----------

const GROUP_SORTS: { key: GroupSort; label: string }[] = [
  { key: 'popular', label: 'Popular' },
  { key: 'az', label: 'A–Z' },
  { key: 'members', label: 'Most members' },
]

function GroupsTab() {
  const [joined, setJoined] = useState<Set<string>>(loadJoined)
  const [sort, setSort] = useState<GroupSort>('popular')

  const toggleJoin = (id: string) => {
    // Side effects (toast, persistence) must stay OUT of the setState updater:
    // React may invoke updaters during render, and showToast() sets Toaster
    // state ("Cannot update a component while rendering a different one").
    const group = GROUPS.find((g) => g.id === id)
    const leaving = joined.has(id)
    const next = new Set(joined)
    if (leaving) next.delete(id)
    else next.add(id)
    setJoined(next)
    saveJoined(next)
    showToast(
      leaving ? `Left ${group?.name ?? 'group'}` : `Joined ${group?.name ?? 'group'}`,
      leaving ? '👋' : '🎉',
    )
  }

  const ordered = useMemo(() => sortGroups(GROUPS, sort, joined), [sort, joined])

  return (
    <div className="fade-in">
      <div className="search-filters groups-sort">
        <span className="groups-sort-label">Sort</span>
        {GROUP_SORTS.map((s) => (
          <button
            key={s.key}
            className={`search-chip${sort === s.key ? ' active' : ''}`}
            onClick={() => setSort(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="groups-grid stagger">
        {ordered.map((g) => {
          const isJoined = joined.has(g.id)
          return (
            <div key={g.id} className="group-card">
              <span
                className="group-tile"
                style={{
                  background: `linear-gradient(135deg, ${g.gradient[0]}, ${g.gradient[1]})`,
                }}
                aria-hidden="true"
              >
                {g.emoji}
              </span>
              <div className="group-body">
                <h3 className="group-name">{g.name}</h3>
                <p className="group-stats">
                  {compactNum(g.members)} members · {compactNum(g.discussions)} discussions
                </p>
                <p className="group-blurb">{g.blurb}</p>
              </div>
              <button
                className={`group-join${isJoined ? ' joined' : ''}`}
                aria-pressed={isJoined}
                onClick={() => toggleJoin(g.id)}
              >
                {isJoined ? '✓ Joined' : 'Join'}
              </button>
            </div>
          )
        })}
      </div>
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

  // Explore hub state — the active tab survives back-navigation via sessionStorage.
  const [tab, setTabState] = useState<Tab>(loadTab)
  const [genreType, setGenreType] = useState<MediaType>('tv')
  const [selectedGenre, setSelectedGenre] = useState<Genre | null>(null)

  const setTab = (t: Tab) => {
    setTabState(t)
    saveTab(t)
  }

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

  const q = query.trim()

  /** Remember a successful search; newer entries first, prefixes collapsed.
      Persistence stays outside the setState updater (updaters can run twice
      / during render — side effects there are a React violation). */
  const rememberSearch = (term: string) => {
    const lower = term.toLowerCase()
    // Drop exact duplicates and shorter prefixes typed on the way here
    // ("bre" → "break" keeps only "break").
    const kept = recent.filter((r) => {
      const rl = r.toLowerCase()
      return rl !== lower && !lower.startsWith(rl)
    })
    const next = [term, ...kept].slice(0, RECENT_MAX)
    setRecent(next)
    saveRecent(next)
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

          {tab === 'feed' && <FeedTab />}
          {tab === 'discover' && (
            <DiscoverTab
              topGenres={topGenres}
              genreType={genreType}
              onGenreType={setGenreType}
              selectedGenre={selectedGenre}
              onSelectGenre={setSelectedGenre}
            />
          )}
          {tab === 'groups' && <GroupsTab />}
          {tab === 'activity' && <ActivityTab shows={shows} movies={movies} />}
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
