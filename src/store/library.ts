// Persistent library store (localStorage). Structured so a real backend
// (Supabase/Firebase) can replace the persist layer later without UI changes.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Comment,
  Emotion,
  EpisodeKey,
  MovieDetail,
  MovieSnapshot,
  Profile,
  ShowDetail,
  ShowSnapshot,
  TrackedMovie,
  TrackedShow,
  WatchlistItem,
} from '../types'
import { episodeKey } from '../types'

export function showToSnapshot(s: ShowDetail): ShowSnapshot {
  const counts: Record<number, number> = {}
  const aired: Record<number, number> = {}
  const last = s.last_episode_to_air
  for (const season of s.seasons) {
    if (season.season_number <= 0) continue
    counts[season.season_number] = season.episode_count
    // Episodes aired so far, derived from the last episode TMDB says has aired.
    if (!last) aired[season.season_number] = 0
    else if (season.season_number < last.season_number)
      aired[season.season_number] = season.episode_count
    else if (season.season_number === last.season_number)
      aired[season.season_number] = Math.min(season.episode_count, last.episode_number)
    else aired[season.season_number] = 0
  }
  const next = s.next_episode_to_air
  return {
    id: s.id,
    name: s.name,
    poster_path: s.poster_path,
    backdrop_path: s.backdrop_path,
    totalEpisodes: s.number_of_episodes,
    runtime: s.episode_run_time[0] ?? 40,
    genres: s.genres.map((g) => g.name),
    status: s.status,
    seasonEpisodeCounts: counts,
    airedEpisodeCounts: aired,
    nextEpisodeToAir: next
      ? { season: next.season_number, episode: next.episode_number, airDate: next.air_date }
      : null,
  }
}

export function movieToSnapshot(m: MovieDetail): MovieSnapshot {
  return {
    id: m.id,
    title: m.title,
    poster_path: m.poster_path,
    backdrop_path: m.backdrop_path,
    runtime: m.runtime ?? 110,
    genres: m.genres.map((g) => g.name),
  }
}

interface LibraryState {
  shows: Record<number, TrackedShow>
  movies: Record<number, TrackedMovie>
  watchlist: WatchlistItem[]
  comments: Comment[] // user's own + likes state on seeded ones
  profile: Profile

  // ----- shows -----
  addShow: (detail: ShowDetail) => void
  /** Update the stored snapshot from freshly fetched detail (no-op if not tracked). */
  refreshShow: (detail: ShowDetail) => void
  removeShow: (id: number) => void
  toggleFavoriteShow: (id: number) => void
  /** Toggle one episode. Returns true if it is now watched. */
  toggleEpisode: (showId: number, season: number, episode: number) => boolean
  setEpisodeEmotion: (showId: number, season: number, episode: number, emotion: Emotion | undefined) => void
  markSeasonWatched: (showId: number, season: number) => void
  markSeasonUnwatched: (showId: number, season: number) => void
  markShowWatched: (showId: number) => void

  // ----- movies -----
  addMovie: (detail: MovieDetail) => void
  removeMovie: (id: number) => void
  toggleFavoriteMovie: (id: number) => void
  toggleMovieWatched: (id: number) => boolean
  setMovieEmotion: (id: number, emotion: Emotion | undefined) => void

  // ----- watchlist -----
  addToWatchlist: (item: Omit<WatchlistItem, 'addedAt'>) => void
  removeFromWatchlist: (type: 'tv' | 'movie', id: number) => void
  isOnWatchlist: (type: 'tv' | 'movie', id: number) => boolean

  // ----- comments -----
  addComment: (mediaKey: string, text: string) => void
  deleteComment: (id: string) => void
  toggleLike: (id: string) => void

  // ----- profile -----
  updateProfile: (patch: Partial<Profile>) => void

  // ----- danger zone -----
  resetAll: () => void
}

function now(): string {
  return new Date().toISOString()
}

const EMPTY = {
  shows: {} as Record<number, TrackedShow>,
  movies: {} as Record<number, TrackedMovie>,
  watchlist: [] as WatchlistItem[],
  comments: [] as Comment[],
  profile: { name: 'Watcher', avatar: '🍿', joinedAt: now() } as Profile,
}

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => ({
      ...EMPTY,

      addShow: (detail) =>
        set((st) => {
          if (st.shows[detail.id]) return st
          return {
            shows: {
              ...st.shows,
              [detail.id]: {
                snapshot: showToSnapshot(detail),
                addedAt: now(),
                watched: {},
                favorite: false,
              },
            },
            // adding to library removes from watchlist
            watchlist: st.watchlist.filter((w) => !(w.type === 'tv' && w.id === detail.id)),
          }
        }),

      refreshShow: (detail) =>
        set((st) => {
          const show = st.shows[detail.id]
          if (!show) return st
          return {
            shows: { ...st.shows, [detail.id]: { ...show, snapshot: showToSnapshot(detail) } },
          }
        }),

      removeShow: (id) =>
        set((st) => {
          const shows = { ...st.shows }
          delete shows[id]
          return { shows }
        }),

      toggleFavoriteShow: (id) =>
        set((st) => {
          const show = st.shows[id]
          if (!show) return st
          return { shows: { ...st.shows, [id]: { ...show, favorite: !show.favorite } } }
        }),

      toggleEpisode: (showId, season, episode) => {
        const st = get()
        const show = st.shows[showId]
        if (!show) return false
        const key = episodeKey(season, episode)
        const watched = { ...show.watched }
        const nowWatched = !watched[key]
        if (nowWatched) watched[key] = { watchedAt: now() }
        else delete watched[key]
        set({ shows: { ...st.shows, [showId]: { ...show, watched } } })
        return nowWatched
      },

      setEpisodeEmotion: (showId, season, episode, emotion) =>
        set((st) => {
          const show = st.shows[showId]
          if (!show) return st
          const key = episodeKey(season, episode)
          const rec = show.watched[key]
          if (!rec) return st
          return {
            shows: {
              ...st.shows,
              [showId]: { ...show, watched: { ...show.watched, [key]: { ...rec, emotion } } },
            },
          }
        }),

      markSeasonWatched: (showId, season) =>
        set((st) => {
          const show = st.shows[showId]
          if (!show) return st
          // Only mark episodes that have actually aired.
          const count = airedEpisodeCount(show, season)
          const watched = { ...show.watched }
          for (let e = 1; e <= count; e++) {
            const key = episodeKey(season, e)
            if (!watched[key]) watched[key] = { watchedAt: now() }
          }
          return { shows: { ...st.shows, [showId]: { ...show, watched } } }
        }),

      markSeasonUnwatched: (showId, season) =>
        set((st) => {
          const show = st.shows[showId]
          if (!show) return st
          const watched: Record<EpisodeKey, (typeof show.watched)[string]> = {}
          for (const [k, v] of Object.entries(show.watched)) {
            if (!k.startsWith(`s${season}e`)) watched[k] = v
          }
          return { shows: { ...st.shows, [showId]: { ...show, watched } } }
        }),

      markShowWatched: (showId) =>
        set((st) => {
          const show = st.shows[showId]
          if (!show) return st
          const watched = { ...show.watched }
          for (const seasonStr of Object.keys(show.snapshot.seasonEpisodeCounts)) {
            const season = Number(seasonStr)
            // Only mark episodes that have actually aired.
            const count = airedEpisodeCount(show, season)
            for (let e = 1; e <= count; e++) {
              const key = episodeKey(season, e)
              if (!watched[key]) watched[key] = { watchedAt: now() }
            }
          }
          return { shows: { ...st.shows, [showId]: { ...show, watched } } }
        }),

      addMovie: (detail) =>
        set((st) => {
          if (st.movies[detail.id]) return st
          return {
            movies: {
              ...st.movies,
              [detail.id]: {
                snapshot: movieToSnapshot(detail),
                addedAt: now(),
                watched: null,
                favorite: false,
              },
            },
            watchlist: st.watchlist.filter((w) => !(w.type === 'movie' && w.id === detail.id)),
          }
        }),

      removeMovie: (id) =>
        set((st) => {
          const movies = { ...st.movies }
          delete movies[id]
          return { movies }
        }),

      toggleFavoriteMovie: (id) =>
        set((st) => {
          const m = st.movies[id]
          if (!m) return st
          return { movies: { ...st.movies, [id]: { ...m, favorite: !m.favorite } } }
        }),

      toggleMovieWatched: (id) => {
        const st = get()
        const m = st.movies[id]
        if (!m) return false
        const nowWatched = !m.watched
        set({
          movies: {
            ...st.movies,
            [id]: { ...m, watched: nowWatched ? { watchedAt: now() } : null },
          },
        })
        return nowWatched
      },

      setMovieEmotion: (id, emotion) =>
        set((st) => {
          const m = st.movies[id]
          if (!m || !m.watched) return st
          return {
            movies: { ...st.movies, [id]: { ...m, watched: { ...m.watched, emotion } } },
          }
        }),

      addToWatchlist: (item) =>
        set((st) => {
          if (st.watchlist.some((w) => w.type === item.type && w.id === item.id)) return st
          return { watchlist: [{ ...item, addedAt: now() }, ...st.watchlist] }
        }),

      removeFromWatchlist: (type, id) =>
        set((st) => ({
          watchlist: st.watchlist.filter((w) => !(w.type === type && w.id === id)),
        })),

      isOnWatchlist: (type, id) =>
        get().watchlist.some((w) => w.type === type && w.id === id),

      addComment: (mediaKey, text) =>
        set((st) => ({
          comments: [
            {
              id: `c_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
              mediaKey,
              author: st.profile.name,
              avatar: st.profile.avatar,
              text,
              createdAt: now(),
              likes: 0,
              likedByMe: false,
              isMine: true,
            },
            ...st.comments,
          ],
        })),

      deleteComment: (id) =>
        set((st) => ({ comments: st.comments.filter((c) => c.id !== id) })),

      toggleLike: (id) =>
        set((st) => ({
          comments: st.comments.map((c) =>
            c.id === id
              ? { ...c, likedByMe: !c.likedByMe, likes: c.likes + (c.likedByMe ? -1 : 1) }
              : c,
          ),
        })),

      updateProfile: (patch) =>
        set((st) => ({ profile: { ...st.profile, ...patch } })),

      resetAll: () => set({ ...EMPTY, profile: { ...EMPTY.profile, joinedAt: now() } }),
    }),
    { name: 'showtrackr_library' },
  ),
)

// ---------- derived helpers (pure functions over store slices) ----------

export function watchedCount(show: TrackedShow): number {
  return Object.keys(show.watched).length
}

export function showProgress(show: TrackedShow): number {
  const total = show.snapshot.totalEpisodes
  return total > 0 ? Math.min(1, watchedCount(show) / total) : 0
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Episodes of a season that have aired, per the snapshot. Legacy snapshots
 * without aired info fall back to the full episode count. If the snapshot's
 * "next episode to air" has since aired, the count advances to include it.
 */
export function airedEpisodeCount(show: TrackedShow, season: number): number {
  const total = show.snapshot.seasonEpisodeCounts[season] ?? 0
  const aired = show.snapshot.airedEpisodeCounts?.[season]
  if (aired == null) return total
  const next = show.snapshot.nextEpisodeToAir
  if (
    next != null &&
    next.season === season &&
    next.episode > aired &&
    next.airDate != null &&
    next.airDate <= todayISO()
  ) {
    return Math.min(total, next.episode)
  }
  return Math.min(total, aired)
}

/** Next unwatched *aired* episode (first gap in season/episode order), or null if caught up. */
export function nextEpisode(show: TrackedShow): { season: number; episode: number } | null {
  const seasons = Object.keys(show.snapshot.seasonEpisodeCounts)
    .map(Number)
    .sort((a, b) => a - b)
  for (const s of seasons) {
    const count = airedEpisodeCount(show, s)
    for (let e = 1; e <= count; e++) {
      if (!show.watched[episodeKey(s, e)]) return { season: s, episode: e }
    }
  }
  return null
}

/** Total minutes watched across the whole library. */
export function totalMinutesWatched(
  shows: Record<number, TrackedShow>,
  movies: Record<number, TrackedMovie>,
): number {
  let min = 0
  for (const show of Object.values(shows)) {
    min += watchedCount(show) * show.snapshot.runtime
  }
  for (const m of Object.values(movies)) {
    if (m.watched) min += m.snapshot.runtime
  }
  return min
}
