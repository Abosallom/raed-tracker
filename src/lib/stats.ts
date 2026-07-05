// Pure stat computations for the Stats dashboard.
// No React, no fetching — everything derives from the library store in one pass.

import type { Emotion, TrackedMovie, TrackedShow, WatchlistItem } from '../types'
import { airedEpisodeCount, showProgress, watchedCount } from '../store/library'

const DAY = 86_400_000
const EP_KEY_RE = /^s(\d+)e(\d+)$/

// ---------- date helpers ----------

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function dateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Parse a `yyyy-mm-dd`(-prefixed) string as a *local* date (avoids UTC shifts). */
function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** Monday 00:00 (local) of the ISO week containing d. */
export function isoWeekStart(d: Date): Date {
  const day = startOfDay(d)
  const dow = (day.getDay() + 6) % 7 // Mon = 0
  return new Date(day.getTime() - dow * DAY)
}

export interface WeekBucket {
  key: string // dateKey of the week's Monday
  label: string // "d/m"
  count: number
  current: boolean
}

export function lastNWeeks(n: number, now: Date = new Date()): WeekBucket[] {
  const cur = isoWeekStart(now)
  const out: WeekBucket[] = []
  for (let i = n - 1; i >= 0; i--) {
    // Calendar arithmetic (not fixed 24h*7 ms) so weeks straddling a DST
    // switch still land on the Monday and match dateKey(isoWeekStart(t)).
    const d = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - i * 7)
    out.push({
      key: dateKey(d),
      label: `${d.getDate()}/${d.getMonth() + 1}`,
      count: 0,
      current: i === 0,
    })
  }
  return out
}

export interface DayBucket {
  key: string // dateKey
  label: string // "d/m"
  count: number
  current: boolean // today
}

/** The last `n` local calendar days ending today, oldest first. */
export function lastNDays(n: number, now: Date = new Date()): DayBucket[] {
  const today = startOfDay(now)
  const out: DayBucket[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    out.push({
      key: dateKey(d),
      label: `${d.getDate()}/${d.getMonth() + 1}`,
      count: 0,
      current: i === 0,
    })
  }
  return out
}

export function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "Dec 2027" — coarse month+year, for uncertain projection ranges. */
export function fmtMonthYear(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

/** Format a `yyyy-mm-dd` day key for display. */
export function fmtDayKey(key: string): string {
  const d = parseDay(key)
  return d ? fmtDate(d) : key
}

// ---------- duration ----------

export interface Duration {
  months: number
  days: number
  hours: number
}

/** Split minutes into months (30d) / days / hours, TV-time style. */
export function splitDuration(minutes: number): Duration {
  const totalHours = Math.floor(Math.max(0, minutes) / 60)
  return {
    months: Math.floor(totalHours / 720),
    days: Math.floor((totalHours % 720) / 24),
    hours: totalHours % 24,
  }
}

// ---------- reactions ----------

export type ReactionCounts = Record<Emotion, number>

function emptyReactions(): ReactionCounts {
  return { love: 0, fun: 0, wow: 0, meh: 0, sad: 0, scared: 0 }
}

// ---------- show stats ----------

export interface MarathonRow {
  id: number
  name: string
  episodes: number
  date: string // dateKey
}

export interface CharacterRow {
  name: string
  votes: number
}

export interface ShowCharacterRow {
  showId: number
  showName: string
  character: string
  votes: number
}

export interface UpcomingBucket {
  label: string
  count: number
}

export interface ShowStats {
  totalMinutes: number
  episodes: number
  episodesLast7: number
  episodesLast60: number
  weeks: WeekBucket[]
  /** Daily buckets (last 14 days); shown instead of `weeks` on young accounts. */
  days: DayBucket[]
  /** True when >80% of activity is in the newest week — use daily buckets. */
  youngAccount: boolean
  marathons: MarathonRow[]
  maxDayEpisodes: number
  addedShows: number
  inProduction: number
  genres: [string, number][] // episodes watched per genre, top 6
  networks: [string, number][] // shows tracked per network, top 5
  reactions: ReactionCounts
  totalReactions: number
  characters: CharacterRow[] // top 5 overall
  characterVotes: number
  showTopCharacters: ShowCharacterRow[] // most voted per show, top 5
  remainingEpisodes: number
  startedShows: number
  remainingMinutes: number
  ratePerDay: number // episodes/day over the pace window (floored at 4 weeks)
  catchUpDate: Date | null
  /** True when history spans <4 weeks — render a *range* not a point date. */
  catchUpUncertain: boolean
  catchUpRange: [Date, Date] | null
  upcoming: UpcomingBucket[] // next 4 weeks of nextEpisodeToAir
  premieres: number // episode-1s watched
  completedShows: number
  /** Derived: busiest weekday overall (name + count), or null if no activity. */
  busiestWeekday: { name: string; count: number } | null
  /** Derived: average episodes/day across days watched this calendar month. */
  avgEpisodesPerDayThisMonth: number
}

export function computeShowStats(
  shows: Record<number, TrackedShow>,
  now: Date = new Date(),
): ShowStats {
  const list = Object.values(shows)
  const weeks = lastNWeeks(12, now)
  const weekByKey = new Map(weeks.map((w) => [w.key, w]))
  const days = lastNDays(14, now)
  const dayByKey = new Map(days.map((d) => [d.key, d]))
  const cutoff7 = now.getTime() - 7 * DAY
  const cutoff60 = now.getTime() - 60 * DAY
  const today = startOfDay(now)

  // Derived-stat accumulators.
  const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0]
  const monthDaySet = new Set<string>()
  let monthEpisodes = 0
  let earliestWatch = Infinity // ms of the first watch record, for account age
  const curMonth = now.getMonth()
  const curYear = now.getFullYear()

  let totalMinutes = 0
  let episodes = 0
  let episodesLast7 = 0
  let episodesLast60 = 0
  let inProduction = 0
  let maxDayEpisodes = 0
  let premieres = 0
  let completedShows = 0
  let remainingEpisodes = 0
  let startedShows = 0
  let remainingMinutes = 0
  let characterVotes = 0

  const reactions = emptyReactions()
  const genreEps = new Map<string, number>()
  const networkShows = new Map<string, number>()
  const charVotes = new Map<string, number>()
  const marathons: MarathonRow[] = []
  const showTopCharacters: ShowCharacterRow[] = []
  const upcoming: UpcomingBucket[] = [
    { label: 'This week', count: 0 },
    { label: 'Next week', count: 0 },
    { label: 'In 2 weeks', count: 0 },
    { label: 'In 3 weeks', count: 0 },
  ]

  for (const show of list) {
    const snap = show.snapshot
    const n = watchedCount(show)
    episodes += n
    totalMinutes += n * snap.runtime

    if (/Returning|In Production/i.test(snap.status)) inProduction++
    if (snap.totalEpisodes > 0 && showProgress(show) >= 1) completedShows++
    if (snap.network) networkShows.set(snap.network, (networkShows.get(snap.network) ?? 0) + 1)
    if (n > 0) for (const g of snap.genres) genreEps.set(g, (genreEps.get(g) ?? 0) + n)

    // per-day counts (marathons), reactions, character votes, premieres, weeks
    const byDay = new Map<string, number>()
    const showChars = new Map<string, number>()
    for (const [key, rec] of Object.entries(show.watched)) {
      const t = new Date(rec.watchedAt)
      const ms = t.getTime()
      if (!Number.isNaN(ms)) {
        if (ms >= cutoff7) episodesLast7++
        if (ms >= cutoff60) episodesLast60++
        if (ms < earliestWatch) earliestWatch = ms
        const day = dateKey(t)
        byDay.set(day, (byDay.get(day) ?? 0) + 1)
        const bucket = weekByKey.get(dateKey(isoWeekStart(t)))
        if (bucket) bucket.count++
        const dayBucket = dayByKey.get(day)
        if (dayBucket) dayBucket.count++
        weekdayCounts[t.getDay()]++
        if (t.getMonth() === curMonth && t.getFullYear() === curYear) {
          monthEpisodes++
          monthDaySet.add(day)
        }
      }
      if (rec.emotion) reactions[rec.emotion]++
      if (rec.favoriteCast) {
        characterVotes++
        charVotes.set(rec.favoriteCast.name, (charVotes.get(rec.favoriteCast.name) ?? 0) + 1)
        showChars.set(rec.favoriteCast.name, (showChars.get(rec.favoriteCast.name) ?? 0) + 1)
      }
      const m = EP_KEY_RE.exec(key)
      if (m && Number(m[2]) === 1) premieres++
    }

    let best = 0
    let bestDay = ''
    for (const [day, c] of byDay) {
      if (c > best || (c === best && day > bestDay)) {
        best = c
        bestDay = day
      }
    }
    if (best > maxDayEpisodes) maxDayEpisodes = best
    if (best >= 2) marathons.push({ id: snap.id, name: snap.name, episodes: best, date: bestDay })

    let topChar = ''
    let topCharVotes = 0
    for (const [name, c] of showChars) {
      if (c > topCharVotes) {
        topChar = name
        topCharVotes = c
      }
    }
    if (topCharVotes > 0) {
      showTopCharacters.push({
        showId: snap.id,
        showName: snap.name,
        character: topChar,
        votes: topCharVotes,
      })
    }

    // remaining aired-but-unwatched episodes on started, non-paused shows
    if (n > 0 && !show.paused) {
      let rem = 0
      for (const seasonStr of Object.keys(snap.seasonEpisodeCounts)) {
        const season = Number(seasonStr)
        const aired = airedEpisodeCount(show, season)
        for (let e = 1; e <= aired; e++) {
          if (!show.watched[`s${season}e${e}`]) rem++
        }
      }
      if (rem > 0) {
        remainingEpisodes += rem
        remainingMinutes += rem * snap.runtime
      }
      startedShows++
    }

    // upcoming episodes in the next 4 weeks
    const next = snap.nextEpisodeToAir
    if (next?.airDate) {
      const air = parseDay(next.airDate)
      if (air) {
        const diff = Math.floor((air.getTime() - today.getTime()) / DAY)
        if (diff >= 0 && diff < 28) upcoming[Math.floor(diff / 7)].count++
      }
    }
  }

  marathons.sort((a, b) => b.episodes - a.episodes || b.date.localeCompare(a.date))
  showTopCharacters.sort((a, b) => b.votes - a.votes)

  // Young-account detection: if >80% of all charted week activity falls in the
  // newest (current) week, the 12-week chart is 11 empty gridlines — switch the
  // UI to the last-14-days daily view instead.
  const totalWeekActivity = weeks.reduce((a, w) => a + w.count, 0)
  const currentWeekActivity = weeks.find((w) => w.current)?.count ?? 0
  const youngAccount = totalWeekActivity > 0 && currentWeekActivity / totalWeekActivity > 0.8

  // Steadier catch-up projection: floor the pace window at 4 weeks (28 days) so
  // a single checkbox can't swing the rate wildly. When history spans <4 weeks
  // we can't project confidently, so render a RANGE (fast/slow pace) instead of
  // a single point date that would jump ~35 days per check.
  const historyDays =
    earliestWatch === Infinity ? 0 : Math.max(1, (now.getTime() - earliestWatch) / DAY)
  const paceWindowDays = Math.max(28, Math.min(60, historyDays))
  // Count episodes within the pace window (reuse the 60-day tally when the
  // window is the full 60; otherwise fall back to it — episodesLast60 is the
  // available recent-activity signal and is conservative for a wider window).
  const ratePerDay = episodesLast60 / paceWindowDays
  const catchUpUncertain = historyDays > 0 && historyDays < 28
  let catchUpDate: Date | null = null
  let catchUpRange: [Date, Date] | null = null
  if (ratePerDay > 0 && remainingEpisodes > 0) {
    const daysToFinish = Math.ceil(remainingEpisodes / ratePerDay)
    catchUpDate = new Date(now.getTime() + daysToFinish * DAY)
    if (catchUpUncertain) {
      // ±50% band around the point estimate for the wide-uncertainty case.
      catchUpRange = [
        new Date(now.getTime() + Math.ceil(daysToFinish * 0.7) * DAY),
        new Date(now.getTime() + Math.ceil(daysToFinish * 1.4) * DAY),
      ]
    }
  }

  // Derived stat: busiest weekday overall + avg episodes/day this month.
  let busiestIdx = -1
  for (let i = 0; i < 7; i++) {
    if (weekdayCounts[i] > 0 && (busiestIdx === -1 || weekdayCounts[i] > weekdayCounts[busiestIdx])) {
      busiestIdx = i
    }
  }
  const busiestWeekday =
    busiestIdx === -1
      ? null
      : { name: WEEKDAY_NAMES[busiestIdx], count: weekdayCounts[busiestIdx] }
  const avgEpisodesPerDayThisMonth =
    monthDaySet.size > 0 ? monthEpisodes / monthDaySet.size : 0

  return {
    totalMinutes,
    episodes,
    episodesLast7,
    episodesLast60,
    weeks,
    days,
    youngAccount,
    marathons: marathons.slice(0, 5),
    maxDayEpisodes,
    addedShows: list.length,
    inProduction,
    genres: [...genreEps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    networks: [...networkShows.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    reactions,
    totalReactions: Object.values(reactions).reduce((a, b) => a + b, 0),
    characters: [...charVotes.entries()]
      .map(([name, votes]) => ({ name, votes }))
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 5),
    characterVotes,
    showTopCharacters: showTopCharacters.slice(0, 5),
    remainingEpisodes,
    startedShows,
    remainingMinutes,
    ratePerDay,
    catchUpDate,
    catchUpUncertain,
    catchUpRange,
    upcoming,
    premieres,
    completedShows,
    busiestWeekday,
    avgEpisodesPerDayThisMonth,
  }
}

// ---------- movie stats ----------

export interface MovieStats {
  totalMinutes: number
  watched: number
  watchedLast7: number
  watchedLast60: number
  weeks: WeekBucket[]
  added: number
  genres: [string, number][] // watched movies per genre, top 6
  reactions: ReactionCounts
  totalReactions: number
  remaining: number // watchlist movies + tracked-but-unwatched
  ratePerWeek: number
  finishDate: Date | null
}

export function computeMovieStats(
  movies: Record<number, TrackedMovie>,
  watchlist: WatchlistItem[],
  now: Date = new Date(),
): MovieStats {
  const list = Object.values(movies)
  const weeks = lastNWeeks(12, now)
  const weekByKey = new Map(weeks.map((w) => [w.key, w]))
  const cutoff7 = now.getTime() - 7 * DAY
  const cutoff60 = now.getTime() - 60 * DAY

  let totalMinutes = 0
  let watched = 0
  let watchedLast7 = 0
  let watchedLast60 = 0
  let trackedUnwatched = 0
  const reactions = emptyReactions()
  const genreCount = new Map<string, number>()

  for (const m of list) {
    if (!m.watched) {
      trackedUnwatched++
      continue
    }
    watched++
    totalMinutes += m.snapshot.runtime
    if (m.watched.emotion) reactions[m.watched.emotion]++
    for (const g of m.snapshot.genres) genreCount.set(g, (genreCount.get(g) ?? 0) + 1)
    const t = new Date(m.watched.watchedAt)
    const ms = t.getTime()
    if (!Number.isNaN(ms)) {
      if (ms >= cutoff7) watchedLast7++
      if (ms >= cutoff60) watchedLast60++
      const bucket = weekByKey.get(dateKey(isoWeekStart(t)))
      if (bucket) bucket.count++
    }
  }

  const watchlistMovies = watchlist.filter((w) => w.type === 'movie').length
  const remaining = watchlistMovies + trackedUnwatched
  const ratePerDay = watchedLast60 / 60
  const finishDate =
    ratePerDay > 0 && remaining > 0
      ? new Date(now.getTime() + Math.ceil(remaining / ratePerDay) * DAY)
      : null

  return {
    totalMinutes,
    watched,
    watchedLast7,
    watchedLast60,
    weeks,
    added: list.length,
    genres: [...genreCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    reactions,
    totalReactions: Object.values(reactions).reduce((a, b) => a + b, 0),
    remaining,
    ratePerWeek: ratePerDay * 7,
    finishDate,
  }
}

// ---------- badges ----------

export interface BadgeInput {
  episodes: number
  maxDayEpisodes: number
  completedShows: number
  premieres: number
  reactions: number
  votes: number
  comments: number
  moviesWatched: number
}

export interface Badge {
  key: string
  emoji: string
  name: string
  desc: string
  earned: boolean
  progress: string // "412 / 1,000"
}

function badge(
  key: string,
  emoji: string,
  name: string,
  desc: string,
  value: number,
  goal: number,
): Badge {
  return {
    key,
    emoji,
    name,
    desc,
    earned: value >= goal,
    progress: `${Math.min(value, goal).toLocaleString('en-US')} / ${goal.toLocaleString('en-US')}`,
  }
}

export function computeBadges(i: BadgeInput): Badge[] {
  return [
    badge('first', '📺', 'First Episode', 'Watch your first episode', i.episodes, 1),
    badge('binge', '🍿', 'Binge Curious', 'Watch 100 episodes', i.episodes, 100),
    badge('serial', '🛋️', 'Serial Watcher', 'Watch 1,000 episodes', i.episodes, 1000),
    badge('couch', '🏆', 'Couch Marathon', 'Watch 5,000 episodes', i.episodes, 5000),
    badge('finisher', '🏁', 'Finisher', 'Finish a show 100%', i.completedShows, 1),
    badge('completionist', '💯', 'Completionist', 'Finish 5 shows', i.completedShows, 5),
    badge('premiere', '🎬', 'Premiere Fan', 'Watch 5 first episodes', i.premieres, 5),
    badge('critic', '🧐', 'Critic', 'React 10 times', i.reactions, 10),
    badge('voter', '🗳️', 'Voter', 'Vote 10 favorite characters', i.votes, 10),
    badge('chatterbox', '💬', 'Chatterbox', 'Write 10 comments', i.comments, 10),
    badge('moviebuff', '🎥', 'Movie Buff', 'Watch 50 movies', i.moviesWatched, 50),
    badge('weekend', '⚡', 'Weekend Marathoner', 'Watch 5+ episodes in one day', i.maxDayEpisodes, 5),
  ]
}
