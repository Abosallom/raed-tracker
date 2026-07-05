// Persistent library store (localStorage). Structured so a real backend
// (Supabase/Firebase) can replace the persist layer later without UI changes.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Comment,
  Emotion,
  EpisodeKey,
  ListItem,
  MovieDetail,
  MovieSnapshot,
  Profile,
  ShowDetail,
  ShowSnapshot,
  TrackedMovie,
  TrackedShow,
  UserList,
  WatchlistItem,
} from '../types'
import { episodeKey } from '../types'

export function showToSnapshot(s: ShowDetail): ShowSnapshot {
  const counts: Record<number, number> = {}
  const aired: Record<number, number> = {}
  const rawLast = s.last_episode_to_air
  // A Specials episode (season 0) as "last aired" says nothing about regular
  // seasons — using it would zero every aired count. Fall back to deriving
  // from next_episode_to_air instead, or leave counts unset (airedEpisodeCount
  // then treats the season as fully aired) rather than falsely report 0.
  const last = rawLast && rawLast.season_number > 0 ? rawLast : null
  const next = s.next_episode_to_air
  const usableNext = next && next.season_number > 0 ? next : null
  for (const season of s.seasons) {
    if (season.season_number <= 0) continue
    counts[season.season_number] = season.episode_count
    // Episodes aired so far, derived from the last episode TMDB says has aired.
    if (last) {
      if (season.season_number < last.season_number)
        aired[season.season_number] = season.episode_count
      else if (season.season_number === last.season_number)
        aired[season.season_number] = Math.min(season.episode_count, last.episode_number)
      else aired[season.season_number] = 0
    } else if (rawLast && usableNext) {
      // Last aired was a special — anchor on the next regular episode instead.
      if (season.season_number < usableNext.season_number)
        aired[season.season_number] = season.episode_count
      else if (season.season_number === usableNext.season_number)
        aired[season.season_number] = Math.max(
          0,
          Math.min(season.episode_count, usableNext.episode_number - 1),
        )
      else aired[season.season_number] = 0
    } else if (!rawLast) {
      // Nothing has aired at all (upcoming show).
      aired[season.season_number] = 0
    }
    // else: last aired is a special and no next episode is scheduled — skip
    // the entry so airedEpisodeCount falls back to the full season count.
  }
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
    network: s.networks[0]?.name,
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
  lists: UserList[]
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
  /** Toggle pause: paused shows leave the Watch Next queue. */
  togglePauseShow: (id: number) => void
  /** "Who was your favorite?" vote on a watched episode (undefined clears it). */
  setEpisodeFavoriteCast: (
    showId: number,
    season: number,
    episode: number,
    cast: { id: number; name: string } | undefined,
  ) => void

  /**
   * Merge a migration payload (e.g. a TV Time export) into the library in one
   * state update. Existing shows/movies keep their data; only missing watch
   * records are added. Returns counts for the summary screen.
   */
  bulkImport: (payload: {
    shows: { detail: ShowDetail; watched: { season: number; episode: number; watchedAt?: string }[] }[]
    movies: { detail: MovieDetail; watchedAt?: string | null }[]
  }) => { showsAdded: number; episodesMarked: number; moviesAdded: number }

  // ----- custom lists -----
  createList: (name: string) => string
  renameList: (id: string, name: string) => void
  deleteList: (id: string) => void
  /** Add if absent, remove if present. */
  toggleListItem: (listId: string, item: Omit<ListItem, 'addedAt'>) => void

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

/**
 * Structural equality for plain JSON-ish values (snapshots). Key order is
 * irrelevant and `undefined` properties are treated as absent, so a freshly
 * built snapshot compares equal to its persisted/merged copy.
 */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => jsonEqual(x, b[i]))
  }
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined)
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) => jsonEqual(ra[k], rb[k]))
}

const EMPTY = {
  shows: {} as Record<number, TrackedShow>,
  movies: {} as Record<number, TrackedMovie>,
  watchlist: [] as WatchlistItem[],
  comments: [] as Comment[],
  lists: [] as UserList[],
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
          const snapshot = showToSnapshot(detail)
          // No-op when TMDB data is unchanged: a fresh snapshot object would
          // make sync's recordChanges stamp a new LWW touch-time, defeating
          // push()'s dedupe and re-uploading the entire library on every
          // show-page visit / freshness run even when nothing changed.
          if (jsonEqual(show.snapshot, snapshot)) return st
          return {
            shows: { ...st.shows, [detail.id]: { ...show, snapshot } },
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

      togglePauseShow: (id) =>
        set((st) => {
          const show = st.shows[id]
          if (!show) return st
          return { shows: { ...st.shows, [id]: { ...show, paused: !show.paused } } }
        }),

      setEpisodeFavoriteCast: (showId, season, episode, cast) =>
        set((st) => {
          const show = st.shows[showId]
          if (!show) return st
          const key = episodeKey(season, episode)
          const rec = show.watched[key]
          if (!rec) return st
          return {
            shows: {
              ...st.shows,
              [showId]: {
                ...show,
                watched: { ...show.watched, [key]: { ...rec, favoriteCast: cast } },
              },
            },
          }
        }),

      bulkImport: (payload) => {
        const st = get()
        const shows = { ...st.shows }
        const movies = { ...st.movies }
        let showsAdded = 0
        let episodesMarked = 0
        let moviesAdded = 0

        for (const item of payload.shows) {
          const existing = shows[item.detail.id]
          const base: TrackedShow = existing ?? {
            snapshot: showToSnapshot(item.detail),
            addedAt: now(),
            watched: {},
            favorite: false,
          }
          if (!existing) showsAdded++
          const watched = { ...base.watched }
          for (const ep of item.watched) {
            const key = episodeKey(ep.season, ep.episode)
            if (!watched[key]) {
              watched[key] = { watchedAt: ep.watchedAt ?? now() }
              episodesMarked++
            }
          }
          shows[item.detail.id] = { ...base, watched }
        }

        for (const m of payload.movies) {
          if (movies[m.detail.id]) {
            if (m.watchedAt !== undefined && !movies[m.detail.id].watched && m.watchedAt) {
              movies[m.detail.id] = {
                ...movies[m.detail.id],
                watched: { watchedAt: m.watchedAt },
              }
            }
            continue
          }
          moviesAdded++
          movies[m.detail.id] = {
            snapshot: movieToSnapshot(m.detail),
            addedAt: now(),
            watched: m.watchedAt ? { watchedAt: m.watchedAt } : null,
            favorite: false,
          }
        }

        set({ shows, movies })
        return { showsAdded, episodesMarked, moviesAdded }
      },

      createList: (name) => {
        const id = `l_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
        set((st) => ({
          lists: [...st.lists, { id, name, items: [], createdAt: now() }],
        }))
        return id
      },

      renameList: (id, name) =>
        set((st) => ({
          lists: st.lists.map((l) => (l.id === id ? { ...l, name } : l)),
        })),

      deleteList: (id) =>
        set((st) => ({ lists: st.lists.filter((l) => l.id !== id) })),

      toggleListItem: (listId, item) =>
        set((st) => ({
          lists: st.lists.map((l) => {
            if (l.id !== listId) return l
            const exists = l.items.some((i) => i.type === item.type && i.id === item.id)
            return {
              ...l,
              items: exists
                ? l.items.filter((i) => !(i.type === item.type && i.id === item.id))
                : [...l.items, { ...item, addedAt: now() }],
            }
          }),
        })),

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

// Cross-tab consistency: persist hydrates once at load and rewrites the WHOLE
// document on every set, so a second tab holding stale state would clobber
// everything the first tab wrote since (signed-out users have no cloud merge
// to repair it). `storage` fires only in OTHER tabs, and this tab's own state
// is already persisted at that moment, so rehydrating simply absorbs the other
// tab's write instead of overwriting it later.
//
// The sync engine's store subscriber must IGNORE the set() this rehydrate
// triggers: the originating tab already recorded tombstones/set-times for its
// change into the shared meta key and scheduled its own push. Diffing here
// would misread the absorbed write as local user edits — e.g. another tab's
// resetAll()/account-switch wipe would tombstone this tab's entire library
// (and re-tombstone right after Settings clears the meta), and persist's
// set(stateFromStorage, true) replaces every object reference, which would
// re-stamp stale snap:<id>/profile LWW times over genuinely fresher remote
// edits. library.ts cannot import sync.ts (cycle), so it exposes a flag the
// subscriber checks. persist's storage is synchronous localStorage, so the
// whole hydrate (including set()) completes before rehydrate() returns.
let absorbingCrossTabWrite = false
export function isAbsorbingCrossTabWrite(): boolean {
  return absorbingCrossTabWrite
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'showtrackr_library' && e.newValue !== null) {
      absorbingCrossTabWrite = true
      try {
        void useLibrary.persist.rehydrate()
      } finally {
        absorbingCrossTabWrite = false
      }
    }
  })
}

// ---------- derived helpers (pure functions over store slices) ----------

export function watchedCount(show: TrackedShow): number {
  return Object.keys(show.watched).length
}

export function showProgress(show: TrackedShow): number {
  const total = show.snapshot.totalEpisodes
  return total > 0 ? Math.min(1, watchedCount(show) / total) : 0
}

function todayISO(): string {
  // Local calendar date, NOT the UTC one (toISOString): every other air-date
  // computation (Upcoming, ShowDetail, stats) compares against local midnight.
  // Using UTC counted tomorrow's episode as aired from ~5pm for US users and
  // kept today's episode "unaired" until UTC midnight east of Greenwich.
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

/** Every aired episode of season `season` is watched (used for completion celebrations). */
export function seasonComplete(show: TrackedShow, season: number): boolean {
  const aired = airedEpisodeCount(show, season)
  if (aired === 0) return false
  for (let e = 1; e <= aired; e++) {
    if (!show.watched[episodeKey(season, e)]) return false
  }
  return true
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
