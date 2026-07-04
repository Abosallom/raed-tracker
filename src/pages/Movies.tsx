// Movies hub — segmented tabs: Watch list / Watched / Upcoming.
// Watch list unions tracked-unwatched movies with movie watchlist entries;
// tiles are a dense poster mosaic with hover quick actions.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLibrary } from '../store/library'
import { getMovieDetail, upcomingMovies } from '../api/tmdb'
import { ErrorBox, PosterImage, formatMinutes } from '../components/shared'
import { showToast } from '../components/toast'
import { EMOTIONS } from '../types'
import type { Emotion, SearchResult } from '../types'
import './movies.css'

type Tab = 'watchlist' | 'watched' | 'upcoming'

// Cap + module-level cache so the Upcoming tab fetches at most once per session.
const UPCOMING_CAP = 20
let upcomingCache: SearchResult[] | null = null

interface WatchItem {
  id: number
  title: string
  poster_path: string | null
  /** true = in the movie library (unwatched); false = watchlist-only entry. */
  tracked: boolean
  favorite: boolean
  addedAt: string
}

function emotionEmoji(key: Emotion | undefined): string | null {
  if (!key) return null
  return EMOTIONS.find((e) => e.key === key)?.emoji ?? null
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

// ---------- mosaic tile ----------

function MosaicTile({
  id,
  title,
  poster_path,
  checked,
  busy,
  emotion,
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
  onCheck: () => void
  onRemove: () => void
  removeTitle: string
}) {
  return (
    <div className="movies-tile">
      <Link className="movies-tile-link" to={`/movie/${id}`} title={title}>
        <PosterImage path={poster_path} title={title} />
        <span className="movies-tile-overlay" aria-hidden="true">
          <span className="movies-tile-name">{title}</span>
        </span>
      </Link>
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
      {emotion && (
        <span className="movies-tile-emotion" title="Your reaction">
          {emotion}
        </span>
      )}
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
              {chip.future ? '🗓️ ' : ''}
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
        Browse movies
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

  const [tab, setTab] = useState<Tab>('watchlist')
  const [favOnly, setFavOnly] = useState(false)
  const [busyIds, setBusyIds] = useState<number[]>([])
  const [upcoming, setUpcoming] = useState<SearchResult[] | null>(upcomingCache)
  const [upcomingError, setUpcomingError] = useState<string | null>(null)

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
      })
    }
  }
  watchItems.sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  const watchShown = favOnly ? watchItems.filter((i) => i.favorite) : watchItems

  // Tab 2: watched movies, most recent first.
  const watchedList = all
    .filter((m) => m.watched !== null)
    .sort((a, b) => (b.watched?.watchedAt ?? '').localeCompare(a.watched?.watchedAt ?? ''))
  const watchedShown = favOnly ? watchedList.filter((m) => m.favorite) : watchedList
  const watchedMinutes = watchedShown.reduce((sum, m) => sum + m.snapshot.runtime, 0)

  const checkTracked = (id: number, title: string) => {
    const nowWatched = toggleMovieWatched(id)
    showToast(
      nowWatched ? `${title} watched ✓` : `${title} moved back to watch list`,
      nowWatched ? '🎬' : '↩️',
    )
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
    } catch (e) {
      showToast(e instanceof Error ? e.message : `Couldn't load ${title}`, '⚠️')
    } finally {
      setBusyIds((b) => b.filter((x) => x !== id))
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
  }

  const tabs: { key: Tab; label: string; count: number | null }[] = [
    { key: 'watchlist', label: 'Watch list', count: watchItems.length },
    { key: 'watched', label: 'Watched', count: watchedList.length },
    { key: 'upcoming', label: 'Upcoming', count: upcoming ? upcoming.length : null },
  ]

  return (
    <div>
      <h1 className="page-title">Movies</h1>
      <p className="page-subtitle">Your movie hub — what to watch, what you've seen, what's next.</p>

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
            className={`movies-filter${favOnly ? ' on' : ''}`}
            aria-pressed={favOnly}
            title="Show favorites only"
            onClick={() => setFavOnly((v) => !v)}
          >
            {favOnly ? '★' : '☆'} Favorites
          </button>
        )}
      </div>

      {tab === 'watchlist' &&
        (watchShown.length === 0 ? (
          favOnly && watchItems.length > 0 ? (
            <div className="movies-empty-mini fade-in">
              No favorites in your watch list yet — tap the ☆ on a movie page to pin one here.
            </div>
          ) : (
            <BrowseEmpty emoji="🍿" message="Add movies you want to watch" />
          )
        ) : (
          <>
            <div className="movies-statline fade-in">
              <strong>{watchShown.length}</strong> {watchShown.length === 1 ? 'movie' : 'movies'} to
              watch
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
        ))}

      {tab === 'watched' &&
        (watchedShown.length === 0 ? (
          favOnly && watchedList.length > 0 ? (
            <div className="movies-empty-mini fade-in">
              No favorites among your watched movies yet — tap the ☆ on a movie page to pin one.
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
