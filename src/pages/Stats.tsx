// Stats dashboard (/stats) — deep, tabbed dashboard computed purely from the
// library store. All charts are CSS bars (divs), no chart libraries.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Emotion } from '../types'
import { EMOTIONS } from '../types'
import { useLibrary } from '../store/library'
import type { Badge, MovieStats, ShowStats, WeekBucket } from '../lib/stats'
import {
  computeBadges,
  computeMovieStats,
  computeShowStats,
  fmtDate,
  fmtDayKey,
  splitDuration,
} from '../lib/stats'
import type { StreakInfo } from '../lib/streaks'
import { computeStreaks, localDayKey, watchDaySet } from '../lib/streaks'
import { BackBar } from '../components/BackBar'
import './stats.css'

const BAR_COLORS = [
  '#fbbf24',
  '#60a5fa',
  '#34d399',
  '#f472b6',
  '#fb923c',
  '#a78bfa',
  '#06b6d4',
  '#f87171',
]

const EMOTION_COLORS: Record<Emotion, string> = {
  love: '#f472b6',
  fun: '#fbbf24',
  wow: '#fb923c',
  meh: '#a5a5a5',
  sad: '#60a5fa',
  scared: '#f87171',
}

// ---------- small building blocks ----------

function num(n: number): string {
  return n.toLocaleString('en-US')
}

/** Hero card: N MONTHS N DAYS N HOURS. */
function DurationHero({
  icon,
  title,
  minutes,
  emptyNote,
}: {
  icon: string
  title: string
  minutes: number
  emptyNote: string
}) {
  const d = splitDuration(minutes)
  return (
    <section className="card stats-hero">
      <h2 className="stats-section-h">
        {icon} {title}
      </h2>
      {minutes <= 0 ? (
        <p className="stats-empty-note">{emptyNote}</p>
      ) : (
        <div className="stats-duration">
          <div className="stats-duration-unit">
            <span className="stats-duration-n">{num(d.months)}</span>
            <span className="stats-duration-l">{d.months === 1 ? 'month' : 'months'}</span>
          </div>
          <div className="stats-duration-unit">
            <span className="stats-duration-n">{num(d.days)}</span>
            <span className="stats-duration-l">{d.days === 1 ? 'day' : 'days'}</span>
          </div>
          <div className="stats-duration-unit">
            <span className="stats-duration-n">{num(d.hours)}</span>
            <span className="stats-duration-l">{d.hours === 1 ? 'hour' : 'hours'}</span>
          </div>
        </div>
      )}
    </section>
  )
}

/** Hero card: big count + subtitle. */
function CountHero({
  icon,
  title,
  value,
  sub,
}: {
  icon: string
  title: string
  value: string
  sub: string
}) {
  return (
    <section className="card stats-hero">
      <h2 className="stats-section-h">
        {icon} {title}
      </h2>
      <div className="stats-hero-value">{value}</div>
      <div className="stats-hero-sub">{sub}</div>
    </section>
  )
}

/** Small stat card used in the catch-up rows. */
function MiniStat({
  icon,
  value,
  label,
  sub,
}: {
  icon: string
  value: string
  label: string
  sub?: string
}) {
  return (
    <div className="stats-mini card">
      <div className="stats-mini-icon">{icon}</div>
      <div className="stats-mini-value">{value}</div>
      <div className="stats-mini-label">{label}</div>
      {sub && <div className="stats-mini-sub">{sub}</div>}
    </div>
  )
}

/** "🔥 Streak" card: current-streak count, longest, and a 14-day dot strip. */
function StreakCard({ streaks, activeDays }: { streaks: StreakInfo; activeDays: Set<string> }) {
  const now = new Date()
  const strip: { key: string; active: boolean; today: boolean }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const key = localDayKey(d)
    strip.push({ key, active: activeDays.has(key), today: i === 0 })
  }
  return (
    <section className="card stats-hero" style={{ marginBottom: 18 }}>
      <h2 className="stats-section-h">🔥 Streak</h2>
      {streaks.lastActiveDay === null ? (
        <p className="stats-empty-note">Watch something to start a streak.</p>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
          <div>
            <div className="stats-hero-value" style={{ color: 'var(--accent)' }}>
              {num(streaks.current)} {streaks.current === 1 ? 'day' : 'days'}
            </div>
            <div className="stats-hero-sub">Longest: {num(streaks.longest)}</div>
          </div>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 2px' }}
            aria-label="Watch activity, last 14 days"
          >
            {strip.map((d) => (
              <span
                key={d.key}
                title={`${fmtDayKey(d.key)}${d.today ? ' (today)' : ''}${d.active ? ' — watched' : ''}`}
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: '50%',
                  boxSizing: 'border-box',
                  background: d.active ? 'var(--accent)' : 'var(--bg-elev-2)',
                  border: `1px solid ${d.active ? 'var(--accent)' : 'var(--border)'}`,
                  outline: d.today ? '2px solid var(--accent)' : 'none',
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/** Vertical per-week bar chart (last 12 ISO weeks, current in accent). */
function WeekChart({ weeks, emptyNote }: { weeks: WeekBucket[]; emptyNote: string }) {
  const max = Math.max(1, ...weeks.map((w) => w.count))
  const empty = weeks.every((w) => w.count === 0)
  return (
    <>
      <div className="stats-weeks">
        {weeks.map((w, i) => (
          <div className="stats-weeks-col" key={w.key}>
            <span className="stats-weeks-count" style={{ opacity: w.count > 0 ? 1 : 0.3 }}>
              {w.count}
            </span>
            <div
              className={`stats-weeks-bar${w.current ? ' current' : ''}`}
              style={
                w.count > 0
                  ? { height: Math.max(8, Math.round((w.count / max) * 96)) }
                  : { height: 4 }
              }
            />
            <span className="stats-weeks-label">
              {w.current ? 'now' : i % 2 === 0 ? w.label : ' '}
            </span>
          </div>
        ))}
      </div>
      {empty && <p className="stats-empty-note">{emptyNote}</p>}
    </>
  )
}

/** Horizontal bar table for [name, count] rows. */
function BarTable({
  rows,
  unit,
  emptyNote,
}: {
  rows: [string, number][]
  unit: (n: number) => string
  emptyNote: string
}) {
  if (rows.length === 0) return <p className="stats-empty-note">{emptyNote}</p>
  const max = rows[0][1] || 1
  return (
    <>
      {rows.map(([name, count], i) => (
        <div className="stats-bar-row" key={name}>
          <span className="stats-bar-label" title={name}>
            {name}
          </span>
          <div className="stats-bar-track">
            <div
              className="stats-bar-fill"
              style={{
                width: `${Math.max(3, (count / max) * 100)}%`,
                background: BAR_COLORS[i % BAR_COLORS.length],
              }}
            />
          </div>
          <span className="stats-bar-value">{unit(count)}</span>
        </div>
      ))}
    </>
  )
}

function ReactionBars({
  reactions,
  total,
  emptyNote,
}: {
  reactions: Record<Emotion, number>
  total: number
  emptyNote: string
}) {
  if (total === 0) return <p className="stats-empty-note">{emptyNote}</p>
  const max = Math.max(1, ...EMOTIONS.map((e) => reactions[e.key]))
  return (
    <>
      {EMOTIONS.map((e) => {
        const count = reactions[e.key]
        return (
          <div className="stats-emotion-row" key={e.key}>
            <span className="stats-emotion-emoji">{e.emoji}</span>
            <span className="stats-bar-label left">{e.label}</span>
            <div className="stats-bar-track">
              <div
                className="stats-bar-fill"
                style={{
                  width: count > 0 ? `${Math.max(5, (count / max) * 100)}%` : '0%',
                  background: EMOTION_COLORS[e.key],
                  opacity: count > 0 ? 1 : 0.3,
                }}
              />
            </div>
            <span className="stats-bar-value">{count}</span>
          </div>
        )
      })}
    </>
  )
}

function BadgeSection({ badges }: { badges: Badge[] }) {
  const earned = badges.filter((b) => b.earned).length
  return (
    <section className="card stats-badges-card">
      <h2 className="stats-section-h">
        🎖️ Badges
        <span className="stats-badges-headline">
          {earned} of {badges.length} earned
        </span>
      </h2>
      <div className="stats-badge-grid">
        {badges.map((b) => (
          <div
            className={`stats-badge${b.earned ? ' earned' : ' locked'}`}
            key={b.key}
            title={`${b.desc} — ${b.progress}`}
          >
            <div className="stats-badge-hex">
              <span>{b.emoji}</span>
            </div>
            <div className="stats-badge-name">{b.name}</div>
            <div className="stats-badge-progress">{b.earned ? 'Earned' : b.progress}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---------- shows tab ----------

function ShowsTab({
  stats,
  streaks,
  activeDays,
}: {
  stats: ShowStats
  streaks: StreakInfo
  activeDays: Set<string>
}) {
  return (
    <div className="fade-in">
      <div className="stats-hero-row">
        <DurationHero
          icon="⏱️"
          title="TV time"
          minutes={stats.totalMinutes}
          emptyNote="Check off an episode and your TV clock starts ticking."
        />
        <CountHero
          icon="📺"
          title="Episodes watched"
          value={num(stats.episodes)}
          sub={
            stats.episodes === 0
              ? 'None yet — your next binge starts here.'
              : `${num(stats.episodesLast7)} in the last 7 days`
          }
        />
      </div>

      <StreakCard streaks={streaks} activeDays={activeDays} />

      <div className="stats-grid">
        <section className="card">
          <h2 className="stats-section-h">📅 Episodes per week</h2>
          <WeekChart
            weeks={stats.weeks}
            emptyNote="Episodes you watch will chart here, week by week."
          />
        </section>

        <section className="card">
          <h2 className="stats-section-h">🔥 Biggest marathons</h2>
          {stats.marathons.length === 0 ? (
            <p className="stats-empty-note">
              Watch 2+ episodes in a single day and your marathons show up here.
            </p>
          ) : (
            <table className="stats-table">
              <tbody>
                {stats.marathons.map((m, i) => (
                  <tr key={m.id}>
                    <td className="stats-table-rank">{i + 1}</td>
                    <td className="stats-table-name">
                      <Link to={`/show/${m.id}`}>{m.name}</Link>
                    </td>
                    <td className="stats-table-num">{m.episodes} eps</td>
                    <td className="stats-table-dim">{fmtDayKey(m.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <div className="stats-grid">
        <section className="card">
          <h2 className="stats-section-h">🧬 Top genres</h2>
          <BarTable
            rows={stats.genres}
            unit={(n) => `${num(n)} eps`}
            emptyNote="Watch some episodes to see which genres own your evenings."
          />
        </section>

        <section className="card">
          <h2 className="stats-section-h">📡 Top networks</h2>
          <BarTable
            rows={stats.networks}
            unit={(n) => `${n} ${n === 1 ? 'show' : 'shows'}`}
            emptyNote="Follow shows and their networks stack up here."
          />
        </section>
      </div>

      <div className="stats-grid">
        <section className="card">
          <h2 className="stats-section-h">💜 Your reactions</h2>
          <ReactionBars
            reactions={stats.reactions}
            total={stats.totalReactions}
            emptyNote="React to episodes with an emoji — your feelings get charted here."
          />
        </section>

        <section className="card">
          <h2 className="stats-section-h">🎭 Favorite characters</h2>
          {stats.characterVotes === 0 ? (
            <p className="stats-empty-note">
              Vote “who was your favorite?” on watched episodes to crown your characters.
            </p>
          ) : (
            <>
              <BarTable
                rows={stats.characters.map((c) => [c.name, c.votes])}
                unit={(n) => `${n} ${n === 1 ? 'vote' : 'votes'}`}
                emptyNote=""
              />
              {stats.showTopCharacters.length > 0 && (
                <>
                  <div className="stats-subhead">Most voted per show</div>
                  <table className="stats-table">
                    <tbody>
                      {stats.showTopCharacters.map((r) => (
                        <tr key={r.showId}>
                          <td className="stats-table-name">
                            <Link to={`/show/${r.showId}`}>{r.showName}</Link>
                          </td>
                          <td className="stats-table-dim">{r.character}</td>
                          <td className="stats-table-num">
                            {r.votes} {r.votes === 1 ? 'vote' : 'votes'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </section>
      </div>

      <div className="stats-mini-row">
        <MiniStat
          icon="📌"
          value={num(stats.addedShows)}
          label="Added shows"
          sub={`${num(stats.inProduction)} still in production`}
        />
        <MiniStat
          icon="🧮"
          value={num(stats.remainingEpisodes)}
          label="Remaining episodes"
          sub={
            stats.startedShows === 0
              ? 'no started shows yet'
              : `on ${num(stats.startedShows)} started ${stats.startedShows === 1 ? 'show' : 'shows'}`
          }
        />
        <MiniStat
          icon="⏳"
          value={num(Math.round(stats.remainingMinutes / 60))}
          label="Hours to watch"
          sub="to clear your backlog"
        />
        <MiniStat
          icon="🔮"
          value={
            stats.remainingEpisodes === 0 && stats.startedShows > 0
              ? 'Caught up!'
              : stats.catchUpDate
                ? fmtDate(stats.catchUpDate)
                : '—'
          }
          label="When will you catch up"
          sub={
            stats.ratePerDay > 0
              ? `at ${(stats.ratePerDay * 7).toFixed(1)} eps/week`
              : 'watch something to project a date'
          }
        />
      </div>

      <section className="card">
        <h2 className="stats-section-h">🗓️ Upcoming episodes — next 4 weeks</h2>
        {stats.upcoming.every((u) => u.count === 0) ? (
          <p className="stats-empty-note">
            Nothing on the schedule — none of your shows air in the next 4 weeks.
          </p>
        ) : (
          <div className="stats-upcoming">
            {stats.upcoming.map((u) => {
              const max = Math.max(1, ...stats.upcoming.map((x) => x.count))
              return (
                <div className="stats-weeks-col" key={u.label}>
                  <span className="stats-weeks-count" style={{ opacity: u.count > 0 ? 1 : 0.3 }}>
                    {u.count}
                  </span>
                  <div
                    className="stats-weeks-bar upcoming"
                    style={
                      u.count > 0
                        ? { height: Math.max(10, Math.round((u.count / max) * 72)) }
                        : { height: 4 }
                    }
                  />
                  <span className="stats-weeks-label">{u.label}</span>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

// ---------- movies tab ----------

function MoviesTab({ stats }: { stats: MovieStats }) {
  return (
    <div className="fade-in">
      <div className="stats-hero-row">
        <DurationHero
          icon="⏱️"
          title="Movie time"
          minutes={stats.totalMinutes}
          emptyNote="Mark a movie watched and your movie clock starts ticking."
        />
        <CountHero
          icon="🎬"
          title="Movies watched"
          value={num(stats.watched)}
          sub={
            stats.watched === 0
              ? 'None yet — movie night awaits.'
              : `${num(stats.watchedLast7)} in the last 7 days`
          }
        />
      </div>

      <div className="stats-grid">
        <section className="card">
          <h2 className="stats-section-h">📅 Movies per week</h2>
          <WeekChart
            weeks={stats.weeks}
            emptyNote="Movies you watch will chart here, week by week."
          />
        </section>

        <section className="card">
          <h2 className="stats-section-h">🧬 Top movie genres</h2>
          <BarTable
            rows={stats.genres}
            unit={(n) => `${n} ${n === 1 ? 'movie' : 'movies'}`}
            emptyNote="Watch a few movies to see your genre mix."
          />
        </section>
      </div>

      <div className="stats-grid">
        <section className="card">
          <h2 className="stats-section-h">💜 Your reactions</h2>
          <ReactionBars
            reactions={stats.reactions}
            total={stats.totalReactions}
            emptyNote="React to movies with an emoji — your feelings get charted here."
          />
        </section>

        <div className="stats-mini-col">
          <MiniStat
            icon="🎞️"
            value={num(stats.added)}
            label="Added movies"
            sub="tracked in your library"
          />
          <MiniStat
            icon="🧮"
            value={num(stats.remaining)}
            label="Remaining movies"
            sub="watchlist + unwatched in library"
          />
          <MiniStat
            icon="🔮"
            value={
              stats.remaining === 0
                ? 'All clear!'
                : stats.finishDate
                  ? fmtDate(stats.finishDate)
                  : '—'
            }
            label="Projected finish"
            sub={
              stats.ratePerWeek > 0
                ? `at ${stats.ratePerWeek.toFixed(1)} movies/week`
                : 'watch something to project a date'
            }
          />
        </div>
      </div>
    </div>
  )
}

// ---------- page ----------

export default function Stats() {
  const shows = useLibrary((s) => s.shows)
  const movies = useLibrary((s) => s.movies)
  const watchlist = useLibrary((s) => s.watchlist)
  const comments = useLibrary((s) => s.comments)
  const [tab, setTab] = useState<'shows' | 'movies'>('shows')

  const showStats = useMemo(() => computeShowStats(shows), [shows])
  const movieStats = useMemo(() => computeMovieStats(movies, watchlist), [movies, watchlist])
  const streaks = useMemo(() => computeStreaks(shows, movies), [shows, movies])
  const activeDays = useMemo(() => watchDaySet(shows, movies), [shows, movies])
  const badges = useMemo(
    () =>
      computeBadges({
        episodes: showStats.episodes,
        maxDayEpisodes: showStats.maxDayEpisodes,
        completedShows: showStats.completedShows,
        premieres: showStats.premieres,
        reactions: showStats.totalReactions + movieStats.totalReactions,
        votes: showStats.characterVotes,
        comments: comments.filter((c) => c.isMine).length,
        moviesWatched: movieStats.watched,
      }),
    [showStats, movieStats, comments],
  )

  const libraryEmpty =
    Object.keys(shows).length === 0 &&
    Object.keys(movies).length === 0 &&
    watchlist.length === 0

  if (libraryEmpty) {
    return (
      <div>
        <BackBar title="Stats" />
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

  return (
    <div>
      <BackBar title="Stats" />
      <h1 className="page-title">Stats</h1>
      <p className="page-subtitle">Your watching, quantified.</p>

      <div className="stats-tabs" role="tablist" aria-label="Stats category">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'shows'}
          className={`stats-tab${tab === 'shows' ? ' active' : ''}`}
          onClick={() => setTab('shows')}
        >
          📺 Shows
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'movies'}
          className={`stats-tab${tab === 'movies' ? ' active' : ''}`}
          onClick={() => setTab('movies')}
        >
          🎬 Movies
        </button>
      </div>

      {tab === 'shows' ? (
        <ShowsTab stats={showStats} streaks={streaks} activeDays={activeDays} />
      ) : (
        <MoviesTab stats={movieStats} />
      )}

      <BadgeSection badges={badges} />
    </div>
  )
}
