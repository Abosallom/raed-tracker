// Sample data used in demo mode (no TMDB API key configured).
// Overviews are original placeholder text, not TMDB content.

import type {
  MovieDetail,
  SearchResult,
  SeasonDetail,
  ShowDetail,
} from '../types'

interface MockShowSeed {
  id: number
  name: string
  year: number
  status: string
  rating: number
  genres: string[]
  network: string
  seasons: number[] // episode count per season
  runtime: number
  imdb: string
  overview: string
}

const SHOW_SEEDS: MockShowSeed[] = [
  {
    id: 900001, name: 'Ashfall County', year: 2019, status: 'Returning Series', rating: 8.7,
    genres: ['Drama', 'Crime'], network: 'AMC', seasons: [8, 10, 10, 8], runtime: 47, imdb: 'tt0000001',
    overview: 'A small-town sheriff untangles a web of corruption after a mining accident exposes decades of buried secrets.',
  },
  {
    id: 900002, name: 'Starlight Protocol', year: 2021, status: 'Returning Series', rating: 8.9,
    genres: ['Sci-Fi & Fantasy', 'Drama'], network: 'HBO', seasons: [10, 10, 8], runtime: 55, imdb: 'tt0000002',
    overview: 'The last crew of a deep-space relay station discovers a signal that rewrites everything humanity knows about first contact.',
  },
  {
    id: 900003, name: 'The Pemberton Files', year: 2017, status: 'Ended', rating: 8.4,
    genres: ['Mystery', 'Thriller'], network: 'BBC One', seasons: [6, 6, 6, 6, 6], runtime: 58, imdb: 'tt0000003',
    overview: 'A disgraced detective reopens cold cases from a locked archive room, each one pointing back to the same night in 1987.',
  },
  {
    id: 900004, name: 'Halftime Heroes', year: 2020, status: 'Returning Series', rating: 8.8,
    genres: ['Comedy'], network: 'Apple TV+', seasons: [10, 12, 12], runtime: 32, imdb: 'tt0000004',
    overview: 'An underdog football club hires a motivational speaker with no coaching experience — and somehow it works.',
  },
  {
    id: 900005, name: 'Crown of Embers', year: 2018, status: 'Ended', rating: 9.0,
    genres: ['Sci-Fi & Fantasy', 'Action & Adventure'], network: 'Netflix', seasons: [10, 10, 10, 8, 6], runtime: 62, imdb: 'tt0000005',
    overview: 'Rival houses scheme for a molten throne while an ancient fire beneath the continent begins to wake.',
  },
  {
    id: 900006, name: 'Paper Trail', year: 2022, status: 'Returning Series', rating: 8.2,
    genres: ['Drama'], network: 'FX', seasons: [8, 8], runtime: 44, imdb: 'tt0000006',
    overview: 'A forensic accountant follows the money through a collapsing hedge fund and finds her own family name in the ledger.',
  },
  {
    id: 900007, name: "Night Shift at Milo's", year: 2023, status: 'Returning Series', rating: 8.5,
    genres: ['Comedy', 'Drama'], network: 'Hulu', seasons: [10], runtime: 28, imdb: 'tt0000007',
    overview: 'The overnight crew of a 24-hour diner serves insomniacs, ghosts of the neighborhood, and each other.',
  },
  {
    id: 900008, name: 'Meridian', year: 2024, status: 'Returning Series', rating: 8.6,
    genres: ['Sci-Fi & Fantasy', 'Mystery'], network: 'Prime Video', seasons: [8], runtime: 51, imdb: 'tt0000008',
    overview: 'Employees of a mapping company realize the blank spot on every map they produce is the same place — and it is growing.',
  },
]

interface MockMovieSeed {
  id: number
  title: string
  year: number
  rating: number
  genres: string[]
  runtime: number
  imdb: string
  overview: string
}

const MOVIE_SEEDS: MockMovieSeed[] = [
  {
    id: 800001, title: 'The Glass Orchard', year: 2023, rating: 8.3, genres: ['Drama'], runtime: 128, imdb: 'tt0000101',
    overview: 'Two estranged sisters inherit a greenhouse empire and one impossible condition: they must run it together for a year.',
  },
  {
    id: 800002, title: 'Redline Zero', year: 2024, rating: 7.9, genres: ['Action', 'Thriller'], runtime: 117, imdb: 'tt0000102',
    overview: 'A retired courier takes one last job across a city locked down by a blackout, with every traffic light against her.',
  },
  {
    id: 800003, title: 'Moons of Idris', year: 2022, rating: 8.5, genres: ['Science Fiction', 'Adventure'], runtime: 142, imdb: 'tt0000103',
    overview: 'A salvage crew answers a distress call from a moon that was catalogued as uninhabited — twice.',
  },
  {
    id: 800004, title: 'The Long Laugh', year: 2021, rating: 7.6, genres: ['Comedy'], runtime: 104, imdb: 'tt0000104',
    overview: 'A washed-up stand-up comic agrees to write jokes for a politician and accidentally becomes the story.',
  },
  {
    id: 800005, title: 'Winter Ledger', year: 2020, rating: 8.1, genres: ['Crime', 'Drama'], runtime: 133, imdb: 'tt0000105',
    overview: 'An auditor snowed in at a remote resort discovers the books balance perfectly — because someone is erasing the guests.',
  },
  {
    id: 800006, title: 'Paper Planets', year: 2024, rating: 8.0, genres: ['Animation', 'Family'], runtime: 96, imdb: 'tt0000106',
    overview: 'A kid who folds paper models of imaginary worlds wakes up to find one of them orbiting his bedroom lamp.',
  },
]

// ---------- helpers ----------

function isoDaysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function airDateFor(seed: MockShowSeed, season: number, episode: number): string {
  // Seasons air yearly starting from the show's first year; episodes weekly.
  const d = new Date(seed.year + season - 1, 0, 15)
  d.setDate(d.getDate() + (episode - 1) * 7)
  return d.toISOString().slice(0, 10)
}

function seedToShowDetail(seed: MockShowSeed): ShowDetail {
  const lastSeason = seed.seasons.length
  const lastCount = seed.seasons[lastSeason - 1]
  const returning = seed.status !== 'Ended'
  return {
    id: seed.id,
    name: seed.name,
    overview: seed.overview,
    poster_path: null,
    backdrop_path: null,
    first_air_date: `${seed.year}-01-15`,
    last_air_date: airDateFor(seed, lastSeason, lastCount),
    status: seed.status,
    vote_average: seed.rating,
    genres: seed.genres.map((name, i) => ({ id: seed.id * 10 + i, name })),
    episode_run_time: [seed.runtime],
    number_of_seasons: seed.seasons.length,
    number_of_episodes: seed.seasons.reduce((a, b) => a + b, 0),
    seasons: seed.seasons.map((count, i) => ({
      id: seed.id * 100 + i + 1,
      season_number: i + 1,
      name: `Season ${i + 1}`,
      episode_count: count,
      poster_path: null,
      air_date: airDateFor(seed, i + 1, 1),
      overview: '',
    })),
    networks: [{ id: 1, name: seed.network }],
    next_episode_to_air: returning
      ? {
          id: seed.id * 1000 + 1,
          season_number: lastSeason + 1,
          episode_number: 1,
          name: `The Return`,
          overview: 'A new chapter begins.',
          air_date: isoDaysFromNow(3 + (seed.id % 5) * 4),
          still_path: null,
          runtime: seed.runtime,
          vote_average: 0,
        }
      : null,
    last_episode_to_air: {
      id: seed.id * 1000 + 2,
      season_number: lastSeason,
      episode_number: lastCount,
      name: `Finale`,
      overview: '',
      air_date: airDateFor(seed, lastSeason, lastCount),
      still_path: null,
      runtime: seed.runtime,
      vote_average: seed.rating,
    },
    imdb_id: seed.imdb,
    cast: [
      { id: 1, name: 'Maya Reston', character: 'Lead', profile_path: null },
      { id: 2, name: 'Devon Okafor', character: 'Co-lead', profile_path: null },
      { id: 3, name: 'Priya Chandran', character: 'Supporting', profile_path: null },
      { id: 4, name: 'Tomás Herrera', character: 'Supporting', profile_path: null },
    ],
    tagline: '',
  }
}

const EPISODE_TITLES = [
  'Cold Open', 'The Long Way Around', 'Static', 'What We Buried', 'Signal Fire',
  'The Visitor', 'Fault Lines', 'Half-Life', 'The Quiet Part', 'Undertow',
  'Second Wind', 'Terminal Velocity',
]

export function mockSeasonDetail(showId: number, season: number): SeasonDetail | null {
  const seed = SHOW_SEEDS.find((s) => s.id === showId)
  if (!seed || season < 1 || season > seed.seasons.length) return null
  const count = seed.seasons[season - 1]
  return {
    id: showId * 100 + season,
    season_number: season,
    name: `Season ${season}`,
    episode_count: count,
    poster_path: null,
    air_date: airDateFor(seed, season, 1),
    overview: '',
    episodes: Array.from({ length: count }, (_, i) => ({
      id: showId * 10000 + season * 100 + i + 1,
      season_number: season,
      episode_number: i + 1,
      name: EPISODE_TITLES[i % EPISODE_TITLES.length],
      overview: 'Tensions rise as the crew confronts what they have been avoiding all season.',
      air_date: airDateFor(seed, season, i + 1),
      still_path: null,
      runtime: seed.runtime,
      vote_average: Math.round((seed.rating - 0.6 + ((i * 7) % 12) / 10) * 10) / 10,
    })),
  }
}

function seedToMovieDetail(seed: MockMovieSeed): MovieDetail {
  return {
    id: seed.id,
    title: seed.title,
    overview: seed.overview,
    poster_path: null,
    backdrop_path: null,
    release_date: `${seed.year}-06-12`,
    runtime: seed.runtime,
    status: 'Released',
    vote_average: seed.rating,
    genres: seed.genres.map((name, i) => ({ id: seed.id * 10 + i, name })),
    imdb_id: seed.imdb,
    cast: [
      { id: 1, name: 'Maya Reston', character: 'Lead', profile_path: null },
      { id: 2, name: 'Devon Okafor', character: 'Co-lead', profile_path: null },
    ],
    tagline: '',
  }
}

function showToSearchResult(s: ShowDetail): SearchResult {
  return {
    id: s.id,
    media_type: 'tv',
    name: s.name,
    poster_path: s.poster_path,
    backdrop_path: s.backdrop_path,
    overview: s.overview,
    vote_average: s.vote_average,
    first_air_date: s.first_air_date ?? undefined,
  }
}

function movieToSearchResult(m: MovieDetail): SearchResult {
  return {
    id: m.id,
    media_type: 'movie',
    name: m.title,
    poster_path: m.poster_path,
    backdrop_path: m.backdrop_path,
    overview: m.overview,
    vote_average: m.vote_average,
    release_date: m.release_date ?? undefined,
  }
}

// ---------- public mock API ----------

export const MOCK_SHOWS: ShowDetail[] = SHOW_SEEDS.map(seedToShowDetail)
export const MOCK_MOVIES: MovieDetail[] = MOVIE_SEEDS.map(seedToMovieDetail)

export const MOCK_TRENDING_TV: SearchResult[] = MOCK_SHOWS.map(showToSearchResult)
export const MOCK_TRENDING_MOVIES: SearchResult[] = MOCK_MOVIES.map(movieToSearchResult)

export function mockSearch(query: string): SearchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return [...MOCK_TRENDING_TV, ...MOCK_TRENDING_MOVIES].filter((r) =>
    r.name.toLowerCase().includes(q),
  )
}

export function mockShowDetail(id: number): ShowDetail | null {
  return MOCK_SHOWS.find((s) => s.id === id) ?? null
}

export function mockMovieDetail(id: number): MovieDetail | null {
  return MOCK_MOVIES.find((m) => m.id === id) ?? null
}

/** Seeded fake community comments for demo mode. */
export function mockComments(mediaKey: string): { author: string; avatar: string; text: string; daysAgo: number; likes: number }[] {
  const pools = [
    { author: 'binge_owl', avatar: '🦉', text: 'That ending?? I need the next episode RIGHT NOW.', daysAgo: 1, likes: 42 },
    { author: 'couchpotato99', avatar: '🥔', text: 'Nobody talk to me, I am still processing this one.', daysAgo: 2, likes: 31 },
    { author: 'sofia.watches', avatar: '🎬', text: 'The writing this season is on another level.', daysAgo: 3, likes: 18 },
    { author: 'remote_hog', avatar: '📺', text: 'Called the twist in the first ten minutes. Still gasped.', daysAgo: 5, likes: 12 },
    { author: 'midnight_marathon', avatar: '🌙', text: 'Watched this at 3am and I regret nothing.', daysAgo: 7, likes: 9 },
  ]
  // Deterministic subset per mediaKey so threads feel distinct.
  const hash = [...mediaKey].reduce((a, c) => a + c.charCodeAt(0), 0)
  return pools.filter((_, i) => (hash + i) % 3 !== 0)
}
