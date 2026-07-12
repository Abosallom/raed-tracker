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
  WatchRecord,
} from '../types'
import { episodeKey } from '../types'
import { logActivity } from '../api/social-live'

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

/** How often the post-check-off reaction sheet should auto-open. */
export type ReactionPrompt = 'always' | 'milestones' | 'never'

interface LibraryState {
  shows: Record<number, TrackedShow>
  movies: Record<number, TrackedMovie>
  watchlist: WatchlistItem[]
  comments: Comment[] // user's own + likes state on seeded ones
  lists: UserList[]
  /** Ids of seeded SocialUsers the user follows (local social graph). */
  following: string[]
  profile: Profile
  /** Reaction-sheet frequency (Settings > App). Defaults to 'milestones'. */
  reactionPrompt: ReactionPrompt
  setReactionPrompt: (pref: ReactionPrompt) => void

  // ----- shows -----
  addShow: (detail: ShowDetail) => void
  /** Update the stored snapshot from freshly fetched detail (no-op if not tracked). */
  refreshShow: (detail: ShowDetail) => void
  removeShow: (id: number) => void
  toggleFavoriteShow: (id: number) => void
  /** Toggle one episode. Returns true if it is now watched. */
  toggleEpisode: (showId: number, season: number, episode: number) => boolean
  /** Catch-up: mark every aired regular-season episode up to AND INCLUDING
   *  (season, episode). Returns the keys it newly added (for undo). */
  markUpTo: (showId: number, season: number, episode: number) => EpisodeKey[]
  /** Inverse of a bulk mark: remove exactly these records (undo). */
  unmarkEpisodes: (showId: number, keys: EpisodeKey[]) => void
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
   * records are added. Optional extras carry source-app metadata: favorites,
   * paused shows, per-episode emotions, and watchlist entries.
   * Returns counts for the summary screen.
   */
  bulkImport: (payload: {
    shows: {
      detail: ShowDetail
      watched: { season: number; episode: number; watchedAt?: string }[]
      favorite?: boolean
      paused?: boolean
      emotions?: { season: number; episode: number; emotion: Emotion }[]
    }[]
    movies: { detail: MovieDetail; watchedAt?: string | null; favorite?: boolean }[]
    watchlist?: Omit<WatchlistItem, 'addedAt'>[]
  }) => {
    showsAdded: number
    episodesMarked: number
    moviesAdded: number
    watchlistAdded: number
    emotionsApplied: number
    /** Existing records whose stamped date was healed to the real one. */
    datesRepaired: number
  }

  // ----- custom lists -----
  createList: (name: string) => string
  renameList: (id: string, name: string) => void
  setListDescription: (id: string, description: string) => void
  deleteList: (id: string) => void
  /** Add if absent, remove if present. */
  toggleListItem: (listId: string, item: Omit<ListItem, 'addedAt'>) => void

  // ----- social graph -----
  /** Follow/unfollow a member (local; the follows table is written by the UI). */
  toggleFollow: (userId: string) => void
  /** Replace the follow set from the authoritative follows table (union-merged). */
  setFollowingIds: (ids: string[]) => void

  // ----- numeric ratings (1-10; undefined clears) -----
  setShowRating: (id: number, rating: number | undefined) => void
  setMovieRating: (id: number, rating: number | undefined) => void

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

/** Latest watchedAt among the remaining records (ISO compare), for undo rollbacks. */
function latestWatchStamp(watched: Record<EpisodeKey, WatchRecord>): string | undefined {
  let latest: string | undefined
  for (const rec of Object.values(watched)) {
    if (!latest || rec.watchedAt > latest) latest = rec.watchedAt
  }
  return latest
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
  following: [] as string[],
  profile: { name: 'Watcher', avatar: '🍿', joinedAt: now() } as Profile,
  // 'milestones': the most-repeated action in the app (checking an episode)
  // stays quiet — toast + undo — and the deep-react sheet only opens on
  // premieres/finales/completions. Settings still offers 'always'/'never'.
  reactionPrompt: 'milestones' as ReactionPrompt,
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
        const stamp = now()
        if (nowWatched) watched[key] = { watchedAt: stamp }
        else delete watched[key]
        set({
          shows: {
            ...st.shows,
            [showId]: {
              ...show,
              watched,
              // Checking bumps recent-activity ordering; unchecking is an
              // undo, so roll the stamp back to the remaining records' truth
              // (the lwa LWW touch-time in sync.ts keeps a merge from
              // resurrecting the mistaken check's stamp).
              lastWatchedAt: nowWatched ? stamp : latestWatchStamp(watched),
            },
          },
        })
        if (nowWatched) {
          // Publish to the real social feed (no-op when signed out / demo).
          void logActivity({
            kind: 'watched',
            mediaType: 'tv',
            mediaId: show.snapshot.id,
            mediaName: show.snapshot.name,
            poster_path: show.snapshot.poster_path,
            season,
            episode,
          })
        }
        return nowWatched
      },

      markUpTo: (showId, season, episode) => {
        const st = get()
        const show = st.shows[showId]
        if (!show) return []
        const watched = { ...show.watched }
        const added: EpisodeKey[] = []
        const stamp = now()
        for (const sStr of Object.keys(show.snapshot.seasonEpisodeCounts)) {
          const s = Number(sStr)
          // Regular seasons only — a catch-up must not sweep in specials.
          if (s < 1 || s > season) continue
          const aired = airedEpisodeCount(show, s)
          const maxE = s === season ? Math.min(episode, aired) : aired
          for (let e = 1; e <= maxE; e++) {
            const key = episodeKey(s, e)
            if (!watched[key]) {
              watched[key] = { watchedAt: stamp }
              added.push(key)
            }
          }
        }
        if (added.length === 0) return []
        set({
          shows: { ...st.shows, [showId]: { ...show, watched, lastWatchedAt: stamp } },
        })
        return added
      },

      unmarkEpisodes: (showId, keys) =>
        set((st) => {
          const show = st.shows[showId]
          if (!show || keys.length === 0) return st
          const watched = { ...show.watched }
          for (const k of keys) delete watched[k]
          // Same rollback semantics as toggleEpisode's uncheck.
          return {
            shows: {
              ...st.shows,
              [showId]: { ...show, watched, lastWatchedAt: latestWatchStamp(watched) },
            },
          }
        }),

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
          let marked = false
          for (let e = 1; e <= count; e++) {
            const key = episodeKey(season, e)
            if (!watched[key]) {
              watched[key] = { watchedAt: now() }
              marked = true
            }
          }
          return {
            shows: {
              ...st.shows,
              [showId]: { ...show, watched, ...(marked ? { lastWatchedAt: now() } : {}) },
            },
          }
        }),

      markSeasonUnwatched: (showId, season) =>
        set((st) => {
          const show = st.shows[showId]
          if (!show) return st
          const watched: Record<EpisodeKey, (typeof show.watched)[string]> = {}
          for (const [k, v] of Object.entries(show.watched)) {
            if (!k.startsWith(`s${season}e`)) watched[k] = v
          }
          const removedAny = Object.keys(watched).length !== Object.keys(show.watched).length
          return {
            shows: {
              ...st.shows,
              [showId]: {
                ...show,
                watched,
                // Undo semantics: same rollback as toggleEpisode's uncheck.
                ...(removedAny ? { lastWatchedAt: latestWatchStamp(watched) } : {}),
              },
            },
          }
        }),

      markShowWatched: (showId) =>
        set((st) => {
          const show = st.shows[showId]
          if (!show) return st
          const watched = { ...show.watched }
          let marked = false
          for (const seasonStr of Object.keys(show.snapshot.seasonEpisodeCounts)) {
            const season = Number(seasonStr)
            // Only mark episodes that have actually aired.
            const count = airedEpisodeCount(show, season)
            for (let e = 1; e <= count; e++) {
              const key = episodeKey(season, e)
              if (!watched[key]) {
                watched[key] = { watchedAt: now() }
                marked = true
              }
            }
          }
          return {
            shows: {
              ...st.shows,
              [showId]: { ...show, watched, ...(marked ? { lastWatchedAt: now() } : {}) },
            },
          }
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
        let datesRepaired = 0
        let moviesAdded = 0
        let watchlistAdded = 0
        let emotionsApplied = 0

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
            const prior = watched[key]
            if (!prior) {
              watched[key] = { watchedAt: ep.watchedAt ?? now() }
              episodesMarked++
            } else if (ep.watchedAt && prior.watchedAt > ep.watchedAt) {
              // REPAIR: a real historical date beats a later stamp. An earlier
              // import without dates stamped records with the import moment,
              // which wrecks recency ordering; re-importing a dated export
              // now heals those records in place (earliest wins — the same
              // provenance rule the sync merge uses). Reactions/votes kept.
              watched[key] = { ...prior, watchedAt: ep.watchedAt }
              datesRepaired++
            }
          }
          // Source-app emotions attach to (existing or just-created) watch records.
          for (const emo of item.emotions ?? []) {
            const key = episodeKey(emo.season, emo.episode)
            const rec = watched[key]
            if (rec && !rec.emotion) {
              watched[key] = { ...rec, emotion: emo.emotion }
              emotionsApplied++
            }
          }
          shows[item.detail.id] = {
            ...base,
            watched,
            favorite: base.favorite || !!item.favorite,
            paused: item.paused ?? base.paused,
          }
        }

        for (const m of payload.movies) {
          const existing = movies[m.detail.id]
          if (existing) {
            movies[m.detail.id] = {
              ...existing,
              watched:
                !existing.watched && m.watchedAt ? { watchedAt: m.watchedAt } : existing.watched,
              favorite: existing.favorite || !!m.favorite,
            }
            continue
          }
          moviesAdded++
          movies[m.detail.id] = {
            snapshot: movieToSnapshot(m.detail),
            addedAt: now(),
            watched: m.watchedAt ? { watchedAt: m.watchedAt } : null,
            favorite: !!m.favorite,
          }
        }

        // Watchlist entries: skip anything already tracked or already listed.
        let watchlist = st.watchlist
        for (const w of payload.watchlist ?? []) {
          const tracked =
            (w.type === 'tv' && shows[w.id]) || (w.type === 'movie' && movies[w.id])
          const listed = watchlist.some((x) => x.type === w.type && x.id === w.id)
          if (!tracked && !listed) {
            watchlist = [{ ...w, addedAt: now() }, ...watchlist]
            watchlistAdded++
          }
        }

        set({ shows, movies, watchlist })
        return { showsAdded, episodesMarked, moviesAdded, watchlistAdded, emotionsApplied, datesRepaired }
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

      setListDescription: (id, description) =>
        set((st) => ({
          lists: st.lists.map((l) => (l.id === id ? { ...l, description } : l)),
        })),

      toggleFollow: (userId) =>
        set((st) => ({
          following: st.following.includes(userId)
            ? st.following.filter((id) => id !== userId)
            : [...st.following, userId],
        })),

      // Reconcile the local follow set with the authoritative follows table
      // (union: keep any local-only follows made while the query was in flight).
      setFollowingIds: (ids) =>
        set((st) => ({ following: [...new Set([...ids, ...st.following])] })),

      setShowRating: (id, rating) =>
        set((st) => {
          const show = st.shows[id]
          if (!show) return st
          return { shows: { ...st.shows, [id]: { ...show, rating } } }
        }),

      setMovieRating: (id, rating) =>
        set((st) => {
          const m = st.movies[id]
          if (!m) return st
          return { movies: { ...st.movies, [id]: { ...m, rating } } }
        }),

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
        if (nowWatched) {
          void logActivity({
            kind: 'watched',
            mediaType: 'movie',
            mediaId: m.snapshot.id,
            mediaName: m.snapshot.title,
            poster_path: m.snapshot.poster_path,
          })
        }
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

      setReactionPrompt: (pref) => set({ reactionPrompt: pref }),

      resetAll: () => set({ ...EMPTY, profile: { ...EMPTY.profile, joinedAt: now() } }),
    }),
    {
      name: 'showtrackr_library',
      // Persist only serializable data slices — never the action functions.
      // Explicit now that a scalar preference (reactionPrompt) lives alongside
      // the collections; a legacy store missing it falls back to EMPTY's
      // 'milestones' via merge (undefined slice → initial-state value).
      partialize: (st) => ({
        shows: st.shows,
        movies: st.movies,
        watchlist: st.watchlist,
        comments: st.comments,
        lists: st.lists,
        profile: st.profile,
        reactionPrompt: st.reactionPrompt,
        following: st.following,
      }),
    },
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

/** Aired regular-season episodes strictly BEFORE (season, episode) that are
 *  still unwatched — the "seen all previous episodes?" gap. */
export function unwatchedBefore(show: TrackedShow, season: number, episode: number): number {
  let gap = 0
  for (const sStr of Object.keys(show.snapshot.seasonEpisodeCounts)) {
    const s = Number(sStr)
    if (s < 1 || s > season) continue
    const aired = airedEpisodeCount(show, s)
    const maxE = s === season ? Math.min(episode - 1, aired) : aired
    for (let e = 1; e <= maxE; e++) {
      if (!show.watched[episodeKey(s, e)]) gap++
    }
  }
  return gap
}

export function watchedCount(show: TrackedShow): number {
  return Object.keys(show.watched).length
}

export function showProgress(show: TrackedShow): number {
  const total = show.snapshot.totalEpisodes
  return total > 0 ? Math.min(1, watchedCount(show) / total) : 0
}

/**
 * watchedCount clamped to the snapshot total, for per-show "x / y" displays.
 * TV Time imports can carry records outside TMDB's episode count (season-0
 * specials, TVDB-numbered episodes), so the raw count can exceed the total —
 * "1225 / 1169" reads as a bug. Aggregate stats keep the raw count: those
 * specials really were watched.
 */
export function displayWatchedCount(show: TrackedShow): number {
  const total = show.snapshot.totalEpisodes
  return total > 0 ? Math.min(watchedCount(show), total) : watchedCount(show)
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

/** The lowest season number the show has (its "first" season, usually 1). */
function firstSeasonNumber(show: TrackedShow): number | null {
  const seasons = Object.keys(show.snapshot.seasonEpisodeCounts).map(Number)
  return seasons.length > 0 ? Math.min(...seasons) : null
}

/** The very first episode of the whole series (its first season, episode 1). */
export function isSeriesPremiere(show: TrackedShow, season: number, episode: number): boolean {
  return episode === 1 && season === firstSeasonNumber(show)
}

/** Episode 1 of any season is a season premiere. */
export function isSeasonPremiere(_show: TrackedShow, _season: number, episode: number): boolean {
  return episode === 1
}

/**
 * Last episode of a season, derived from the snapshot's per-season episode
 * count (falls back to aired count when the total isn't known). Used to fire a
 * finale celebration on the check-off users actually reach.
 */
export function isSeasonFinale(show: TrackedShow, season: number, episode: number): boolean {
  const total = show.snapshot.seasonEpisodeCounts[season]
  if (total != null && total > 0) return episode === total
  const aired = airedEpisodeCount(show, season)
  return aired > 0 && episode === aired
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
