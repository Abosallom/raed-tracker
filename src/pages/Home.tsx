// Discover feed — the "/" landing page.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { SearchResult, TrackedShow } from '../types'
import {
  backdropUrl,
  popularShows,
  topRatedMovies,
  topRatedShows,
  trendingMovies,
  trendingShows,
} from '../api/tmdb'
import { nextEpisode, showProgress, useLibrary, watchedCount } from '../store/library'
import { computeStreaks } from '../lib/streaks'
import {
  ErrorBox,
  MediaRow,
  PosterImage,
  ProgressBar,
  SkeletonRow,
} from '../components/shared'
import { showToast } from '../components/toast'
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

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
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

// ---------- hero carousel ----------

/** Rich fallback gradients for demo mode, where backdrop paths are null. */
const HERO_GRADIENTS = [
  'radial-gradient(90% 130% at 85% -10%, rgba(251, 191, 36, 0.16), transparent 55%), linear-gradient(115deg, #3b2f1a 0%, #241d10 55%, #171717 100%)',
  'radial-gradient(90% 130% at 85% -10%, rgba(96, 165, 250, 0.14), transparent 55%), linear-gradient(115deg, #1c2c3d 0%, #141d28 55%, #171717 100%)',
  'radial-gradient(90% 130% at 85% -10%, rgba(192, 132, 252, 0.14), transparent 55%), linear-gradient(115deg, #2e1f3a 0%, #1e1526 55%, #171717 100%)',
  'radial-gradient(90% 130% at 85% -10%, rgba(52, 211, 153, 0.14), transparent 55%), linear-gradient(115deg, #16332a 0%, #10221c 55%, #171717 100%)',
  'radial-gradient(90% 130% at 85% -10%, rgba(248, 113, 113, 0.14), transparent 55%), linear-gradient(115deg, #3a211c 0%, #241512 55%, #171717 100%)',
]

const HERO_INTERVAL_MS = 6000

function HeroCarousel({ items }: { items: SearchResult[] }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const watchlist = useLibrary((st) => st.watchlist)
  const addToWatchlist = useLibrary((st) => st.addToWatchlist)

  // Auto-advance; the timer restarts whenever the slide changes (incl. dot clicks).
  useEffect(() => {
    if (paused || items.length < 2) return
    const timer = window.setTimeout(
      () => setIndex((i) => (i + 1) % items.length),
      HERO_INTERVAL_MS,
    )
    return () => window.clearTimeout(timer)
  }, [index, paused, items.length])

  if (items.length === 0) return null

  const addItem = (item: SearchResult) => {
    addToWatchlist({
      type: 'tv',
      id: item.id,
      name: item.name,
      poster_path: item.poster_path,
    })
    showToast(`${item.name} added to watchlist`, '🔖')
  }

  return (
    <section
      className="home-hero fade-in"
      aria-roledescription="carousel"
      aria-label="Trending this week"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {items.map((item, i) => {
        const active = i === index
        const backdrop = backdropUrl(item.backdrop_path, 'w1280')
        const year = (item.first_air_date ?? item.release_date ?? '').slice(0, 4)
        const onList = watchlist.some((w) => w.type === 'tv' && w.id === item.id)
        return (
          <article
            key={item.id}
            className={`home-hero-slide${active ? ' active' : ''}`}
            aria-hidden={!active}
          >
            {backdrop ? (
              <img className="home-hero-backdrop" src={backdrop} alt="" />
            ) : (
              <div
                className="home-hero-backdrop home-hero-fallback"
                style={{ background: HERO_GRADIENTS[i % HERO_GRADIENTS.length] }}
              />
            )}
            <div className="home-hero-scrim" />
            <div className="home-hero-content">
              <h2 className="home-hero-title">{item.name}</h2>
              <div className="home-hero-meta">
                {year && <span className="home-hero-chip">{year}</span>}
                {item.vote_average > 0 && (
                  <span className="home-hero-chip home-hero-rating">
                    ★ {item.vote_average.toFixed(1)}
                  </span>
                )}
              </div>
              {item.overview && <p className="home-hero-overview">{item.overview}</p>}
              <div className="home-hero-actions">
                <Link
                  className="btn primary"
                  to={`/show/${item.id}`}
                  tabIndex={active ? 0 : -1}
                >
                  View show
                </Link>
                <button
                  className="btn"
                  onClick={() => addItem(item)}
                  disabled={onList}
                  tabIndex={active ? 0 : -1}
                >
                  {onList ? '✓ On watchlist' : '＋ Watchlist'}
                </button>
              </div>
            </div>
          </article>
        )
      })}
      <div className="home-hero-dots">
        {items.map((item, i) => (
          <button
            key={item.id}
            className={`home-hero-dot${i === index ? ' active' : ''}`}
            aria-label={`Go to ${item.name}`}
            aria-current={i === index}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </section>
  )
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

// ---------- discover sections ----------

const SECTION_TITLES = [
  '🔥 Trending shows',
  '🎬 Trending movies',
  '📺 Popular shows',
  '🏆 Top rated shows',
  '🏅 Top rated movies',
] as const

function DiscoverSection({ title, items }: { title: string; items: SearchResult[] }) {
  return (
    <>
      <h2 className="section-title">{title}</h2>
      <div className="home-row-stagger">
        <MediaRow items={items} />
      </div>
    </>
  )
}

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
  const [rows, setRows] = useState<DiscoverRows | null>(null)
  const [error, setError] = useState<string | null>(null)

  const streak = useMemo(() => computeStreaks(shows, movies).current, [shows, movies])
  const nextAirLabel = useMemo(() => nextAirLabelFor(shows), [shows])

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
    .filter((s) => !s.paused && nextEpisode(s) !== null)
    .sort((a, b) => lastActivity(b) - lastActivity(a))
    .slice(0, 6)

  // Top 5 trending shows, favoring ones with a backdrop image (stable sort keeps
  // the trending order otherwise; in demo mode every backdrop is null).
  const heroItems = rows
    ? [...rows.trendingTv]
        .sort((a, b) => Number(Boolean(b.backdrop_path)) - Number(Boolean(a.backdrop_path)))
        .slice(0, 5)
    : []

  return (
    <div>
      <h1 className="page-title">
        {greetingForHour(new Date().getHours())}, {profile.name} 🍿
      </h1>
      <p className="page-subtitle">
        Pick up where you left off, or find your next obsession below.
      </p>

      <QuickLinks
        watchlistCount={watchlist.length}
        nextAirLabel={nextAirLabel}
        streak={streak}
      />

      {!error &&
        (rows ? (
          <HeroCarousel items={heroItems} />
        ) : (
          <div className="home-hero skeleton" aria-hidden="true" />
        ))}

      {keepWatching.length > 0 && (
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
      )}

      {error ? (
        <ErrorBox message={error} />
      ) : !rows ? (
        <>
          {SECTION_TITLES.map((title) => (
            <div key={title}>
              <h2 className="section-title">{title}</h2>
              <SkeletonRow />
            </div>
          ))}
        </>
      ) : (
        <>
          <DiscoverSection title={SECTION_TITLES[0]} items={rows.trendingTv} />
          <DiscoverSection title={SECTION_TITLES[1]} items={rows.trendingFilm} />
          <DiscoverSection title={SECTION_TITLES[2]} items={rows.popularTv} />
          <DiscoverSection title={SECTION_TITLES[3]} items={rows.topTv} />
          <DiscoverSection title={SECTION_TITLES[4]} items={rows.topFilm} />
        </>
      )}
    </div>
  )
}
