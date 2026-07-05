// TMDB API client with a demo-mode fallback (sample data, no key required).
// Get a free key at https://www.themoviedb.org/settings/api and paste it in Settings.

import type {
  Genre,
  MovieDetail,
  SearchResult,
  SeasonDetail,
  ShowDetail,
} from '../types'
import {
  MOCK_TRENDING_MOVIES,
  MOCK_TRENDING_TV,
  mockMovieDetail,
  mockSearch,
  mockSeasonDetail,
  mockShowDetail,
} from './mockData'

const BASE = 'https://api.themoviedb.org/3'
const IMG = 'https://image.tmdb.org/t/p'

const API_KEY_STORAGE = 'showtrackr_tmdb_key'

export function getApiKey(): string {
  return (
    localStorage.getItem(API_KEY_STORAGE) ||
    (import.meta.env.VITE_TMDB_API_KEY as string | undefined) ||
    ''
  )
}

export function setApiKey(key: string) {
  if (key.trim()) localStorage.setItem(API_KEY_STORAGE, key.trim())
  else localStorage.removeItem(API_KEY_STORAGE)
}

/** True when no TMDB key is configured and the app serves sample data. */
export function isDemoMode(): boolean {
  return !getApiKey()
}

class TmdbError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

async function fetchTmdb<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = getApiKey()
  const url = new URL(BASE + path)
  const isV4Token = key.startsWith('eyJ') // v4 read access tokens are JWTs
  if (!isV4Token) url.searchParams.set('api_key', key)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), {
    headers: isV4Token ? { Authorization: `Bearer ${key}` } : undefined,
  })
  if (!res.ok) {
    throw new TmdbError(
      res.status === 401
        ? 'TMDB rejected the API key — check it in Settings.'
        : `TMDB request failed (${res.status})`,
      res.status,
    )
  }
  return res.json() as Promise<T>
}

// ---------- images ----------

export function posterUrl(path: string | null, size: 'w185' | 'w342' | 'w500' = 'w342'): string | null {
  return path ? `${IMG}/${size}${path}` : null
}

export function backdropUrl(path: string | null, size: 'w780' | 'w1280' = 'w1280'): string | null {
  return path ? `${IMG}/${size}${path}` : null
}

export function profileUrl(path: string | null): string | null {
  return path ? `${IMG}/w185${path}` : null
}

export function stillUrl(path: string | null): string | null {
  return path ? `${IMG}/w300${path}` : null
}

// ---------- IMDb ----------

export function imdbTitleUrl(imdbId: string): string {
  return `https://www.imdb.com/title/${imdbId}/`
}

// ---------- normalization ----------

interface RawResult {
  id: number
  media_type?: string
  name?: string
  title?: string
  poster_path: string | null
  backdrop_path: string | null
  overview: string
  vote_average: number
  vote_count?: number
  first_air_date?: string
  release_date?: string
  genre_ids?: number[]
}

function normalize(r: RawResult, fallbackType: 'tv' | 'movie'): SearchResult {
  const media_type = (r.media_type === 'tv' || r.media_type === 'movie' ? r.media_type : fallbackType)
  return {
    id: r.id,
    media_type,
    name: r.name ?? r.title ?? 'Untitled',
    poster_path: r.poster_path,
    backdrop_path: r.backdrop_path,
    overview: r.overview,
    vote_average: r.vote_average,
    vote_count: r.vote_count,
    first_air_date: r.first_air_date,
    release_date: r.release_date,
    genre_ids: r.genre_ids,
  }
}

// ---------- endpoints (all fall back to sample data in demo mode) ----------

export async function searchMulti(query: string): Promise<SearchResult[]> {
  if (isDemoMode()) return mockSearch(query)
  const data = await fetchTmdb<{ results: RawResult[] }>('/search/multi', { query })
  return data.results
    .filter((r) => r.media_type === 'tv' || r.media_type === 'movie')
    .map((r) => normalize(r, 'tv'))
}

export async function trendingShows(): Promise<SearchResult[]> {
  if (isDemoMode()) return MOCK_TRENDING_TV
  const data = await fetchTmdb<{ results: RawResult[] }>('/trending/tv/week')
  return data.results.map((r) => normalize(r, 'tv'))
}

export async function trendingMovies(): Promise<SearchResult[]> {
  if (isDemoMode()) return MOCK_TRENDING_MOVIES
  const data = await fetchTmdb<{ results: RawResult[] }>('/trending/movie/week')
  return data.results.map((r) => normalize(r, 'movie'))
}

export async function popularShows(): Promise<SearchResult[]> {
  if (isDemoMode()) return [...MOCK_TRENDING_TV].reverse()
  const data = await fetchTmdb<{ results: RawResult[] }>('/tv/popular')
  return data.results.map((r) => normalize(r, 'tv'))
}

export async function topRatedShows(): Promise<SearchResult[]> {
  if (isDemoMode()) return [...MOCK_TRENDING_TV].sort((a, b) => b.vote_average - a.vote_average)
  const data = await fetchTmdb<{ results: RawResult[] }>('/tv/top_rated')
  return data.results.map((r) => normalize(r, 'tv'))
}

export async function topRatedMovies(): Promise<SearchResult[]> {
  if (isDemoMode()) return [...MOCK_TRENDING_MOVIES].sort((a, b) => b.vote_average - a.vote_average)
  const data = await fetchTmdb<{ results: RawResult[] }>('/movie/top_rated')
  return data.results.map((r) => normalize(r, 'movie'))
}

export async function upcomingMovies(): Promise<SearchResult[]> {
  if (isDemoMode()) return MOCK_TRENDING_MOVIES.slice(0, 4)
  const data = await fetchTmdb<{ results: RawResult[] }>('/movie/upcoming')
  return data.results.map((r) => normalize(r, 'movie'))
}

/** Static genre sets used in demo mode and as instant fallback. */
const DEMO_GENRES: Record<'tv' | 'movie', Genre[]> = {
  tv: [
    { id: 10759, name: 'Action & Adventure' },
    { id: 16, name: 'Animation' },
    { id: 35, name: 'Comedy' },
    { id: 80, name: 'Crime' },
    { id: 18, name: 'Drama' },
    { id: 9648, name: 'Mystery' },
    { id: 10765, name: 'Sci-Fi & Fantasy' },
  ],
  movie: [
    { id: 28, name: 'Action' },
    { id: 16, name: 'Animation' },
    { id: 35, name: 'Comedy' },
    { id: 80, name: 'Crime' },
    { id: 18, name: 'Drama' },
    { id: 27, name: 'Horror' },
    { id: 878, name: 'Science Fiction' },
    { id: 53, name: 'Thriller' },
  ],
}

export async function getGenres(type: 'tv' | 'movie'): Promise<Genre[]> {
  if (isDemoMode()) return DEMO_GENRES[type]
  try {
    const data = await fetchTmdb<{ genres: Genre[] }>(`/genre/${type}/list`)
    return data.genres
  } catch {
    return DEMO_GENRES[type]
  }
}

/**
 * Resolve an external id (TVDB or IMDb) to a TMDB entry. Used by the
 * TV Time importer. Returns null when nothing matches or in demo mode.
 */
export async function findByExternalId(
  externalId: string,
  source: 'tvdb_id' | 'imdb_id',
): Promise<SearchResult | null> {
  if (isDemoMode()) return null
  const data = await fetchTmdb<{
    tv_results: RawResult[]
    movie_results: RawResult[]
  }>(`/find/${externalId}`, { external_source: source })
  if (data.tv_results.length > 0) return normalize(data.tv_results[0], 'tv')
  if (data.movie_results.length > 0) return normalize(data.movie_results[0], 'movie')
  return null
}

/** YouTube key of the best official trailer, or null. */
export async function getTrailerKey(type: 'tv' | 'movie', id: number): Promise<string | null> {
  if (isDemoMode()) return null
  try {
    const data = await fetchTmdb<{
      results: { key: string; site: string; type: string; official: boolean }[]
    }>(`/${type}/${id}/videos`)
    const yt = data.results.filter((v) => v.site === 'YouTube')
    const pick =
      yt.find((v) => v.type === 'Trailer' && v.official) ??
      yt.find((v) => v.type === 'Trailer') ??
      yt.find((v) => v.type === 'Teaser')
    return pick?.key ?? null
  } catch {
    return null
  }
}

export function youtubeUrl(key: string): string {
  return `https://www.youtube.com/watch?v=${key}`
}

/** "More like this" recommendations for a title. */
export async function getRecommendations(
  type: 'tv' | 'movie',
  id: number,
): Promise<SearchResult[]> {
  if (isDemoMode()) {
    return (type === 'tv' ? MOCK_TRENDING_TV : MOCK_TRENDING_MOVIES).filter((r) => r.id !== id)
  }
  const data = await fetchTmdb<{ results: RawResult[] }>(`/${type}/${id}/recommendations`)
  return data.results.map((r) => normalize(r, type))
}

/** Browse by genre, sorted by popularity. */
export async function discoverByGenre(
  type: 'tv' | 'movie',
  genreId: number,
  page = 1,
): Promise<SearchResult[]> {
  if (isDemoMode()) {
    return type === 'tv' ? MOCK_TRENDING_TV : MOCK_TRENDING_MOVIES
  }
  const data = await fetchTmdb<{ results: RawResult[] }>(`/discover/${type}`, {
    with_genres: String(genreId),
    sort_by: 'popularity.desc',
    page: String(page),
  })
  return data.results.map((r) => normalize(r, type))
}

interface RawShowDetail extends Omit<ShowDetail, 'imdb_id' | 'cast'> {
  external_ids?: { imdb_id: string | null }
  credits?: { cast: { id: number; name: string; character: string; profile_path: string | null }[] }
}

export async function getShowDetail(id: number): Promise<ShowDetail> {
  if (isDemoMode()) {
    const s = mockShowDetail(id)
    if (!s) throw new TmdbError('Show not found in sample data')
    return s
  }
  const raw = await fetchTmdb<RawShowDetail>(`/tv/${id}`, {
    append_to_response: 'external_ids,credits',
  })
  return {
    ...raw,
    seasons: raw.seasons.filter((s) => s.season_number > 0), // drop "Specials"
    imdb_id: raw.external_ids?.imdb_id ?? null,
    cast: (raw.credits?.cast ?? []).slice(0, 12),
  }
}

export async function getSeasonDetail(showId: number, season: number): Promise<SeasonDetail> {
  if (isDemoMode()) {
    const s = mockSeasonDetail(showId, season)
    if (!s) throw new TmdbError('Season not found in sample data')
    return s
  }
  return fetchTmdb<SeasonDetail>(`/tv/${showId}/season/${season}`)
}

interface RawMovieDetail extends Omit<MovieDetail, 'cast'> {
  credits?: { cast: { id: number; name: string; character: string; profile_path: string | null }[] }
}

export async function getMovieDetail(id: number): Promise<MovieDetail> {
  if (isDemoMode()) {
    const m = mockMovieDetail(id)
    if (!m) throw new TmdbError('Movie not found in sample data')
    return m
  }
  const raw = await fetchTmdb<RawMovieDetail>(`/movie/${id}`, {
    append_to_response: 'credits',
  })
  return { ...raw, cast: (raw.credits?.cast ?? []).slice(0, 12) }
}
