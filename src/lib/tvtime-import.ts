// TV Time GDPR-export parsing for the /migrate wizard.
//
// The export is a ZIP of CSV files whose names and columns vary between
// export generations, so nothing here hardcodes filenames: each CSV is
// classified from its headers (episode history / followed shows / movies)
// and rows are normalized into one merged model the wizard can map to TMDB.

import JSZip from 'jszip'

import type { Emotion } from '../types'

// ---------- normalized model ----------

export interface ImportedEpisode {
  season: number
  episode: number
  watchedAt?: string // ISO
}

/** An emotion reaction attached to a specific episode of a show. */
export interface ImportedEmotion {
  season: number
  episode: number
  emotion: Emotion
}

export interface ImportedShow {
  name: string
  tvdbId?: string
  episodes: ImportedEpisode[]
  /** TV Time is_favorite. */
  favorite?: boolean
  /** status 'stopped' → the show is paused (drops out of Watch Next). */
  paused?: boolean
  /** status 'watch_later' → treat as a watchlist entry, not a followed show. */
  watchLater?: boolean
  /** Per-episode emotion reactions (best-effort, may be name-joined from CSV). */
  emotions?: ImportedEmotion[]
}

export interface ImportedFollow {
  name: string
  tvdbId?: string
}

export interface ImportedMovie {
  title: string
  imdbId?: string
  tvdbId?: string
  year?: number
  watchedAt?: string // ISO
  /** Whether the user has actually watched it; unwatched → watchlist candidate. */
  watched: boolean
  favorite?: boolean
}

export type DetectedKind =
  | 'episode-history'
  | 'followed-shows'
  | 'movies'
  | 'third-party series JSON'
  | 'third-party movies JSON'
  | 'official episode history'
  | 'official watch/watchlist records'
  | 'official followed shows'
  | 'episode emotions'
  | 'tvtime-direct'
  | 'unknown'

export interface FileDiagnostic {
  file: string
  detectedAs: DetectedKind
  rows: number
  skipped: number
  note?: string
  /** Parsed contributions — what the file actually yielded (not raw row counts). */
  episodes?: number
  movies?: number
  shows?: number
  watchlist?: number
  emotions?: number
}

export interface TvTimeImport {
  shows: ImportedShow[]
  followedOnly: ImportedFollow[]
  movies: ImportedMovie[]
  /** Movies/shows the user wants to watch but hasn't — feed the store's watchlist. */
  watchlistMovies: ImportedMovie[]
  diagnostics: FileDiagnostic[]
}

/** A single emotion row lifted from episode_emotion.csv (joined by name later). */
export interface ParsedEmotionRow {
  show: string
  season: number
  episode: number
  emotion: Emotion
}

/** Per-file intermediate result (also the unit reviewers can test). */
export interface ParsedFile {
  file: string
  kind: DetectedKind
  episodes: { show: string; tvdbId?: string; season: number; episode: number; watchedAt?: string }[]
  follows: ImportedFollow[]
  movies: ImportedMovie[]
  emotions: ParsedEmotionRow[]
  /** Full show records (with metadata) — only third-party series JSON populates these. */
  shows: ImportedShow[]
  /** true for third-party JSON, which is the authoritative source in a merge. */
  primary: boolean
  totalRows: number
  skipped: number
  note?: string
}

// ---------- CSV parsing (quoted fields, embedded commas/newlines, CRLF, BOM) ----------

export function parseCsvRows(text: string): string[][] {
  let src = text
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1) // strip BOM
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++ // CRLF
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // Drop rows that are entirely empty (trailing newlines etc.).
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

// ---------- header matching (case/underscore-insensitive) ----------

function norm(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Words of the raw header ("episode_season_number" → episode,season,number).
 *  Needed where the separator-stripped form is ambiguous — e.g. plural
 *  "episodes" vs the incidental substring in "episodeseasonnumber". */
function headerWords(header: string): string[] {
  return header.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

function findIdx(headers: string[], pred: (h: string) => boolean): number {
  for (let i = 0; i < headers.length; i++) {
    if (pred(headers[i])) return i
  }
  return -1
}

function findIdx2(headers: string[], pred: (h: string, i: number) => boolean): number {
  for (let i = 0; i < headers.length; i++) {
    if (pred(headers[i], i)) return i
  }
  return -1
}

function findShowNameIdx(headers: string[]): number {
  // Prefer explicit "series/show … name" columns, then bare series/show, then generic.
  let i = findIdx(headers, (h) => (h.includes('series') || h.includes('show')) && h.includes('name'))
  if (i >= 0) return i
  i = findIdx(headers, (h) => h === 'series' || h === 'show' || h === 'tvshow')
  if (i >= 0) return i
  return findIdx(headers, (h) => h === 'name' || h === 'title')
}

/** Count/summary columns (number_of_seasons, seasons_watched, total_episodes…)
 *  must never be mistaken for per-row season/episode numbers, or a
 *  followed-shows summary CSV gets misdetected as episode history. */
function isCountHeader(h: string, words: string[]): boolean {
  return (
    h.includes('numberof') ||
    h.includes('count') ||
    h.includes('total') ||
    words.some((w) => w === 'seasons' || w === 'episodes')
  )
}

function findSeasonIdx(headers: string[], words: string[][]): number {
  const i = findIdx(headers, (h) => h === 'seasonnumber' || h === 'season' || h === 's')
  if (i >= 0) return i
  return findIdx2(headers, (h, k) => h.includes('season') && !isCountHeader(h, words[k]))
}

function findEpisodeNumberIdx(headers: string[], words: string[][]): number {
  const i = findIdx(
    headers,
    (h) => h === 'episodenumber' || h === 'number' || h === 'epnum' || h === 'e',
  )
  if (i >= 0) return i
  return findIdx2(
    headers,
    (h, k) => h.includes('episode') && h.includes('num') && !isCountHeader(h, words[k]),
  )
}

function findTvdbIdx(headers: string[]): number {
  return findIdx(
    headers,
    // `sid` is the official v2 episode log's s_id column (the TVDB series id).
    (h) => h.includes('tvdb') || h.includes('seriesid') || h.includes('showid') || h === 'sid',
  )
}

function findDateIdx(headers: string[]): number {
  for (const exact of ['watchedat', 'watcheddate', 'watchedon', 'date', 'createdat']) {
    const i = findIdx(headers, (h) => h === exact)
    if (i >= 0) return i
  }
  let i = findIdx(headers, (h) => h.includes('watched'))
  if (i >= 0) return i
  return findIdx(headers, (h) => h.includes('date'))
}

// ---------- value parsing ----------

const SXXEYY = /s\s*0*(\d{1,3})\s*[ex]\s*0*(\d{1,4})/i

function parseIntField(v: string | undefined): number | null {
  if (v == null) return null
  const n = Number.parseInt(v.trim(), 10)
  return Number.isFinite(n) ? n : null
}

function parseDateField(v: string | undefined): string | undefined {
  if (!v) return undefined
  const t = v.trim()
  if (!t || t.startsWith('0000')) return undefined
  // "2019-05-20 21:30:00" → ISO-ish so Date parses it consistently.
  const isoish = /^\d{4}-\d{2}-\d{2} \d/.test(t) ? t.replace(' ', 'T') : t
  const d = new Date(isoish)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function cleanId(v: string | undefined): string | undefined {
  const t = v?.trim()
  return t && t !== '0' ? t : undefined
}

// TV Time's numeric emotion ids. This mapping is BEST-EFFORT: the GDPR export
// ships only the integer id (1..6), so the label order below is inferred from
// the app's reaction row (Loved it / Funny / OMG / Meh / Cried / Scared) and
// matches Raed Tracker's own EMOTIONS order. If TV Time ever reorders its
// reactions, this table is the single place to correct.
const EMOTION_BY_ID: Record<number, Emotion> = {
  1: 'love',
  2: 'fun',
  3: 'wow',
  4: 'meh',
  5: 'sad',
  6: 'scared',
}

function emotionFromId(v: string | undefined): Emotion | undefined {
  const n = parseIntField(v)
  return n != null ? EMOTION_BY_ID[n] : undefined
}

// ---------- per-file classification + parsing ----------

/**
 * Parse one CSV file's text and auto-detect what it contains.
 * Pure — exported so parsing is unit-testable without File/JSZip.
 */
export function parseCsvText(name: string, text: string): ParsedFile {
  const out: ParsedFile = {
    file: name,
    kind: 'unknown',
    episodes: [],
    follows: [],
    movies: [],
    emotions: [],
    shows: [],
    primary: false,
    totalRows: 0,
    skipped: 0,
  }
  const rows = parseCsvRows(text)
  if (rows.length === 0) {
    out.note = 'Empty file'
    return out
  }
  const headers = rows[0].map(norm)
  const words = rows[0].map(headerWords)
  const data = rows.slice(1)
  out.totalRows = data.length

  // --- episode emotions (episode_emotion.csv): emotion_id + tv_show_name + s/e ---
  const emotionIdx = findIdx(headers, (h) => h === 'emotionid' || h.includes('emotion'))
  if (emotionIdx >= 0 && headers.some((h) => h.includes('emotion'))) {
    const showIdx = findIdx(headers, (h) => h.includes('show') && h.includes('name'))
    const sIdx = findIdx(headers, (h) => h.includes('season'))
    // Prefer the exact episode-number column; "episode_season_number" also
    // contains both words, so fall back to it only if no exact match exists.
    let eIdx = findIdx(headers, (h) => h === 'episodenumber' || h === 'episodenum')
    if (eIdx < 0) eIdx = findIdx(headers, (h) => h.includes('episode') && h.includes('number') && !h.includes('season'))
    if (showIdx >= 0 && sIdx >= 0 && eIdx >= 0) {
      out.kind = 'episode emotions'
      for (const r of data) {
        const show = r[showIdx]?.trim()
        const season = parseIntField(r[sIdx])
        const episode = parseIntField(r[eIdx])
        const emotion = emotionFromId(r[emotionIdx])
        if (!show || season == null || episode == null || !emotion) {
          out.skipped++
          continue
        }
        out.emotions.push({ show, season, episode, emotion })
      }
      return out
    }
  }

  // --- official "records" table (tracking-prod-records.csv): a `type` column
  //     mixing watch/towatch/follow rows for movies (by name) and shows. ---
  const typeIdx = findIdx(headers, (h) => h === 'type')
  const movieNameCol = findIdx(headers, (h) => h === 'moviename')
  if (typeIdx >= 0 && movieNameCol >= 0) {
    out.kind = 'official watch/watchlist records'
    const recDateIdx = findDateIdx(headers)
    const recImdb = findIdx(headers, (h) => h.includes('imdb'))
    for (const r of data) {
      const type = norm(r[typeIdx] ?? '')
      const movie = r[movieNameCol]?.trim()
      if (!movie) {
        // Non-movie rows (episode/show tracking) are covered by v2 history; skip.
        out.skipped++
        continue
      }
      const rawImdb = recImdb >= 0 ? cleanId(r[recImdb]) : undefined
      if (type === 'watch' || type === 'rewatch') {
        out.movies.push({
          title: movie,
          imdbId: rawImdb && /^tt\d+$/i.test(rawImdb) ? rawImdb : undefined,
          watchedAt: recDateIdx >= 0 ? parseDateField(r[recDateIdx]) : undefined,
          watched: true,
        })
      } else if (type === 'towatch') {
        out.movies.push({ title: movie, watched: false })
      } else {
        out.skipped++
      }
    }
    return out
  }

  const fileLower = name.toLowerCase()

  // Vote/comment/rating/rewatch/source metadata tables in the official ZIP
  // mirror the episode/movie columns (show name + season/episode + created_at),
  // but their created_at is a vote/comment/rewatch time, NOT the watch time —
  // parsing them would poison real watch dates (and even invent watches for
  // never-watched episodes), so they are ignored outright. The real watch log
  // (tracking-prod-records-v2.csv) carries none of these markers.
  const isMetadataFile =
    /vote|comment|rating|rewatch|character|watched.?on|latest|source|addiction/.test(fileLower) ||
    headers.some((h) => h.includes('vote') || h.includes('comment') || h.includes('rating'))
  if (isMetadataFile) {
    out.skipped = data.length
    out.note = 'Votes/comments/metadata — not watch history, ignored'
    return out
  }

  const nameIdx = findShowNameIdx(headers)
  const seasonIdx = findSeasonIdx(headers, words)
  let epIdx = findEpisodeNumberIdx(headers, words)
  if (seasonIdx >= 0 && epIdx < 0) {
    // With a season column present, a bare "episode" column is the number.
    epIdx = findIdx(headers, (h) => h === 'episode')
  }
  const tvdbIdx = findTvdbIdx(headers)
  const dateIdx = findDateIdx(headers)
  // The official GDPR episode log has a distinctive `s_id`/`key` shape; label it
  // as such in diagnostics while the generic path handles synthetic exports.
  const isOfficialV2 = headers.includes('sid') && headers.some((h) => h === 'key')

  // --- episode history: structured season+episode columns ---
  if (nameIdx >= 0 && seasonIdx >= 0 && epIdx >= 0) {
    out.kind = isOfficialV2 ? 'official episode history' : 'episode-history'
    // Generic exports skip season 0 (specials) per the legacy contract; the
    // official log legitimately records special watches, so keep season 0 there.
    const minSeason = isOfficialV2 ? 0 : 1
    // The official log mixes watch-episode and rewatch-episode rows (tagged in
    // key/gsi) in arbitrary order. Emit rewatch rows LAST so the merge's
    // first-record-wins dedupe keeps the original watch date, while episodes
    // known only from a rewatch still make it in.
    const keyIdx = isOfficialV2 ? findIdx(headers, (h) => h === 'key') : -1
    const gsiIdx = isOfficialV2 ? findIdx(headers, (h) => h === 'gsi') : -1
    const rewatches: ParsedFile['episodes'] = []
    for (const r of data) {
      const show = r[nameIdx]?.trim()
      const season = parseIntField(r[seasonIdx])
      const episode = parseIntField(r[epIdx])
      if (!show || season == null || episode == null || season < minSeason || episode <= 0) {
        out.skipped++
        continue
      }
      const isRewatch =
        isOfficialV2 &&
        `${keyIdx >= 0 ? r[keyIdx] : ''} ${gsiIdx >= 0 ? r[gsiIdx] : ''}`.includes('rewatch')
      ;(isRewatch ? rewatches : out.episodes).push({
        show,
        tvdbId: tvdbIdx >= 0 ? cleanId(r[tvdbIdx]) : undefined,
        season,
        episode,
        watchedAt: dateIdx >= 0 ? parseDateField(r[dateIdx]) : undefined,
      })
    }
    out.episodes.push(...rewatches)
    return out
  }

  // --- episode history: single "episode" column with S01E02 values ---
  if (nameIdx >= 0) {
    const combIdx = findIdx(headers, (h) => h.includes('episode'))
    if (combIdx >= 0 && data.slice(0, 25).some((r) => SXXEYY.test(r[combIdx] ?? ''))) {
      out.kind = 'episode-history'
      for (const r of data) {
        const show = r[nameIdx]?.trim()
        const m = SXXEYY.exec(r[combIdx] ?? '')
        if (!show || !m) {
          out.skipped++
          continue
        }
        const season = Number.parseInt(m[1], 10)
        const episode = Number.parseInt(m[2], 10)
        if (season <= 0 || episode <= 0) {
          out.skipped++
          continue
        }
        out.episodes.push({
          show,
          tvdbId: tvdbIdx >= 0 ? cleanId(r[tvdbIdx]) : undefined,
          season,
          episode,
          watchedAt: dateIdx >= 0 ? parseDateField(r[dateIdx]) : undefined,
        })
      }
      return out
    }
  }

  // --- no episode columns: followed shows vs movies ---
  const imdbIdx = findIdx(headers, (h) => h.includes('imdb'))
  const uuidIdx = findIdx(headers, (h) => h.includes('uuid'))
  const movieNameIdx = findIdx(
    headers,
    (h) => h.includes('movie') && (h.includes('name') || h.includes('title')),
  )
  const movieish =
    fileLower.includes('movie') ||
    movieNameIdx >= 0 ||
    headers.some((h) => h.includes('movie')) ||
    imdbIdx >= 0 ||
    uuidIdx >= 0
  const showish =
    fileLower.includes('show') ||
    fileLower.includes('series') ||
    fileLower.includes('follow') ||
    tvdbIdx >= 0 ||
    // The NAME column itself must be show-flavored — scanning every header
    // would misfire on incidental columns (user.csv's notif_webseries_new_video
    // contains "series" but the file's `name` column is the username).
    (nameIdx >= 0 && (headers[nameIdx].includes('series') || headers[nameIdx].includes('show')))

  const titleIdx = movieNameIdx >= 0 ? movieNameIdx : nameIdx

  if (movieish && !showish && titleIdx >= 0) {
    out.kind = 'movies'
    for (const r of data) {
      const title = r[titleIdx]?.trim()
      if (!title) {
        out.skipped++
        continue
      }
      const rawImdb = imdbIdx >= 0 ? cleanId(r[imdbIdx]) : undefined
      out.movies.push({
        title,
        imdbId: rawImdb && /^tt\d+$/i.test(rawImdb) ? rawImdb : undefined,
        watchedAt: dateIdx >= 0 ? parseDateField(r[dateIdx]) : undefined,
        watched: true,
      })
    }
    return out
  }

  // Followed shows require a REAL show signal (filename or show/series/tvdb
  // columns). A bare name/title column is NOT enough: the official ZIP is full
  // of settings/tracking CSVs with generic name+value columns whose "names"
  // ('os', 'locale', usernames…) would otherwise be imported as shows.
  if (nameIdx >= 0 && showish) {
    const isOfficialFollow = headers.some((h) => h === 'tvshowid') && !!fileLower.includes('follow')
    out.kind = isOfficialFollow ? 'official followed shows' : 'followed-shows'
    for (const r of data) {
      const show = r[nameIdx]?.trim()
      if (!show) {
        out.skipped++
        continue
      }
      out.follows.push({ name: show, tvdbId: tvdbIdx >= 0 ? cleanId(r[tvdbIdx]) : undefined })
    }
    return out
  }

  out.skipped = data.length
  out.note = 'Could not recognize the columns — file ignored'
  return out
}

// ---------- third-party JSON parsing ----------

function emptyJsonParsed(name: string, note: string): ParsedFile {
  return {
    file: name,
    kind: 'unknown',
    episodes: [],
    follows: [],
    movies: [],
    emotions: [],
    shows: [],
    primary: false,
    totalRows: 0,
    skipped: 0,
    note,
  }
}

interface RawId {
  tvdb?: number | string | null
  imdb?: number | string | null
}

function idStr(v: number | string | null | undefined): string | undefined {
  if (v == null) return undefined
  const t = String(v).trim()
  return t && t !== '0' ? t : undefined
}

/** Shape-detect a third-party series export: array of shows with seasons/episodes. */
function looksLikeSeriesJson(arr: unknown[]): boolean {
  return arr.some(
    (x) =>
      x != null &&
      typeof x === 'object' &&
      Array.isArray((x as Record<string, unknown>).seasons) &&
      typeof (x as Record<string, unknown>).title === 'string',
  )
}

/** Shape-detect a third-party movies export: array with is_watched + title. */
function looksLikeMoviesJson(arr: unknown[]): boolean {
  return arr.some(
    (x) =>
      x != null &&
      typeof x === 'object' &&
      'is_watched' in (x as Record<string, unknown>) &&
      typeof (x as Record<string, unknown>).title === 'string' &&
      !Array.isArray((x as Record<string, unknown>).seasons),
  )
}

/**
 * Parse a third-party TV Time JSON export (series or movies). Auto-detects the
 * shape. Pure and exported for the same reason parseCsvText is: unit-testable
 * without a File. The richer per-show/movie metadata (ids, status, favorite,
 * dates) makes JSON the PRIMARY source when merged with the official CSVs.
 */
export function parseJsonText(name: string, text: string): ParsedFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return emptyJsonParsed(name, 'Not valid JSON — ignored')
  }
  if (!Array.isArray(data)) {
    return emptyJsonParsed(name, 'Unexpected JSON shape — expected an array')
  }

  if (looksLikeSeriesJson(data)) {
    const out = emptyJsonParsed(name, undefined as unknown as string)
    out.kind = 'third-party series JSON'
    out.primary = true
    out.totalRows = data.length
    for (const rawShow of data as Record<string, unknown>[]) {
      const title = typeof rawShow.title === 'string' ? rawShow.title.trim() : ''
      if (!title) {
        out.skipped++
        continue
      }
      const id = (rawShow.id ?? {}) as RawId
      const status = String(rawShow.status ?? '')
      const show: ImportedShow = {
        name: title,
        tvdbId: idStr(id.tvdb),
        episodes: [],
        favorite: rawShow.is_favorite === true || undefined,
        paused: status === 'stopped' || undefined,
        watchLater: status === 'watch_later' || undefined,
      }
      const seasons = Array.isArray(rawShow.seasons) ? rawShow.seasons : []
      for (const rawSeason of seasons as Record<string, unknown>[]) {
        const season = Number(rawSeason.number)
        if (!Number.isFinite(season)) continue
        const episodes = Array.isArray(rawSeason.episodes) ? rawSeason.episodes : []
        for (const rawEp of episodes as Record<string, unknown>[]) {
          if (rawEp.is_watched !== true) continue
          const episode = Number(rawEp.number)
          if (!Number.isFinite(episode)) continue
          show.episodes.push({
            season,
            episode,
            watchedAt: parseDateField(
              typeof rawEp.watched_at === 'string' ? rawEp.watched_at : undefined,
            ),
          })
        }
      }
      out.shows.push(show)
    }
    return out
  }

  if (looksLikeMoviesJson(data)) {
    const out = emptyJsonParsed(name, undefined as unknown as string)
    out.kind = 'third-party movies JSON'
    out.primary = true
    out.totalRows = data.length
    for (const rawMovie of data as Record<string, unknown>[]) {
      const title = typeof rawMovie.title === 'string' ? rawMovie.title.trim() : ''
      if (!title) {
        out.skipped++
        continue
      }
      const id = (rawMovie.id ?? {}) as RawId
      const imdb = idStr(id.imdb)
      const year = Number(rawMovie.year)
      out.movies.push({
        title,
        imdbId: imdb && /^tt\d+$/i.test(imdb) ? imdb : undefined,
        tvdbId: idStr(id.tvdb),
        year: Number.isFinite(year) ? year : undefined,
        watchedAt: parseDateField(
          typeof rawMovie.watched_at === 'string' ? rawMovie.watched_at : undefined,
        ),
        watched: rawMovie.is_watched === true,
        favorite: rawMovie.is_favorite === true || undefined,
      })
    }
    return out
  }

  return emptyJsonParsed(name, 'Unrecognized JSON — not a TV Time series or movies export')
}

// ---------- merging per-file results ----------

const showKey = (name: string) => name.trim().toLowerCase()

/**
 * Merge every parsed file into one model. Third-party JSON (f.primary) is the
 * AUTHORITATIVE source for shows/episodes/movies — it carries real ids, dates,
 * favorite/status flags. The official CSVs then fill gaps: episode watch rows
 * for shows the JSON never mentioned, 'towatch' movie names not already known,
 * and — uniquely — episode_emotion rows joined by (name, season, episode).
 */
export function mergeParsedFiles(files: ParsedFile[]): TvTimeImport {
  // Shows keyed by tvdbId first, else normalized name. A name→key index lets
  // CSV/emotion rows (name only) resolve onto a JSON show that has a tvdb key.
  const shows = new Map<string, ImportedShow>()
  const nameToKey = new Map<string, string>()
  const seenEpisodes = new Map<string, Set<string>>()

  function keyForShow(name: string, tvdbId?: string): string {
    if (tvdbId) {
      const byName = nameToKey.get(showKey(name))
      // A prior name-only entry with no id: adopt it so we don't split the show.
      if (byName && !shows.get(byName)?.tvdbId) return byName
      return `tvdb:${tvdbId}`
    }
    return nameToKey.get(showKey(name)) ?? `name:${showKey(name)}`
  }

  function ensureShow(name: string, tvdbId?: string): ImportedShow {
    const key = keyForShow(name, tvdbId)
    let show = shows.get(key)
    if (!show) {
      show = { name, tvdbId, episodes: [] }
      shows.set(key, show)
      seenEpisodes.set(key, new Set())
    }
    if (!show.tvdbId && tvdbId) show.tvdbId = tvdbId
    nameToKey.set(showKey(name), key)
    return show
  }

  function addEpisode(show: ImportedShow, ep: ImportedEpisode) {
    const setKey = show.tvdbId ? `tvdb:${show.tvdbId}` : `name:${showKey(show.name)}`
    let seen = seenEpisodes.get(setKey)
    if (!seen) {
      seen = new Set()
      seenEpisodes.set(setKey, seen)
    }
    const epKey = `${ep.season}:${ep.episode}`
    const existingIdx = seen.has(epKey)
    if (existingIdx) {
      // Prefer a dated record over an undated duplicate.
      if (ep.watchedAt) {
        const prior = show.episodes.find((e) => e.season === ep.season && e.episode === ep.episode)
        if (prior && !prior.watchedAt) prior.watchedAt = ep.watchedAt
      }
      return
    }
    seen.add(epKey)
    show.episodes.push({ season: ep.season, episode: ep.episode, watchedAt: ep.watchedAt })
  }

  // watch_later shows become watchlist entries, not follows.
  const watchLaterShows = new Map<string, ImportedShow>()

  // 1) PRIMARY: third-party series JSON — full show records.
  for (const f of files) {
    if (!f.primary) continue
    for (const s of f.shows) {
      // A "watch later" show is watchlist-only ONLY when nothing has been
      // watched. If it carries watched episodes the flag is stale (TV Time
      // exports e.g. a 96-episode Attack on Titan as watch_later) — import it
      // as a real tracked show, and keep it OUT of watchLaterShows so its
      // episodes aren't later suppressed from the official CSV on merge.
      if (s.watchLater && s.episodes.length === 0) {
        watchLaterShows.set(showKey(s.name), s)
        continue
      }
      const show = ensureShow(s.name, s.tvdbId)
      if (s.favorite) show.favorite = true
      if (s.paused) show.paused = true
      for (const ep of s.episodes) addEpisode(show, ep)
    }
  }

  // watch_later shows must stay watchlist-only: official CSV rows (episode
  // history, follows) for them would otherwise recreate a tracked show.
  const watchLaterTvdb = new Set(
    [...watchLaterShows.values()].map((s) => s.tvdbId).filter((id): id is string => !!id),
  )
  const isWatchLater = (name: string, tvdbId?: string) =>
    watchLaterShows.has(showKey(name)) || (!!tvdbId && watchLaterTvdb.has(tvdbId))

  // 2) GAP FILL: loose episode rows (official history) for shows JSON may miss.
  for (const f of files) {
    for (const ep of f.episodes) {
      if (isWatchLater(ep.show, ep.tvdbId)) continue
      const show = ensureShow(ep.show, ep.tvdbId)
      addEpisode(show, { season: ep.season, episode: ep.episode, watchedAt: ep.watchedAt })
    }
  }

  // 3) EMOTIONS: join episode_emotion rows by (show name, season, episode).
  for (const f of files) {
    for (const em of f.emotions) {
      const key = nameToKey.get(showKey(em.show))
      const show = key ? shows.get(key) : undefined
      if (!show) continue // name-based join may drop shows absent from the merge
      if (!show.emotions) show.emotions = []
      if (show.emotions.some((e) => e.season === em.season && e.episode === em.episode)) continue
      show.emotions.push({ season: em.season, episode: em.episode, emotion: em.emotion })
    }
  }

  // Follows enrich existing shows or become "followed only".
  const followedOnly = new Map<string, ImportedFollow>()
  for (const f of files) {
    for (const fo of f.follows) {
      if (isWatchLater(fo.name, fo.tvdbId)) continue
      const key = nameToKey.get(showKey(fo.name))
      const tracked = key ? shows.get(key) : undefined
      if (tracked) {
        if (!tracked.tvdbId && fo.tvdbId) tracked.tvdbId = fo.tvdbId
        continue
      }
      const existing = followedOnly.get(showKey(fo.name))
      if (existing) {
        if (!existing.tvdbId && fo.tvdbId) existing.tvdbId = fo.tvdbId
      } else {
        followedOnly.set(showKey(fo.name), { ...fo })
      }
    }
  }

  // Movies: JSON primary, then CSV fills. Dedupe by imdbId, else title+year.
  // Movies dedupe by imdbId first, then normalized title+year. Because JSON
  // movies carry imdb ids while the official CSV has title only, we also index
  // every stored movie by its normalized title so a title-only CSV row resolves
  // onto the existing imdb-keyed JSON movie instead of creating a duplicate.
  const titleKey = (m: ImportedMovie) => `t:${m.title.trim().toLowerCase()}|${m.year ?? ''}`
  const titleKeyLoose = (m: ImportedMovie) => `tl:${m.title.trim().toLowerCase()}`
  const watched = new Map<string, ImportedMovie>()
  const watchlist = new Map<string, ImportedMovie>()
  // canonical key (imdb or title+year) for each movie already stored, indexed
  // by every alias so later rows can find it.
  const movieAlias = new Map<string, string>()

  function resolveMovie(store: Map<string, ImportedMovie>, m: ImportedMovie): string | undefined {
    let key: string | undefined
    if (m.imdbId) {
      // A movie with its own imdb id is identified by that id alone. Falling
      // back to a title match here would wrongly collapse distinct same-title
      // films (e.g. Aladdin 1993 vs 2019, each with its own imdb id).
      key = movieAlias.get(`id:${m.imdbId.toLowerCase()}`)
    } else {
      // Title-only row (official CSV): match exact title+year, else loose title
      // so it can attach to an existing imdb-keyed JSON movie.
      key = movieAlias.get(titleKey(m)) ?? movieAlias.get(titleKeyLoose(m))
    }
    // The alias map is shared between the watched and watchlist stores, so the
    // canonical key may belong to the OTHER store — only report a match the
    // target store actually contains.
    return key != null && store.has(key) ? key : undefined
  }
  function indexMovie(canonical: string, m: ImportedMovie) {
    if (m.imdbId) movieAlias.set(`id:${m.imdbId.toLowerCase()}`, canonical)
    movieAlias.set(titleKey(m), canonical)
    movieAlias.set(titleKeyLoose(m), canonical)
  }

  // Whether any primary (JSON) movies export exists. When it does it is the
  // AUTHORITATIVE, complete set of watched movies, so official CSV watch rows
  // only enrich matches (they never add new watched entries — a CSV-only title
  // is a name variant of a JSON movie, not a genuinely missing film). Without a
  // JSON movies file, CSV watch rows are all we have, so they may add.
  const hasPrimaryMovies = files.some((f) => f.primary && f.movies.length > 0)

  // Primary (JSON) first so its ids/dates/favorite win.
  const orderedMovieFiles = [...files.filter((f) => f.primary), ...files.filter((f) => !f.primary)]
  for (const f of orderedMovieFiles) {
    for (const m of f.movies) {
      if (m.watched) {
        let key = resolveMovie(watched, m)
        if (key) {
          const existing = watched.get(key)!
          if (!existing.watchedAt && m.watchedAt) existing.watchedAt = m.watchedAt
          if (!existing.imdbId && m.imdbId) existing.imdbId = m.imdbId
          if (!existing.tvdbId && m.tvdbId) existing.tvdbId = m.tvdbId
          if (existing.favorite == null && m.favorite) existing.favorite = true
          indexMovie(key, m) // learn the new alias (e.g. imdb id)
        } else if (f.primary || !hasPrimaryMovies) {
          key = m.imdbId ? `id:${m.imdbId.toLowerCase()}` : titleKey(m)
          watched.set(key, { ...m })
          indexMovie(key, m)
        }
        // A movie recorded as watched supersedes any watchlist entry for the
        // same title. But a CSV watch row that did NOT land in `watched`
        // (authoritative JSON says the movie is unwatched now) must leave the
        // watchlist entry alone.
        if (key) {
          const wlKey = resolveMovie(watchlist, m)
          if (wlKey) watchlist.delete(wlKey)
        }
      } else {
        // Unwatched: only add if not already watched or already listed.
        if (resolveMovie(watched, m)) continue
        if (resolveMovie(watchlist, m)) continue
        const canonical = m.imdbId ? `id:${m.imdbId.toLowerCase()}` : titleKey(m)
        watchlist.set(canonical, { ...m })
        indexMovie(canonical, m)
      }
    }
  }

  // watch_later shows join the movie/show watchlist as show entries.
  for (const s of watchLaterShows.values()) {
    const key = `show:${s.tvdbId ?? showKey(s.name)}`
    watchlist.set(key, { title: s.name, tvdbId: s.tvdbId, watched: false })
  }

  return {
    shows: [...shows.values()].sort((a, b) => b.episodes.length - a.episodes.length),
    followedOnly: [...followedOnly.values()].sort((a, b) => a.name.localeCompare(b.name)),
    movies: [...watched.values()].sort((a, b) => a.title.localeCompare(b.title)),
    watchlistMovies: [...watchlist.values()].sort((a, b) => a.title.localeCompare(b.title)),
    diagnostics: files.map((f) => ({
      file: f.file,
      detectedAs: f.kind,
      rows: f.totalRows,
      skipped: f.skipped,
      note: f.note,
      episodes: f.episodes.length + f.shows.reduce((n, s) => n + s.episodes.length, 0),
      movies: f.movies.filter((m) => m.watched).length,
      watchlist:
        f.movies.filter((m) => !m.watched).length +
        f.shows.filter((s) => s.watchLater && s.episodes.length === 0).length,
      shows:
        f.shows.filter((s) => !s.watchLater || s.episodes.length > 0).length + f.follows.length,
      emotions: f.emotions.length,
    })),
  }
}

// ---------- File / ZIP entry point ----------

function emptyParsed(file: string, note: string): ParsedFile {
  return {
    file,
    kind: 'unknown',
    episodes: [],
    follows: [],
    movies: [],
    emotions: [],
    shows: [],
    primary: false,
    totalRows: 0,
    skipped: 0,
    note,
  }
}

/** Parse dropped files (.zip archives and/or loose .csv/.json files) into one merged model. */
export async function parseExportFiles(files: File[]): Promise<TvTimeImport> {
  const parsed: ParsedFile[] = []
  for (const file of files) {
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.zip') || file.type.includes('zip')) {
      try {
        const zip = await JSZip.loadAsync(await file.arrayBuffer())
        const entries = Object.values(zip.files).filter(
          (e) => !e.dir && /\.(csv|json)$/i.test(e.name),
        )
        if (entries.length === 0) {
          parsed.push(emptyParsed(file.name, 'No CSV or JSON files inside this ZIP'))
          continue
        }
        for (const entry of entries) {
          const text = await entry.async('string')
          parsed.push(
            entry.name.toLowerCase().endsWith('.json')
              ? parseJsonText(entry.name, text)
              : parseCsvText(entry.name, text),
          )
        }
      } catch {
        parsed.push(emptyParsed(file.name, 'Could not open this ZIP archive'))
      }
    } else if (lower.endsWith('.json') || file.type === 'application/json') {
      parsed.push(parseJsonText(file.name, await file.text()))
    } else if (lower.endsWith('.csv') || file.type === 'text/csv') {
      parsed.push(parseCsvText(file.name, await file.text()))
    } else {
      parsed.push(emptyParsed(file.name, 'Not a ZIP, CSV or JSON — ignored'))
    }
  }
  return mergeParsedFiles(parsed)
}
