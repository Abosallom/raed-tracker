// Stats dashboard (/stats) — deep, tabbed dashboard computed purely from the
// library store. All charts are CSS bars (divs), no chart libraries.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Emotion } from '../types'
import { EMOTIONS } from '../types'
import { useLibrary } from '../store/library'
import type { BadgeCategory, MovieStats, RatingRow, ShowStats } from '../lib/stats'
import {
  computeBadgeCategories,
  computeEngagement,
  computeMovieStats,
  computeShowStats,
  fmtDate,
  fmtDayKey,
  fmtMonthYear,
} from '../lib/stats'
import { formatMinutes } from '../components/shared'
import { isStandalone } from '../lib/install'
import type { StreakInfo } from '../lib/streaks'
import { computeStreaks, localDayKey, watchDaySet } from '../lib/streaks'
import { BackBar } from '../components/BackBar'
import './stats.css'

// ---------- motion + count-up plumbing (local to Stats) ----------

/** True when the user asked for reduced motion — animations render instantly. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Fire `true` once the returned ref's element scrolls into view. One shared
 * IntersectionObserver hook — every count-up / grow-in animation on the page
 * keys off an element becoming visible so nothing animates off-screen.
 */
function useInView<T extends Element>(rootMargin = '0px 0px -10% 0px'): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true)
            obs.disconnect()
            break
          }
        }
      },
      { rootMargin, threshold: 0.15 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [rootMargin])
  return [ref, inView]
}

/**
 * Count a number up from 0 to `target` over ~700ms once `active` is true.
 * Reduced-motion (or a non-finite target) renders the final value instantly.
 * Returns the current display value (rounded).
 */
function useCountUp(target: number, active: boolean, durationMs = 700): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0))
  const rafRef = useRef<number | null>(null)
  useEffect(() => {
    if (!active || prefersReducedMotion() || !Number.isFinite(target)) {
      setValue(target)
      return
    }
    const start = performance.now()
    const from = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs)
      // easeOutCubic — quick start, gentle settle.
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(from + (target - from) * eased)
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [target, active, durationMs])
  return value
}

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

/**
 * Heuristic for the "Migrator" APP badge: no importer flag is persisted, so we
 * infer a bulk import from its signature — a watch record dated well before
 * (>7 days) the show was added to the library. Organic check-offs are always
 * on/after addedAt, so a comfortable back-date gap means the data came from an
 * export (TV Time etc.).
 */
function libraryLooksImported(shows: Record<number, import('../types').TrackedShow>): boolean {
  const GAP = 7 * 86_400_000
  for (const show of Object.values(shows)) {
    const added = new Date(show.addedAt).getTime()
    if (Number.isNaN(added)) continue
    for (const rec of Object.values(show.watched)) {
      const w = new Date(rec.watchedAt).getTime()
      if (!Number.isNaN(w) && w < added - GAP) return true
    }
  }
  return false
}

/**
 * Count-up number span. Animates 0 -> `value` once its own element scrolls
 * into view (or immediately under reduced motion). `format` styles the running
 * value; the final render always shows the exact target.
 */
function CountNumber({
  value,
  format = num,
  className,
  style,
}: {
  value: number
  format?: (n: number) => string
  className?: string
  style?: React.CSSProperties
}) {
  const [ref, inView] = useInView<HTMLSpanElement>()
  const display = useCountUp(value, inView)
  // Snap to the exact integer target at the tail so we never show "999" for 1,000.
  const shown = inView && display < value ? Math.round(display) : value
  return (
    <span ref={ref} className={className} style={style}>
      {format(shown)}
    </span>
  )
}

/** Unit labels for the segments formatMinutes emits ("3d 4h", "11h 20m"…). */
const DURATION_UNIT_LABEL: Record<string, [string, string]> = {
  d: ['day', 'days'],
  h: ['hour', 'hours'],
  m: ['minute', 'minutes'],
}

/**
 * Hero card. Uses shared formatMinutes as the single source of truth for
 * watch-time formatting (same as Profile), then splits its output into styled
 * unit segments. Leading zero units are already collapsed by formatMinutes, so
 * "11h 20m" never renders as "0 months 0 days 11 hours".
 */
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
  // e.g. "3d 4h" -> [{ n: '3', unit: 'd' }, { n: '4', unit: 'h' }]
  const segments = formatMinutes(minutes)
    .split(' ')
    .map((tok) => {
      const m = /^(\d+)([dhm])$/.exec(tok)
      return m ? { n: m[1], unit: m[2] } : null
    })
    .filter((s): s is { n: string; unit: string } => s !== null)
  return (
    <section className="card stats-hero">
      <h2 className="stats-section-h">
        {icon} {title}
      </h2>
      {minutes <= 0 || segments.length === 0 ? (
        <p className="stats-empty-note">{emptyNote}</p>
      ) : (
        <div className="stats-duration">
          {segments.map((seg) => {
            const [singular, plural] = DURATION_UNIT_LABEL[seg.unit] ?? ['', '']
            return (
              <div className="stats-duration-unit" key={seg.unit}>
                <CountNumber className="stats-duration-n" value={Number(seg.n)} />
                <span className="stats-duration-l">{seg.n === '1' ? singular : plural}</span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** Hero card: big count-up number + subtitle. */
function CountHero({
  icon,
  title,
  value,
  sub,
}: {
  icon: string
  title: string
  value: number
  sub: string
}) {
  return (
    <section className="card stats-hero">
      <h2 className="stats-section-h">
        {icon} {title}
      </h2>
      <CountNumber className="stats-hero-value" value={value} />
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
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <section className="card stats-hero" style={{ marginBottom: 18 }}>
      <h2 className="stats-section-h">🔥 Streak</h2>
      {streaks.lastActiveDay === null ? (
        <p className="stats-empty-note">Watch something to start a streak.</p>
      ) : (
        <div
          ref={ref}
          style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}
        >
          <div>
            <div className="stats-hero-value" style={{ color: 'var(--accent)' }}>
              <CountNumber value={streaks.current} /> {streaks.current === 1 ? 'day' : 'days'}
            </div>
            <div className="stats-hero-sub">Longest: {num(streaks.longest)}</div>
          </div>
          <div
            className={`stats-streak-strip${inView ? ' filled' : ''}`}
            aria-label="Watch activity, last 14 days"
          >
            {strip.map((d, i) => (
              <span
                key={d.key}
                className={`stats-streak-dot${d.active ? ' active' : ''}${d.today ? ' today' : ''}`}
                title={`${fmtDayKey(d.key)}${d.today ? ' (today)' : ''}${d.active ? ' — watched' : ''}`}
                style={{ transitionDelay: `${i * 45}ms` }}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/** Vertical bar chart over week OR day buckets (same {key,label,count,current}
    shape). `nowLabel` marks the current bucket; `caption` explains a non-default
    (daily) view. */
function WeekChart({
  weeks,
  emptyNote,
  nowLabel = 'now',
  caption,
}: {
  weeks: { key: string; label: string; count: number; current: boolean }[]
  emptyNote: string
  nowLabel?: string
  caption?: string
}) {
  const max = Math.max(1, ...weeks.map((w) => w.count))
  const empty = weeks.every((w) => w.count === 0)
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <>
      {caption && <p className="stats-chart-caption">{caption}</p>}
      <div className={`stats-weeks${inView ? ' grown' : ''}`} ref={ref}>
        {weeks.map((w, i) => (
          <div className="stats-weeks-col" key={w.key}>
            <span className="stats-weeks-count" style={{ opacity: w.count > 0 ? 1 : 0.3 }}>
              {w.count}
            </span>
            <div
              className={`stats-weeks-bar grow${w.current ? ' current' : ''}`}
              style={{
                height: w.count > 0 ? Math.max(8, Math.round((w.count / max) * 96)) : 4,
                transitionDelay: `${Math.min(i, 12) * 35}ms`,
              }}
            />
            <span className="stats-weeks-label">
              {w.current ? nowLabel : i % 2 === 0 ? w.label : ' '}
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

/**
 * Voted-ratings card (P7a). Reads the user's 1-10 ratings and shows a count
 * headline plus a "rating per {title}" table with a 10-segment bar. `noun`
 * pluralizes the copy for shows vs movies.
 */
function RatingsCard({
  ratings,
  ratedCount,
  avgRating,
  noun,
  linkPrefix,
  emptyNote,
}: {
  ratings: RatingRow[]
  ratedCount: number
  avgRating: number
  noun: 'show' | 'movie'
  linkPrefix: string
  emptyNote: string
}) {
  const nounPlural = noun === 'show' ? 'shows' : 'movies'
  return (
    <section className="card stats-hero">
      <h2 className="stats-section-h">⭐ Voted ratings</h2>
      {ratedCount === 0 ? (
        <p className="stats-empty-note">{emptyNote}</p>
      ) : (
        <>
          <div className="stats-ratings-headline">
            <CountNumber className="stats-hero-value" value={ratedCount} />
            <div className="stats-hero-sub">
              {ratedCount === 1 ? `rating on 1 ${noun}` : `ratings across ${num(ratedCount)} ${nounPlural}`}
              {avgRating > 0 && ` · avg ${avgRating.toFixed(1)}/10`}
            </div>
          </div>
          <div className="stats-subhead">Your rating per {noun}</div>
          <div className="stats-ratings-list">
            {ratings.slice(0, 12).map((r) => (
              <div className="stats-rating-row" key={r.id}>
                <Link className="stats-rating-name" to={`${linkPrefix}/${r.id}`} title={r.name}>
                  {r.name}
                </Link>
                <div className="stats-rating-track" aria-hidden="true">
                  <div
                    className="stats-rating-fill"
                    style={{ width: `${(r.rating / 10) * 100}%` }}
                  />
                </div>
                <span className="stats-rating-value">
                  {r.rating}/10 <span className="stats-rating-star">★</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
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

/** One labeled hexagonal category grid with an "N of M earned" count-up headline. */
function BadgeCategoryGrid({ category }: { category: BadgeCategory }) {
  return (
    <section className="card stats-badges-card">
      <h2 className="stats-section-h">
        {category.icon} {category.title}
        <span className="stats-badges-headline">
          <CountNumber value={category.earned} /> of {category.badges.length} earned
        </span>
      </h2>
      <div className="stats-badge-grid">
        {category.badges.map((b) => (
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

/** All badge categories, split into labeled hexagonal grids (P7b). */
function BadgeSection({ categories }: { categories: BadgeCategory[] }) {
  const totalEarned = categories.reduce((a, c) => a + c.earned, 0)
  const total = categories.reduce((a, c) => a + c.badges.length, 0)
  return (
    <div className="stats-badges-wrap">
      <h2 className="stats-badges-title">
        🎖️ Badges
        <span className="stats-badges-headline">
          <CountNumber value={totalEarned} /> of {total} earned
        </span>
      </h2>
      {categories.map((c) => (
        <BadgeCategoryGrid category={c} key={c.key} />
      ))}
    </div>
  )
}

// ---------- shows tab ----------

function ShowsTab({
  stats,
  streaks,
  activeDays,
  engagement,
}: {
  stats: ShowStats
  streaks: StreakInfo
  activeDays: Set<string>
  engagement: ReturnType<typeof computeEngagement>
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
          value={stats.episodes}
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
          <h2 className="stats-section-h">
            {stats.youngAccount ? '📅 Episodes per day' : '📅 Episodes per week'}
          </h2>
          {stats.youngAccount ? (
            <WeekChart
              weeks={stats.days}
              nowLabel="today"
              caption="Daily view — young account. Switches to a 12-week view as your history grows."
              emptyNote="Episodes you watch will chart here, day by day."
            />
          ) : (
            <WeekChart
              weeks={stats.weeks}
              emptyNote="Episodes you watch will chart here, week by week."
            />
          )}
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

      <div className="stats-grid">
        <RatingsCard
          ratings={stats.ratings}
          ratedCount={stats.ratedCount}
          avgRating={stats.avgRating}
          noun="show"
          linkPrefix="/show"
          emptyNote="Rate a show on its detail page and your scores get charted here."
        />
        <section className="card">
          <h2 className="stats-section-h">💬 Engagement</h2>
          <div className="stats-mini-row" style={{ marginBottom: 0 }}>
            <MiniStat
              icon="📺"
              value={num(engagement.showComments)}
              label="Show comments"
              sub="on show / movie threads"
            />
            <MiniStat
              icon="🎞️"
              value={num(engagement.episodeComments)}
              label="Episode comments"
              sub="on episode threads"
            />
            <MiniStat
              icon="❤️"
              value={num(engagement.earnedLikes)}
              label="Earned likes"
              sub="across your comments"
            />
          </div>
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
              : stats.catchUpUncertain && stats.catchUpRange
                ? `${fmtMonthYear(stats.catchUpRange[0])} – ${fmtMonthYear(stats.catchUpRange[1])}`
                : stats.catchUpDate
                  ? fmtDate(stats.catchUpDate)
                  : '—'
          }
          label="When will you catch up"
          sub={
            stats.ratePerDay <= 0
              ? 'watch something to project a date'
              : stats.catchUpUncertain
                ? `rough — only ${'<'}4 weeks of history`
                : `at ${(stats.ratePerDay * 7).toFixed(1)} eps/week`
          }
        />
      </div>

      {/* Derived stats computed from the same watched map. */}
      <div className="stats-mini-row">
        <MiniStat
          icon="📆"
          value={stats.busiestWeekday ? stats.busiestWeekday.name : '—'}
          label="Busiest weekday"
          sub={
            stats.busiestWeekday
              ? `${num(stats.busiestWeekday.count)} ${
                  stats.busiestWeekday.count === 1 ? 'episode' : 'episodes'
                } all-time`
              : 'watch something to find your rhythm'
          }
        />
        <MiniStat
          icon="📈"
          value={
            stats.avgEpisodesPerDayThisMonth > 0
              ? stats.avgEpisodesPerDayThisMonth.toFixed(1)
              : '—'
          }
          label="Avg episodes/day"
          sub="on days you watched this month"
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
          value={stats.watched}
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

      <div className="stats-grid">
        <RatingsCard
          ratings={stats.ratings}
          ratedCount={stats.ratedCount}
          avgRating={stats.avgRating}
          noun="movie"
          linkPrefix="/movie"
          emptyNote="Rate a movie on its detail page and your scores get charted here."
        />
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
  const following = useLibrary((s) => s.following)
  const [tab, setTab] = useState<'shows' | 'movies'>('shows')

  const showStats = useMemo(() => computeShowStats(shows), [shows])
  const movieStats = useMemo(() => computeMovieStats(movies, watchlist), [movies, watchlist])
  const streaks = useMemo(() => computeStreaks(shows, movies), [shows, movies])
  const activeDays = useMemo(() => watchDaySet(shows, movies), [shows, movies])
  const engagement = useMemo(() => computeEngagement(comments), [comments])

  const ratingsGiven = showStats.ratedCount + movieStats.ratedCount

  const badges = useMemo(
    () =>
      computeBadgeCategories({
        episodes: showStats.episodes,
        maxDayEpisodes: showStats.maxDayEpisodes,
        completedShows: showStats.completedShows,
        premieres: showStats.premieres,
        specials: showStats.specials,
        votes: showStats.characterVotes,
        moviesWatched: movieStats.watched,
        genreEpMap: showStats.genreEpMap,
        ratingsGiven,
        showComments: engagement.showComments,
        episodeComments: engagement.episodeComments,
        totalComments: engagement.myComments,
        earnedLikes: engagement.earnedLikes,
        following: following.length,
        // APP badges — derived from real localStorage flags where they exist,
        // else lifetime library facts (no importer flag is stored, so infer it
        // from back-dated watch records, the signature of a migration import).
        installed: isStandalone(),
        themeSwitched:
          typeof localStorage !== 'undefined' && localStorage.getItem('raedtracker_theme') != null,
        importerUsed: libraryLooksImported(shows),
      }),
    [showStats, movieStats, engagement, ratingsGiven, following, shows],
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
          <Link className="btn primary" to="/search" style={{ marginTop: 20 }}>
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
        <ShowsTab
          stats={showStats}
          streaks={streaks}
          activeDays={activeDays}
          engagement={engagement}
        />
      ) : (
        <MoviesTab stats={movieStats} />
      )}

      <BadgeSection categories={badges} />
    </div>
  )
}
