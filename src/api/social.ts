// Seeded local social graph — no backend exists, so profiles and activity are
// synthetic, generated deterministically and paired with the CURRENT user's
// tracked titles so the feed reads personal. Degrades gracefully to trending
// titles when the library is empty.

import type {
  ActivityItem,
  ActivityKind,
  Emotion,
  SocialUser,
  TrackedMovie,
  TrackedShow,
} from '../types'
import { EMOTIONS } from '../types'

export const SOCIAL_USERS: SocialUser[] = [
  { id: 'u-binge-owl', name: 'binge_owl', avatar: '🦉', bio: 'Nocturnal. Season finales only after midnight.', joinedAt: '2019-03-12', showsWatched: 312, followerCount: 8421 },
  { id: 'u-sofia', name: 'sofia.watches', avatar: '🎬', bio: 'Prestige drama apologist.', joinedAt: '2018-07-02', showsWatched: 208, followerCount: 15230 },
  { id: 'u-remote-hog', name: 'remote_hog', avatar: '📺', bio: 'I guessed the twist. I always guess the twist.', joinedAt: '2020-01-19', showsWatched: 154, followerCount: 3310 },
  { id: 'u-midnight', name: 'midnight_marathon', avatar: '🌙', bio: 'Sleep is a suggestion.', joinedAt: '2021-05-28', showsWatched: 421, followerCount: 27045 },
  { id: 'u-couch', name: 'couchpotato99', avatar: '🥔', bio: 'Professional rewatcher.', joinedAt: '2017-11-05', showsWatched: 187, followerCount: 990 },
  { id: 'u-kdrama-nora', name: 'nora.kdrama', avatar: '🌸', bio: '16 episodes or nothing.', joinedAt: '2020-09-14', showsWatched: 233, followerCount: 19870 },
  { id: 'u-anime-zed', name: 'zed_subs_only', avatar: '⚡', bio: 'Subs > dubs. Fight me politely.', joinedAt: '2019-06-30', showsWatched: 502, followerCount: 33120 },
  { id: 'u-docu-dan', name: 'documentary_dan', avatar: '🔍', bio: 'True crime and nature docs. Balanced diet.', joinedAt: '2022-02-08', showsWatched: 96, followerCount: 1210 },
  { id: 'u-horror-mim', name: 'mim_screams', avatar: '🎃', bio: 'Watches horror with the lights off. Regrets it nightly.', joinedAt: '2021-10-31', showsWatched: 141, followerCount: 7654 },
  { id: 'u-sitcom-sam', name: 'laughtrack_sam', avatar: '😂', bio: '22 minutes of joy on repeat.', joinedAt: '2018-04-22', showsWatched: 178, followerCount: 4530 },
  { id: 'u-scifi-rae', name: 'rae_beyond', avatar: '🛸', bio: 'If it has a spaceship, I have seen it.', joinedAt: '2019-12-03', showsWatched: 265, followerCount: 11980 },
  { id: 'u-film-tariq', name: 'tariq.frames', avatar: '🎞️', bio: 'A movie a day. Sometimes three.', joinedAt: '2020-06-17', showsWatched: 88, followerCount: 22400 },
]

export function getSocialUser(id: string): SocialUser | undefined {
  return SOCIAL_USERS.find((u) => u.id === id)
}

/** "13542" -> "13.5K", "1300000" -> "1.3M". */
export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 < 100_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 < 100 ? 0 : 1)}K`
  return String(n)
}

/** Deterministic per-day hash so the feed is stable within a day. */
function daySeed(): number {
  const d = new Date()
  return d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate()
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

interface FeedSource {
  mediaType: 'tv' | 'movie'
  mediaId: number
  mediaName: string
  poster_path: string | null
  seasonCounts?: Record<number, number>
}

/**
 * Build a synthetic activity feed pairing seeded users with the caller's
 * library titles (falling back to the supplied trending titles when the
 * library is thin). Items are deterministic per day.
 */
export function generateActivityFeed(
  shows: Record<number, TrackedShow>,
  movies: Record<number, TrackedMovie>,
  fallback: FeedSource[] = [],
  count = 24,
): ActivityItem[] {
  const sources: FeedSource[] = [
    ...Object.values(shows).map((s) => ({
      mediaType: 'tv' as const,
      mediaId: s.snapshot.id,
      mediaName: s.snapshot.name,
      poster_path: s.snapshot.poster_path,
      seasonCounts: s.snapshot.seasonEpisodeCounts,
    })),
    ...Object.values(movies).map((m) => ({
      mediaType: 'movie' as const,
      mediaId: m.snapshot.id,
      mediaName: m.snapshot.title,
      poster_path: m.snapshot.poster_path,
    })),
    ...fallback,
  ]
  if (sources.length === 0) return []

  const seed = daySeed()
  const kinds: ActivityKind[] = ['watched', 'watched', 'watched', 'favorited', 'commented']
  const items: ActivityItem[] = []
  const nowMs = Date.now()

  for (let i = 0; i < count; i++) {
    const h = hash(`${seed}:${i}`)
    const user = SOCIAL_USERS[h % SOCIAL_USERS.length]
    const src = sources[(h >> 3) % sources.length]
    const kind = kinds[(h >> 6) % kinds.length]
    const reaction: Emotion | undefined =
      kind === 'watched' && h % 3 === 0 ? EMOTIONS[(h >> 9) % EMOTIONS.length].key : undefined

    let season: number | undefined
    let episode: number | undefined
    if (src.mediaType === 'tv') {
      const seasons = Object.keys(src.seasonCounts ?? { 1: 10 }).map(Number)
      season = seasons[(h >> 4) % seasons.length] || 1
      const epCount = src.seasonCounts?.[season] ?? 10
      episode = (h % Math.max(1, epCount)) + 1
    }

    items.push({
      id: `act-${seed}-${i}`,
      user,
      kind,
      mediaType: src.mediaType,
      mediaId: src.mediaId,
      mediaName: src.mediaName,
      poster_path: src.poster_path,
      season,
      episode,
      reaction,
      // Spread over the last ~36 hours, newest first after sort.
      createdAt: new Date(nowMs - (h % 36) * 3600_000 - (h % 55) * 60_000).toISOString(),
    })
  }
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return items
}

/** Stable synthetic "watched by" count for a title (augments TMDB vote_count). */
export function watchedByCount(mediaId: number, voteCount?: number): number {
  const base = (voteCount ?? 500) * 37
  return base + (hash(String(mediaId)) % 9000)
}

/** A small stable cluster of users to render as stacked avatars for a title. */
export function watcherCluster(mediaId: number, size = 3): SocialUser[] {
  const start = hash(`cluster:${mediaId}`) % SOCIAL_USERS.length
  return Array.from({ length: size }, (_, i) => SOCIAL_USERS[(start + i) % SOCIAL_USERS.length])
}
