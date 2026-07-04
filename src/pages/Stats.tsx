// Stats dashboard (/stats) — pure computation over the library store.
// All charts are CSS-only (divs with widths/heights), no chart libraries.

import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { Emotion } from '../types'
import { EMOTIONS } from '../types'
import {
  showProgress,
  totalMinutesWatched,
  useLibrary,
  watchedCount,
} from '../store/library'
import { PosterImage, ProgressBar, formatMinutes } from '../components/shared'
import './stats.css'

const GENRE_COLORS = [
  '#fbbf24',
  '#a3a3a3',
  '#3b82f6',
  '#06b6d4',
  '#10b981',
  '#f97316',
  '#ef4444',
  '#ec4899',
]

const EMOTION_COLORS: Record<Emotion, string> = {
  love: '#f472b6',
  fun: '#fbbf24',
  wow: '#fb923c',
  meh: '#a5a5a5',
  sad: '#60a5fa',
  scared: '#f87171',
}

function StatCard({
  icon,
  value,
  label,
  color,
}: {
  icon: string
  value: string
  label: string
  color: string
}) {
  return (
    <div className="stats-card" style={{ '--stats-card-color': color } as CSSProperties}>
      <div className="stats-card-icon">{icon}</div>
      <div className="stats-card-value">{value}</div>
      <div className="stats-card-label">{label}</div>
    </div>
  )
}

export default function Stats() {
  const shows = useLibrary((s) => s.shows)
  const movies = useLibrary((s) => s.movies)

  const stats = useMemo(() => {
    const showList = Object.values(shows)
    const movieList = Object.values(movies)

    const episodes = showList.reduce((n, s) => n + watchedCount(s), 0)
    const moviesWatched = movieList.filter((m) => m.watched).length
    const completed = showList.filter(
      (s) => s.snapshot.totalEpisodes > 0 && showProgress(s) >= 1,
    ).length

    // -- minutes per genre across watched episodes + watched movies --
    const genreMin = new Map<string, number>()
    for (const s of showList) {
      const min = watchedCount(s) * s.snapshot.runtime
      if (min <= 0) continue
      for (const g of s.snapshot.genres) genreMin.set(g, (genreMin.get(g) ?? 0) + min)
    }
    for (const m of movieList) {
      if (!m.watched) continue
      for (const g of m.snapshot.genres)
        genreMin.set(g, (genreMin.get(g) ?? 0) + m.snapshot.runtime)
    }
    const genres = [...genreMin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)

    // -- emotion reaction counts across all watch records --
    const reactions: Record<Emotion, number> = {
      love: 0,
      fun: 0,
      wow: 0,
      meh: 0,
      sad: 0,
      scared: 0,
    }
    for (const s of showList) {
      for (const rec of Object.values(s.watched)) {
        if (rec.emotion) reactions[rec.emotion] += 1
      }
    }
    for (const m of movieList) {
      if (m.watched?.emotion) reactions[m.watched.emotion] += 1
    }

    // -- top 5 most watched shows --
    const topShows = showList
      .filter((s) => watchedCount(s) > 0)
      .sort((a, b) => watchedCount(b) - watchedCount(a))
      .slice(0, 5)

    // -- episodes watched per month, last 6 months --
    const today = new Date()
    const months: { key: string; label: string; count: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleString('en-US', { month: 'short' }),
        count: 0,
      })
    }
    const byMonth = new Map(months.map((m) => [m.key, m]))
    for (const s of showList) {
      for (const rec of Object.values(s.watched)) {
        const bucket = byMonth.get(rec.watchedAt.slice(0, 7))
        if (bucket) bucket.count += 1
      }
    }

    return {
      totalMin: totalMinutesWatched(shows, movies),
      episodes,
      moviesWatched,
      followed: showList.length,
      completed,
      genres,
      reactions,
      topShows,
      months,
      libraryEmpty: showList.length === 0 && movieList.length === 0,
    }
  }, [shows, movies])

  if (stats.libraryEmpty) {
    return (
      <div>
        <h1 className="page-title">Stats</h1>
        <p className="page-subtitle">Your watching, quantified.</p>
        <div className="empty-state">
          <div className="big">📊</div>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            Start watching to see your stats
          </p>
          <p style={{ marginTop: 6 }}>
            Follow a show or track a movie and your numbers will light up here.
          </p>
          <Link className="btn primary" to="/" style={{ marginTop: 20 }}>
            Discover something to watch
          </Link>
        </div>
      </div>
    )
  }

  const maxGenre = stats.genres.length > 0 ? stats.genres[0][1] : 1
  const totalReactions = EMOTIONS.reduce((n, e) => n + stats.reactions[e.key], 0)
  const maxReaction = Math.max(1, ...EMOTIONS.map((e) => stats.reactions[e.key]))
  const maxMonth = Math.max(1, ...stats.months.map((m) => m.count))
  const noActivity = stats.months.every((m) => m.count === 0)

  return (
    <div>
      <h1 className="page-title">Stats</h1>
      <p className="page-subtitle">Your watching, quantified.</p>

      <div className="stats-cards">
        <StatCard
          icon="⏱️"
          value={formatMinutes(stats.totalMin)}
          label="Watch time"
          color="var(--accent-hover)"
        />
        <StatCard
          icon="📺"
          value={String(stats.episodes)}
          label="Episodes watched"
          color="#60a5fa"
        />
        <StatCard
          icon="🎬"
          value={String(stats.moviesWatched)}
          label="Movies watched"
          color="#f472b6"
        />
        <StatCard
          icon="📌"
          value={String(stats.followed)}
          label="Shows followed"
          color="var(--yellow)"
        />
        <StatCard
          icon="🏁"
          value={String(stats.completed)}
          label="Shows completed"
          color="var(--green)"
        />
      </div>

      <div className="stats-grid">
        <section className="card">
          <h2 className="stats-section-h">🧬 Time by genre</h2>
          {stats.genres.length === 0 ? (
            <p className="stats-empty-note">
              Watch some episodes or movies to see where your hours go.
            </p>
          ) : (
            stats.genres.map(([name, min], i) => (
              <div className="stats-bar-row" key={name}>
                <span className="stats-bar-label" title={name}>
                  {name}
                </span>
                <div className="stats-bar-track">
                  <div
                    className="stats-bar-fill"
                    style={{
                      width: `${Math.max(3, (min / maxGenre) * 100)}%`,
                      background: GENRE_COLORS[i % GENRE_COLORS.length],
                    }}
                  />
                </div>
                <span className="stats-bar-value">{formatMinutes(min)}</span>
              </div>
            ))
          )}
        </section>

        <section className="card">
          <h2 className="stats-section-h">💜 Your reactions</h2>
          {totalReactions === 0 ? (
            <p className="stats-empty-note">
              React to episodes and movies with an emoji — your feelings get charted here.
            </p>
          ) : (
            EMOTIONS.map((e) => {
              const count = stats.reactions[e.key]
              return (
                <div className="stats-emotion-row" key={e.key}>
                  <span className="stats-emotion-emoji">{e.emoji}</span>
                  <span className="stats-bar-label left">{e.label}</span>
                  <div className="stats-bar-track">
                    <div
                      className="stats-bar-fill"
                      style={{
                        width: count > 0 ? `${Math.max(5, (count / maxReaction) * 100)}%` : '0%',
                        background: EMOTION_COLORS[e.key],
                        opacity: count > 0 ? 1 : 0.3,
                      }}
                    />
                  </div>
                  <span className="stats-bar-value">{count}</span>
                </div>
              )
            })
          )}
        </section>
      </div>

      <div className="stats-grid">
        <section className="card">
          <h2 className="stats-section-h">🏆 Most watched shows</h2>
          {stats.topShows.length === 0 ? (
            <p className="stats-empty-note">
              No episodes ticked off yet — open a show and start checking them off.
            </p>
          ) : (
            stats.topShows.map((s, i) => {
              const n = watchedCount(s)
              return (
                <Link to={`/show/${s.snapshot.id}`} className="stats-top-row" key={s.snapshot.id}>
                  <span className="stats-top-rank">{i + 1}</span>
                  <div className="stats-top-poster">
                    <PosterImage path={s.snapshot.poster_path} title={s.snapshot.name} />
                  </div>
                  <div className="stats-top-info">
                    <div className="stats-top-name">{s.snapshot.name}</div>
                    <div className="stats-top-sub">
                      {n} of {s.snapshot.totalEpisodes} episodes ·{' '}
                      {formatMinutes(n * s.snapshot.runtime)}
                    </div>
                    <ProgressBar value={showProgress(s)} />
                  </div>
                </Link>
              )
            })
          )}
        </section>

        <section className="card">
          <h2 className="stats-section-h">📅 Activity — last 6 months</h2>
          <div className="stats-activity">
            {stats.months.map((m) => (
              <div className="stats-activity-col" key={m.key}>
                <span className="stats-activity-count" style={{ opacity: m.count > 0 ? 1 : 0.35 }}>
                  {m.count}
                </span>
                <div
                  className="stats-activity-bar"
                  style={
                    m.count > 0
                      ? { height: Math.max(8, Math.round((m.count / maxMonth) * 112)) }
                      : { height: 4, background: 'var(--bg-elev-2)' }
                  }
                />
                <span className="stats-activity-month">{m.label}</span>
              </div>
            ))}
          </div>
          {noActivity && (
            <p className="stats-empty-note">
              Episodes you watch will chart here, month by month.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
