// ---------- TMDB entities ----------

export type MediaType = 'tv' | 'movie'

export interface Genre {
  id: number
  name: string
}

export interface SearchResult {
  id: number
  media_type: MediaType
  name: string // normalized: title for movies is copied here
  poster_path: string | null
  backdrop_path: string | null
  overview: string
  vote_average: number
  first_air_date?: string // tv
  release_date?: string // movie
  genre_ids?: number[]
}

export interface EpisodeSummary {
  id: number
  season_number: number
  episode_number: number
  name: string
  overview: string
  air_date: string | null
  still_path: string | null
  runtime: number | null
  vote_average: number
}

export interface SeasonSummary {
  id: number
  season_number: number
  name: string
  episode_count: number
  poster_path: string | null
  air_date: string | null
  overview: string
}

export interface SeasonDetail extends SeasonSummary {
  episodes: EpisodeSummary[]
}

export interface CastMember {
  id: number
  name: string
  character: string
  profile_path: string | null
}

export interface ShowDetail {
  id: number
  name: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  first_air_date: string | null
  last_air_date: string | null
  status: string // 'Returning Series' | 'Ended' | ...
  vote_average: number
  genres: Genre[]
  episode_run_time: number[]
  number_of_seasons: number
  number_of_episodes: number
  seasons: SeasonSummary[]
  networks: { id: number; name: string }[]
  next_episode_to_air: EpisodeSummary | null
  last_episode_to_air: EpisodeSummary | null
  imdb_id: string | null // filled from external_ids
  cast: CastMember[] // filled from credits
  tagline?: string
}

export interface MovieDetail {
  id: number
  title: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  release_date: string | null
  runtime: number | null
  status: string
  vote_average: number
  genres: Genre[]
  imdb_id: string | null
  cast: CastMember[]
  tagline?: string
}

// ---------- Library / tracking (persisted locally) ----------

/** TV Time-style emotion reaction to an episode or movie. */
export type Emotion = 'love' | 'fun' | 'wow' | 'meh' | 'sad' | 'scared'

export const EMOTIONS: { key: Emotion; emoji: string; label: string }[] = [
  { key: 'love', emoji: '😍', label: 'Loved it' },
  { key: 'fun', emoji: '😂', label: 'Fun' },
  { key: 'wow', emoji: '🤯', label: 'Wow' },
  { key: 'meh', emoji: '😐', label: 'Meh' },
  { key: 'sad', emoji: '😭', label: 'Cried' },
  { key: 'scared', emoji: '😱', label: 'Scared' },
]

/** Key for one episode inside a show: `s{season}e{episode}`, e.g. "s2e5". */
export type EpisodeKey = string

export function episodeKey(season: number, episode: number): EpisodeKey {
  return `s${season}e${episode}`
}

export interface WatchRecord {
  watchedAt: string // ISO date
  emotion?: Emotion
}

/** Lightweight snapshot so library pages render without hitting the API. */
export interface ShowSnapshot {
  id: number
  name: string
  poster_path: string | null
  backdrop_path: string | null
  totalEpisodes: number
  runtime: number // minutes per episode (best guess)
  genres: string[]
  status: string
  /** season_number -> episode count, used for progress & "mark season" */
  seasonEpisodeCounts: Record<number, number>
  /**
   * season_number -> episodes already aired at snapshot time. Missing on
   * snapshots saved by older versions (then everything is treated as aired).
   */
  airedEpisodeCounts?: Record<number, number>
  /** First episode not yet aired at snapshot time, so aired counts can advance without a refetch. */
  nextEpisodeToAir?: { season: number; episode: number; airDate: string | null } | null
}

export interface TrackedShow {
  snapshot: ShowSnapshot
  addedAt: string
  watched: Record<EpisodeKey, WatchRecord>
  favorite: boolean
}

export interface MovieSnapshot {
  id: number
  title: string
  poster_path: string | null
  backdrop_path: string | null
  runtime: number // minutes
  genres: string[]
}

export interface TrackedMovie {
  snapshot: MovieSnapshot
  addedAt: string
  watched: WatchRecord | null // null = tracked but not watched yet
  favorite: boolean
}

export interface WatchlistItem {
  type: MediaType
  id: number
  name: string
  poster_path: string | null
  addedAt: string
}

/** `mediaKey` identifies a comment thread: "tv:1399" or "tv:1399:s1e1" or "movie:27205". */
export interface Comment {
  id: string
  mediaKey: string
  author: string
  avatar: string // emoji
  text: string
  createdAt: string
  likes: number
  likedByMe: boolean
  isMine: boolean
}

export interface Profile {
  name: string
  avatar: string // emoji
  joinedAt: string
}
