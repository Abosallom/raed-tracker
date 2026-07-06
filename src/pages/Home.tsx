// Home — tracker-only landing page: quick links + the Keep watching queue.
// All discovery/suggestion content (hero carousel, trending/top rows) lives
// on Explore's Discover tab instead.

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { TrackedShow } from '../types'
import { nextEpisode, showProgress, useLibrary, watchedCount } from '../store/library'
import { byRecentActivity } from '../lib/activity'
import { computeStreaks } from '../lib/streaks'
import { PosterImage, ProgressBar } from '../components/shared'
import './home.css'

function formatEpisodeCode(season: number, episode: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `S${pad(season)}E${pad(episode)}`
}

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

// ---------- keep watching ----------

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

// ---------- quick links ----------

/** Compact "jump to" cards under the greeting: Watchlist / Upcoming / Stats. */
function QuickLinks({
  watchlistCount,
  nextAirLabel,
  streak,
}: {
  watchlistCount: number
  nextAirLabel: string
  streak: number
}) {
  return (
    <div className="home-quicklinks">
      <Link className="home-quicklink" to="/watchlist">
        <span className="home-quicklink-icon" aria-hidden="true">
          🔖
        </span>
        <span className="home-quicklink-text">
          <span className="home-quicklink-title">Watchlist</span>
          <span className="home-quicklink-sub">
            {watchlistCount} {watchlistCount === 1 ? 'item' : 'items'}
          </span>
        </span>
      </Link>
      <Link className="home-quicklink" to="/upcoming">
        <span className="home-quicklink-icon" aria-hidden="true">
          🗓️
        </span>
        <span className="home-quicklink-text">
          <span className="home-quicklink-title">Upcoming</span>
          <span className="home-quicklink-sub">{nextAirLabel}</span>
        </span>
      </Link>
      <Link className="home-quicklink" to="/stats">
        <span className="home-quicklink-icon" aria-hidden="true">
          📊
        </span>
        <span className="home-quicklink-text">
          <span className="home-quicklink-title">Stats</span>
          <span className="home-quicklink-sub">
            {streak > 0 ? `🔥 ${streak}-day streak` : 'See your numbers'}
          </span>
        </span>
      </Link>
    </div>
  )
}

/** "in N days" / "Today" / "Tomorrow" for the soonest followed-show air date. */
function nextAirLabelFor(shows: Record<number, TrackedShow>): string {
  let soonest: string | null = null
  for (const s of Object.values(shows)) {
    if (s.paused) continue
    const air = s.snapshot.nextEpisodeToAir?.airDate
    if (!air) continue
    if (soonest === null || air < soonest) soonest = air
  }
  if (!soonest) return 'Nothing scheduled'
  const [y, m, d] = soonest.split('-').map(Number)
  const target = new Date(y, (m || 1) - 1, d || 1)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return 'New episode out'
  if (days === 0) return 'Airs today'
  if (days === 1) return 'Airs tomorrow'
  return `Next in ${days} days`
}

export default function Home() {
  const shows = useLibrary((st) => st.shows)
  const movies = useLibrary((st) => st.movies)
  const watchlist = useLibrary((st) => st.watchlist)
  const profile = useLibrary((st) => st.profile)

  const streak = useMemo(() => computeStreaks(shows, movies).current, [shows, movies])
  const nextAirLabel = useMemo(() => nextAirLabelFor(shows), [shows])

  const keepWatching = Object.values(shows)
    .filter((s) => !s.paused && nextEpisode(s) !== null)
    .sort(byRecentActivity)
    .slice(0, 6)

  return (
    <div>
      <h1 className="page-title">
        {greetingForHour(new Date().getHours())}, {profile.name} 🍿
      </h1>
      <p className="page-subtitle">Pick up where you left off.</p>

      <QuickLinks
        watchlistCount={watchlist.length}
        nextAirLabel={nextAirLabel}
        streak={streak}
      />

      {keepWatching.length > 0 ? (
        <>
          <h2 className="section-title">
            <span>▶️ Keep watching</span>
            <Link className="home-see-all" to="/shows">
              My shows →
            </Link>
          </h2>
          <div className="home-kw-grid stagger">
            {keepWatching.map((s) => (
              <KeepWatchingCard key={s.snapshot.id} show={s} />
            ))}
          </div>
        </>
      ) : (
        <div className="home-empty card">
          <p>Nothing on deck — everything you follow is watched or paused.</p>
          <Link className="btn primary" to="/search">
            🔍 Find something new on Explore
          </Link>
        </div>
      )}
    </div>
  )
}
