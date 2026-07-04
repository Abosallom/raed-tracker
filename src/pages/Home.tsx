// Discover feed — the "/" landing page.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { SearchResult, TrackedShow } from '../types'
import {
  popularShows,
  topRatedMovies,
  topRatedShows,
  trendingMovies,
  trendingShows,
} from '../api/tmdb'
import { nextEpisode, showProgress, useLibrary, watchedCount } from '../store/library'
import {
  ErrorBox,
  LoadingSpinner,
  MediaRow,
  PosterImage,
  ProgressBar,
} from '../components/shared'
import './home.css'

interface DiscoverRows {
  trendingTv: SearchResult[]
  trendingFilm: SearchResult[]
  popularTv: SearchResult[]
  topTv: SearchResult[]
  topFilm: SearchResult[]
}

function formatEpisodeCode(season: number, episode: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `S${pad(season)}E${pad(episode)}`
}

/** Most recent activity on a tracked show (last watch, falling back to when it was added). */
function lastActivity(show: TrackedShow): number {
  let latest = new Date(show.addedAt).getTime()
  for (const rec of Object.values(show.watched)) {
    const t = new Date(rec.watchedAt).getTime()
    if (t > latest) latest = t
  }
  return latest
}

function KeepWatchingCard({ show }: { show: TrackedShow }) {
  const next = nextEpisode(show)
  if (!next) return null
  const seen = watchedCount(show)
  return (
    <Link className="home-kw-card" to={`/show/${show.snapshot.id}`}>
      <div className="home-kw-poster">
        <PosterImage path={show.snapshot.poster_path} title={show.snapshot.name} />
      </div>
      <div className="home-kw-info">
        <div className="home-kw-name">{show.snapshot.name}</div>
        <div className="home-kw-next">
          <span className="home-kw-badge">{formatEpisodeCode(next.season, next.episode)}</span>
          up next
        </div>
        <ProgressBar value={showProgress(show)} />
        <div className="home-kw-count">
          {seen} / {show.snapshot.totalEpisodes} episodes watched
        </div>
      </div>
    </Link>
  )
}

export default function Home() {
  const shows = useLibrary((st) => st.shows)
  const [rows, setRows] = useState<DiscoverRows | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      trendingShows(),
      trendingMovies(),
      popularShows(),
      topRatedShows(),
      topRatedMovies(),
    ])
      .then(([trendingTv, trendingFilm, popularTv, topTv, topFilm]) => {
        if (!cancelled) setRows({ trendingTv, trendingFilm, popularTv, topTv, topFilm })
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load the discover feed.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const keepWatching = Object.values(shows)
    .filter((s) => nextEpisode(s) !== null)
    .sort((a, b) => lastActivity(b) - lastActivity(a))
    .slice(0, 6)

  return (
    <div>
      <h1 className="page-title">What are you watching tonight? 🍿</h1>
      <p className="page-subtitle">
        Pick up where you left off, or find your next obsession below.
      </p>

      {keepWatching.length > 0 && (
        <>
          <h2 className="section-title" style={{ marginTop: 0 }}>
            <span>▶️ Keep watching</span>
            <Link className="home-see-all" to="/shows">
              My shows →
            </Link>
          </h2>
          <div className="home-kw-grid">
            {keepWatching.map((s) => (
              <KeepWatchingCard key={s.snapshot.id} show={s} />
            ))}
          </div>
        </>
      )}

      {error ? (
        <ErrorBox message={error} />
      ) : !rows ? (
        <LoadingSpinner />
      ) : (
        <>
          <h2 className="section-title">🔥 Trending shows</h2>
          <MediaRow items={rows.trendingTv} />

          <h2 className="section-title">🎬 Trending movies</h2>
          <MediaRow items={rows.trendingFilm} />

          <h2 className="section-title">📺 Popular shows</h2>
          <MediaRow items={rows.popularTv} />

          <h2 className="section-title">🏆 Top rated shows</h2>
          <MediaRow items={rows.topTv} />

          <h2 className="section-title">🏅 Top rated movies</h2>
          <MediaRow items={rows.topFilm} />
        </>
      )}
    </div>
  )
}
