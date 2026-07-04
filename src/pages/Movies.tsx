// Movies library page — tracked movies from the store only (no API calls).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLibrary } from '../store/library'
import { PosterImage, formatMinutes, timeAgo } from '../components/shared'
import { EMOTIONS } from '../types'
import type { TrackedMovie } from '../types'
import './movies.css'

type Tab = 'toWatch' | 'watched' | 'favorites'

const TABS: { key: Tab; label: string }[] = [
  { key: 'toWatch', label: 'To Watch' },
  { key: 'watched', label: 'Watched' },
  { key: 'favorites', label: 'Favorites' },
]

const TAB_EMPTY: Record<Tab, string> = {
  toWatch: 'Nothing left to watch — every movie in your library is marked watched. 🎉',
  watched: 'No movies watched yet. Hit “Mark watched” on a movie once you’ve seen it.',
  favorites: 'No favorites yet — tap the ☆ on any movie to pin it here.',
}

function emotionEmoji(m: TrackedMovie): string | null {
  const key = m.watched?.emotion
  if (!key) return null
  return EMOTIONS.find((e) => e.key === key)?.emoji ?? null
}

function MovieCard({ movie }: { movie: TrackedMovie }) {
  const toggleMovieWatched = useLibrary((s) => s.toggleMovieWatched)
  const toggleFavoriteMovie = useLibrary((s) => s.toggleFavoriteMovie)
  const { snapshot, watched, favorite } = movie
  const emoji = emotionEmoji(movie)

  return (
    <div className="movies-card">
      <Link className="movies-poster" to={`/movie/${snapshot.id}`}>
        <PosterImage path={snapshot.poster_path} title={snapshot.title} />
        {emoji && (
          <span className="movies-emotion" title="Your reaction">
            {emoji}
          </span>
        )}
      </Link>
      <button
        className={`movies-fav${favorite ? ' on' : ''}`}
        title={favorite ? 'Remove from favorites' : 'Add to favorites'}
        onClick={() => toggleFavoriteMovie(snapshot.id)}
      >
        {favorite ? '★' : '☆'}
      </button>
      <Link className="poster-title movies-title" to={`/movie/${snapshot.id}`} title={snapshot.title}>
        {snapshot.title}
      </Link>
      <div className="poster-sub">
        {watched ? `Watched ${timeAgo(watched.watchedAt)}` : 'Not watched yet'}
      </div>
      <div className="movies-meta">
        <span className="chip movies-runtime">{formatMinutes(snapshot.runtime)}</span>
        <button
          className={`btn small movies-toggle${watched ? ' on' : ' primary'}`}
          onClick={() => toggleMovieWatched(snapshot.id)}
          title={watched ? 'Mark as not watched' : 'Mark as watched'}
        >
          {watched ? '✓ Watched' : 'Mark watched'}
        </button>
      </div>
    </div>
  )
}

export default function Movies() {
  const movies = useLibrary((s) => s.movies)
  const [tab, setTab] = useState<Tab>('toWatch')

  const all = Object.values(movies)
  const toWatch = all
    .filter((m) => m.watched === null)
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  const watched = all
    .filter((m) => m.watched !== null)
    .sort((a, b) => (b.watched?.watchedAt ?? '').localeCompare(a.watched?.watchedAt ?? ''))
  const favorites = all.filter((m) => m.favorite).sort((a, b) => b.addedAt.localeCompare(a.addedAt))

  const lists: Record<Tab, TrackedMovie[]> = { toWatch, watched, favorites }
  const active = lists[tab]
  const watchedMinutes = watched.reduce((sum, m) => sum + m.snapshot.runtime, 0)

  return (
    <div>
      <h1 className="page-title">Movies</h1>
      <p className="page-subtitle">
        {all.length} {all.length === 1 ? 'movie' : 'movies'} · {watched.length} watched ·{' '}
        {formatMinutes(watchedMinutes)}
      </p>

      {all.length === 0 ? (
        <div className="empty-state">
          <div className="big">🎬</div>
          <p style={{ marginBottom: 16 }}>
            Your movie library is empty. Find something great to track.
          </p>
          <Link className="btn primary" to="/search">
            🔍 Search for movies
          </Link>
        </div>
      ) : (
        <>
          <div className="movies-tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`movies-tab${tab === t.key ? ' active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                <span className="movies-tab-count">{lists[t.key].length}</span>
              </button>
            ))}
          </div>

          {active.length === 0 ? (
            <div className="movies-tab-empty">{TAB_EMPTY[tab]}</div>
          ) : (
            <div className="poster-grid">
              {active.map((m) => (
                <MovieCard key={m.snapshot.id} movie={m} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
