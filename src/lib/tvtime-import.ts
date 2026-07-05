// TV Time GDPR-export parsing for the /migrate wizard.
//
// The export is a ZIP of CSV files whose names and columns vary between
// export generations, so nothing here hardcodes filenames: each CSV is
// classified from its headers (episode history / followed shows / movies)
// and rows are normalized into one merged model the wizard can map to TMDB.

import JSZip from 'jszip'

// ---------- normalized model ----------

export interface ImportedEpisode {
  season: number
  episode: number
  watchedAt?: string // ISO
}

export interface ImportedShow {
  name: string
  tvdbId?: string
  episodes: ImportedEpisode[]
}

export interface ImportedFollow {
  name: string
  tvdbId?: string
}

export interface ImportedMovie {
  title: string
  imdbId?: string
  watchedAt?: string // ISO
}

export type DetectedKind = 'episode-history' | 'followed-shows' | 'movies' | 'unknown'

export interface FileDiagnostic {
  file: string
  detectedAs: DetectedKind
  rows: number
  skipped: number
  note?: string
}

export interface TvTimeImport {
  shows: ImportedShow[]
  followedOnly: ImportedFollow[]
  movies: ImportedMovie[]
  diagnostics: FileDiagnostic[]
}

/** Per-file intermediate result (also the unit reviewers can test). */
export interface ParsedFile {
  file: string
  kind: DetectedKind
  episodes: { show: string; tvdbId?: string; season: number; episode: number; watchedAt?: string }[]
  follows: ImportedFollow[]
  movies: ImportedMovie[]
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
    (h) => h.includes('tvdb') || h.includes('seriesid') || h.includes('showid'),
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

  const nameIdx = findShowNameIdx(headers)
  const seasonIdx = findSeasonIdx(headers, words)
  let epIdx = findEpisodeNumberIdx(headers, words)
  if (seasonIdx >= 0 && epIdx < 0) {
    // With a season column present, a bare "episode" column is the number.
    epIdx = findIdx(headers, (h) => h === 'episode')
  }
  const tvdbIdx = findTvdbIdx(headers)
  const dateIdx = findDateIdx(headers)

  // --- episode history: structured season+episode columns ---
  if (nameIdx >= 0 && seasonIdx >= 0 && epIdx >= 0) {
    out.kind = 'episode-history'
    for (const r of data) {
      const show = r[nameIdx]?.trim()
      const season = parseIntField(r[seasonIdx])
      const episode = parseIntField(r[epIdx])
      if (!show || season == null || episode == null || season <= 0 || episode <= 0) {
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
  const fileLower = name.toLowerCase()
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
    headers.some((h) => h.includes('series') || h.includes('show'))

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
      })
    }
    return out
  }

  if (nameIdx >= 0 && (showish || !movieish)) {
    out.kind = 'followed-shows'
    if (!showish) out.note = 'Assumed followed shows (name column, no episode columns)'
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

// ---------- merging per-file results ----------

export function mergeParsedFiles(files: ParsedFile[]): TvTimeImport {
  const shows = new Map<string, ImportedShow>()
  const seenEpisodes = new Map<string, Set<string>>()

  const showKey = (name: string) => name.trim().toLowerCase()

  for (const f of files) {
    for (const ep of f.episodes) {
      const key = showKey(ep.show)
      let show = shows.get(key)
      if (!show) {
        show = { name: ep.show, episodes: [] }
        shows.set(key, show)
        seenEpisodes.set(key, new Set())
      }
      if (!show.tvdbId && ep.tvdbId) show.tvdbId = ep.tvdbId
      const epKey = `${ep.season}:${ep.episode}`
      const seen = seenEpisodes.get(key)!
      if (seen.has(epKey)) continue
      seen.add(epKey)
      show.episodes.push({ season: ep.season, episode: ep.episode, watchedAt: ep.watchedAt })
    }
  }

  // Follows that already have episode history just enrich the show entry;
  // the rest become "followed only".
  const followedOnly = new Map<string, ImportedFollow>()
  for (const f of files) {
    for (const fo of f.follows) {
      const key = showKey(fo.name)
      const tracked = shows.get(key)
      if (tracked) {
        if (!tracked.tvdbId && fo.tvdbId) tracked.tvdbId = fo.tvdbId
        continue
      }
      const existing = followedOnly.get(key)
      if (existing) {
        if (!existing.tvdbId && fo.tvdbId) existing.tvdbId = fo.tvdbId
      } else {
        followedOnly.set(key, { ...fo })
      }
    }
  }

  const movies = new Map<string, ImportedMovie>()
  for (const f of files) {
    for (const m of f.movies) {
      const key = m.imdbId ? `id:${m.imdbId.toLowerCase()}` : `t:${m.title.trim().toLowerCase()}`
      const existing = movies.get(key)
      if (existing) {
        if (!existing.watchedAt && m.watchedAt) existing.watchedAt = m.watchedAt
      } else {
        movies.set(key, { ...m })
      }
    }
  }

  return {
    shows: [...shows.values()].sort((a, b) => b.episodes.length - a.episodes.length),
    followedOnly: [...followedOnly.values()].sort((a, b) => a.name.localeCompare(b.name)),
    movies: [...movies.values()].sort((a, b) => a.title.localeCompare(b.title)),
    diagnostics: files.map((f) => ({
      file: f.file,
      detectedAs: f.kind,
      rows: f.totalRows,
      skipped: f.skipped,
      note: f.note,
    })),
  }
}

// ---------- File / ZIP entry point ----------

function emptyParsed(file: string, note: string): ParsedFile {
  return { file, kind: 'unknown', episodes: [], follows: [], movies: [], totalRows: 0, skipped: 0, note }
}

/** Parse dropped files (.zip archives and/or loose .csv files) into one merged model. */
export async function parseExportFiles(files: File[]): Promise<TvTimeImport> {
  const parsed: ParsedFile[] = []
  for (const file of files) {
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.zip') || file.type.includes('zip')) {
      try {
        const zip = await JSZip.loadAsync(await file.arrayBuffer())
        const entries = Object.values(zip.files).filter(
          (e) => !e.dir && e.name.toLowerCase().endsWith('.csv'),
        )
        if (entries.length === 0) {
          parsed.push(emptyParsed(file.name, 'No CSV files inside this ZIP'))
          continue
        }
        for (const entry of entries) {
          parsed.push(parseCsvText(entry.name, await entry.async('string')))
        }
      } catch {
        parsed.push(emptyParsed(file.name, 'Could not open this ZIP archive'))
      }
    } else if (lower.endsWith('.csv') || file.type === 'text/csv') {
      parsed.push(parseCsvText(file.name, await file.text()))
    } else {
      parsed.push(emptyParsed(file.name, 'Not a ZIP or CSV — ignored'))
    }
  }
  return mergeParsedFiles(parsed)
}
