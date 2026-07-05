// Watch-streak computations — pure functions over library slices, no React.
// A "watch day" is any *local* calendar day with at least one WatchRecord
// (an episode check or a watched movie).

import type { TrackedMovie, TrackedShow } from '../types'

export interface StreakInfo {
  /** Consecutive watch days ending today or yesterday (0 = streak broken). */
  current: number
  /** Longest run of consecutive watch days across all history. */
  longest: number
  /** Most recent watch day (`yyyy-mm-dd`, local), or null if nothing watched. */
  lastActiveDay: string | null
}

/** Local calendar day key (`yyyy-mm-dd`) for a Date. */
export function localDayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Every local calendar day with >=1 WatchRecord (episodes or movies). */
export function watchDaySet(
  shows: Record<number, TrackedShow>,
  movies: Record<number, TrackedMovie>,
): Set<string> {
  const days = new Set<string>()
  const add = (iso: string) => {
    const t = new Date(iso)
    if (!Number.isNaN(t.getTime())) days.add(localDayKey(t))
  }
  for (const show of Object.values(shows)) {
    for (const rec of Object.values(show.watched)) add(rec.watchedAt)
  }
  for (const movie of Object.values(movies)) {
    if (movie.watched) add(movie.watched.watchedAt)
  }
  return days
}

/** Integer day index for a `yyyy-mm-dd` key (days since epoch, DST-safe). */
function dayIndex(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000)
}

/**
 * Compute the user's watch streaks. The current streak counts consecutive
 * days ending today *or yesterday* (so a streak isn't "broken" until a full
 * day is actually missed); the longest streak scans all history.
 */
export function computeStreaks(
  shows: Record<number, TrackedShow>,
  movies: Record<number, TrackedMovie>,
  now: Date = new Date(),
): StreakInfo {
  const days = watchDaySet(shows, movies)
  if (days.size === 0) return { current: 0, longest: 0, lastActiveDay: null }

  const indices = [...days]
    .map(dayIndex)
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b)

  // Longest run anywhere in history.
  let longest = 0
  let run = 0
  let prev: number | null = null
  for (const idx of indices) {
    run = prev != null && idx === prev + 1 ? run + 1 : 1
    if (run > longest) longest = run
    prev = idx
  }

  // Current run: walk backwards from today (or yesterday).
  const set = new Set(indices)
  const todayIdx = dayIndex(localDayKey(now)) ?? 0
  let current = 0
  let cursor: number | null = set.has(todayIdx)
    ? todayIdx
    : set.has(todayIdx - 1)
      ? todayIdx - 1
      : null
  if (cursor != null) {
    while (set.has(cursor)) {
      current++
      cursor--
    }
  }

  const lastActiveDay = [...days].sort().at(-1) ?? null
  return { current, longest, lastActiveDay }
}
