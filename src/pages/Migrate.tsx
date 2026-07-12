// TV Time migration wizard: parse the official GDPR export (ZIP/CSVs) and/or
// the third-party JSON files, preview a per-source breakdown, then map
// everything to TMDB and merge into the library via bulkImport.

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { MediaType, MovieDetail, ShowDetail } from '../types'
import {
  findByExternalId,
  getMovieDetail,
  getShowDetail,
  isDemoMode,
  searchMulti,
} from '../api/tmdb'
import { useLibrary } from '../store/library'
import { reviveNextLibraryChange } from '../store/sync'
import { supabase } from '../api/supabase'
import { displayIdentity } from '../lib/admin'
import { BackBar } from '../components/BackBar'
import { IMPORTED_KEY } from '../components/MigratePrompt'
import { ErrorBox, LoadingSpinner, ProgressBar } from '../components/shared'
import { showToast } from '../components/toast'
import type {
  DetectedKind,
  ImportedMovie,
  ImportedShow,
  TvTimeImport,
} from '../lib/tvtime-import'
import { parseExportFiles } from '../lib/tvtime-import'
import { directImportAvailable, runDirectImport, type DirectProgress } from '../lib/tvtime-direct'
import './migrate.css'

const STEPS = ['Get your export', 'Upload', 'Preview', 'Import', 'Done'] as const

const LOOKUP_GAP_MS = 250

// The demo-mode warning promises the parsed export survives a trip to
// Settings (which reloads the page after saving a TMDB key), so the parsed
// model is kept in sessionStorage — it outlives both the SPA navigation and
// the reload, but not the tab.
const PENDING_IMPORT_KEY = 'showtrackr_migrate_pending'

// ---------------------------------------------------------------------------
// Contract with the parser (src/lib/tvtime-import.ts). We consume its exported
// types directly. The wizard's own derived shapes:
//
//  • Watchlist entries all arrive in the parser's `watchlistMovies` array:
//    to-watch movies AND watch-later *shows* (the parser folds watch-later
//    shows in as entries carrying a tvdbId). They're resolved to TMDB ids here
//    (the parser can't) and fed to bulkImport.watchlist. Because the array
//    doesn't discriminate movie vs. show, an entry with a real imdb id ("tt…")
//    is treated as a movie and everything else is resolved via its tvdb id,
//    honoring whatever media_type TMDB returns.
//  • The parser tags each file with a DetectedKind in `diagnostics`; the
//    per-source breakdown card is aggregated from those tags (there is no
//    separate `sources` array on the model).
// ---------------------------------------------------------------------------

/** A watchlist ("to watch") entry, before it's resolved to a TMDB id. */
interface WatchlistCandidate {
  /** 'unknown' = movie-vs-show ambiguous; the resolver honors TMDB's answer. */
  type: MediaType | 'unknown'
  name: string
  tvdbId?: string
  imdbId?: string
}

/** Movies the user wants to watch but hasn't. Missing on older parser builds. */
function watchlistMoviesOf(model: TvTimeImport): ImportedMovie[] {
  return (model as { watchlistMovies?: ImportedMovie[] }).watchlistMovies ?? []
}

/** All watchlist candidates from the parser's `watchlistMovies` bucket. */
function watchlistCandidates(model: TvTimeImport): WatchlistCandidate[] {
  return watchlistMoviesOf(model).map((m) => ({
    // A real imdb id is a strong movie signal; otherwise leave it ambiguous.
    type: m.imdbId ? ('movie' as const) : ('unknown' as const),
    name: m.title,
    tvdbId: m.tvdbId,
    imdbId: m.imdbId,
  }))
}

/** Shows that actually import as tracked shows (everything except watch-later). */
function trackableShows(model: TvTimeImport): ImportedShow[] {
  return model.shows.filter((s) => !s.watchLater)
}

/** Total emotion reactions across all shows. */
/**
 * Pre-flight data check, shown on the preview step — the same verification
 * run on the first real migration: date coverage decides whether history
 * ordering will be exact, and the per-show last-watch dates preview what
 * "Keep watching" will look like after the import.
 */
function preflightOf(model: TvTimeImport): {
  dated: number
  undated: number
  top: { name: string; last: string }[]
} {
  let dated = 0
  let undated = 0
  const tops: { name: string; last: string }[] = []
  for (const s of trackableShows(model)) {
    let last = ''
    for (const ep of s.episodes) {
      if (ep.watchedAt) {
        dated++
        if (ep.watchedAt > last) last = ep.watchedAt
      } else {
        undated++
      }
    }
    if (last) tops.push({ name: s.name, last })
  }
  tops.sort((a, b) => (a.last < b.last ? 1 : -1))
  return { dated, undated, top: tops.slice(0, 5) }
}

function totalEmotionsOf(model: TvTimeImport): number {
  return model.shows.reduce((sum, s) => sum + (s.emotions?.length ?? 0), 0)
}

/** A grouped per-source breakdown row for the preview card. */
interface SourceRow {
  label: string
  emoji: string
  files: number
  episodes: number
  movies: number
  shows: number
  emotions: number
  watchlist: number
}

/** Which source bucket a detected file kind belongs to. */
function sourceBucket(kind: DetectedKind): { key: string; label: string; emoji: string } | null {
  switch (kind) {
    case 'third-party series JSON':
    case 'third-party movies JSON':
      return { key: 'third-party', label: 'Third-party JSON', emoji: '📄' }
    case 'official episode history':
    case 'official watch/watchlist records':
    case 'official followed shows':
    case 'episode emotions':
    case 'episode-history':
    case 'followed-shows':
    case 'movies':
      return { key: 'official', label: 'Official GDPR ZIP', emoji: '🗜️' }
    default:
      return null
  }
}

/**
 * Aggregate the per-file diagnostics into at most one row per source (official
 * ZIP vs third-party JSON), summing what each contributed. Purely descriptive
 * — the merged totals shown alongside are the source of truth for the import.
 */
function sourceRows(model: TvTimeImport): SourceRow[] {
  const rows = new Map<string, SourceRow>()
  for (const d of model.diagnostics) {
    const bucket = sourceBucket(d.detectedAs)
    if (!bucket) continue
    let row = rows.get(bucket.key)
    if (!row) {
      row = {
        label: bucket.label,
        emoji: bucket.emoji,
        files: 0,
        episodes: 0,
        movies: 0,
        shows: 0,
        emotions: 0,
        watchlist: 0,
      }
      rows.set(bucket.key, row)
    }
    row.files++
    // Sum what each file actually yielded — raw row counts include skipped
    // rows (and, for the official records table, thousands of non-movie
    // tracking rows), which would wildly inflate the card.
    row.episodes += d.episodes ?? 0
    row.movies += d.movies ?? 0
    row.shows += d.shows ?? 0
    row.emotions += d.emotions ?? 0
    row.watchlist += d.watchlist ?? 0
  }
  // Third-party first (the richer, authoritative source).
  return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label))
}

function loadPendingImport(): TvTimeImport | null {
  try {
    const raw = sessionStorage.getItem(PENDING_IMPORT_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as TvTimeImport
    if (
      !Array.isArray(v.shows) ||
      !Array.isArray(v.followedOnly) ||
      !Array.isArray(v.movies) ||
      !Array.isArray(v.diagnostics)
    ) {
      return null
    }
    return v
  } catch {
    return null
  }
}

function savePendingImport(model: TvTimeImport | null) {
  try {
    if (model) sessionStorage.setItem(PENDING_IMPORT_KEY, JSON.stringify(model))
    else sessionStorage.removeItem(PENDING_IMPORT_KEY)
  } catch {
    // Storage full or unavailable — the wizard still works, it just won't
    // survive a reload.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Loose name comparison: case/punctuation-insensitive. */
function looseName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function fmt(n: number): string {
  return n.toLocaleString()
}

interface ImportResult {
  showsAdded: number
  episodesMarked: number
  moviesAdded: number
  watchlistAdded: number
  emotionsApplied: number
}

// ---------------------------------------------------------------------------
// "Who is importing" identity (Supabase auth).
// ---------------------------------------------------------------------------

type Identity =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'signed-in'; name: string }
  | { state: 'no-sync' } // app built without Supabase — local-only, no account concept

function useImportIdentity(): Identity {
  const [identity, setIdentity] = useState<Identity>(() =>
    supabase ? { state: 'loading' } : { state: 'no-sync' },
  )

  useEffect(() => {
    if (!supabase) return
    let alive = true
    void supabase.auth.getUser().then(({ data }) => {
      if (!alive) return
      const email = data.user?.email ?? null
      setIdentity(email ? { state: 'signed-in', name: displayIdentity(email) } : { state: 'signed-out' })
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const email = session?.user?.email ?? null
      setIdentity(email ? { state: 'signed-in', name: displayIdentity(email) } : { state: 'signed-out' })
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return identity
}

/** The "Importing into: <who>" card, shown from the preview step onward. */
function IdentityCard({ identity }: { identity: Identity }) {
  if (identity.state === 'loading') {
    return (
      <div className="mig-who mig-who-loading" aria-busy="true">
        <LoadingSpinner />
        <span>Checking who&apos;s signed in…</span>
      </div>
    )
  }
  if (identity.state === 'signed-in') {
    return (
      <div className="mig-who mig-who-ok">
        <span className="mig-who-icon" aria-hidden>
          👤
        </span>
        <div className="mig-who-text">
          <div className="mig-who-main">
            Importing into: <b>{identity.name}</b>
          </div>
          <div className="mig-who-sub">Syncs to all their devices.</div>
        </div>
      </div>
    )
  }
  // signed-out and no-sync both mean "this lands on THIS device only".
  return (
    <div className="mig-who mig-who-warn" role="alert">
      <span className="mig-who-icon" aria-hidden>
        ⚠️
      </span>
      <div className="mig-who-text">
        <div className="mig-who-main">
          Not signed in — the import lands on <b>THIS DEVICE only</b> until you sign in.
        </div>
        <div className="mig-who-sub">
          Each member signs in first, then imports, so their progress follows them everywhere.{' '}
          {identity.state === 'signed-out' && <Link to="/account">Sign in →</Link>}
        </div>
      </div>
    </div>
  )
}

export default function Migrate() {
  const navigate = useNavigate()
  const demo = isDemoMode()
  const identity = useImportIdentity()

  // Restore a previously parsed export (e.g. after adding a TMDB key in
  // Settings, which reloads the app) and jump straight back to the preview.
  const [parsed, setParsed] = useState<TvTimeImport | null>(loadPendingImport)
  const [step, setStep] = useState(() => {
    const p = loadPendingImport()
    const found =
      p !== null && (p.shows.length > 0 || p.followedOnly.length > 0 || p.movies.length > 0)
    return found ? 2 : 0 // index into STEPS
  })
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' })
  const [result, setResult] = useState<ImportResult | null>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const cancelRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step-0 acquisition source: null = picker, 'direct' = TV Time sign-in,
  // 'file' = the export-file guide. TV Time Direct pulls the live library via
  // the tvtime-direct edge function; the file path is the frozen-export fallback.
  const [source, setSource] = useState<null | 'direct' | 'file'>(null)
  const [ttUser, setTtUser] = useState('')
  const [ttPass, setTtPass] = useState('')
  const [direct, setDirect] = useState<
    | { state: 'form' }
    | { state: 'running'; phase: DirectProgress['phase']; done: number; total: number }
    | { state: 'error'; message: string }
  >({ state: 'form' })

  async function runDirect(e: React.FormEvent) {
    e.preventDefault()
    if (!ttUser.trim() || !ttPass) return
    cancelRef.current = false
    setDirect({ state: 'running', phase: 'login', done: 0, total: 1 })
    const res = await runDirectImport(
      { username: ttUser.trim(), password: ttPass },
      (p) => setDirect({ state: 'running', phase: p.phase, done: p.done, total: p.total }),
      cancelRef,
    )
    setTtPass('') // never keep the password around after the attempt
    if (!res.ok) {
      const message =
        res.kind === 'function-missing'
          ? "Couldn't reach the import service — use a file export instead."
          : res.code === 'bad-credentials'
            ? "TV Time didn't accept that email or password."
            : res.code === 'blocked'
              ? "TV Time's servers blocked the request — use a file export instead."
              : res.message || 'Something went wrong — use a file export instead.'
      setDirect({ state: 'error', message })
      return
    }
    const model = res.data
    const found =
      model.shows.length > 0 || model.followedOnly.length > 0 || model.movies.length > 0
    if (!found) {
      setDirect({ state: 'error', message: 'No watch history came back from TV Time.' })
      return
    }
    setParsed(model)
    savePendingImport(model)
    showToast('Fetched your TV Time history', '📥')
    setDirect({ state: 'form' })
    setStep(2)
  }

  // Navigating away must cancel a running import: the loop would otherwise
  // keep hitting TMDB invisibly, and a remount (sessionStorage still holds the
  // parsed export) would show an enabled "Start import" that races the orphan
  // run — the orphan's bulkImport lands first and the mounted run reports
  // "Imported 0 shows, 0 episodes, 0 movies" for a successful import.
  useEffect(() => {
    return () => {
      cancelRef.current = true
    }
  }, [])

  // Derived views over the parsed model (parser owns the raw shapes).
  const shownShows = parsed ? trackableShows(parsed) : []
  const totalEpisodes = shownShows.reduce((sum, s) => sum + s.episodes.length, 0)
  const totalEmotions = parsed ? totalEmotionsOf(parsed) : 0
  const watchlist = parsed ? watchlistCandidates(parsed) : []
  const sources = parsed ? sourceRows(parsed) : []
  const nothingFound =
    parsed !== null &&
    shownShows.length === 0 &&
    parsed.followedOnly.length === 0 &&
    parsed.movies.length === 0 &&
    watchlist.length === 0

  async function handleFiles(fileList: FileList | null) {
    const files = fileList ? [...fileList] : []
    if (files.length === 0) return
    setParsing(true)
    setParseError(null)
    setParsed(null)
    try {
      const model = await parseExportFiles(files)
      setParsed(model)
      const found =
        model.shows.length > 0 ||
        model.followedOnly.length > 0 ||
        model.movies.length > 0 ||
        watchlistCandidates(model).length > 0
      savePendingImport(found ? model : null)
      if (found) {
        showToast(
          `Parsed ${model.diagnostics.length} file${model.diagnostics.length === 1 ? '' : 's'}`,
          '📦',
        )
        setStep(2)
      }
    } catch {
      setParseError(
        'Could not read those files — drop the TV Time GDPR ZIP, the third-party JSON exports, or the CSVs inside the ZIP.',
      )
    } finally {
      setParsing(false)
    }
  }

  async function runImport() {
    if (!parsed || demo) return
    cancelRef.current = false
    setStep(3)
    setUnmatched([])

    // Trackable shows (everything except watch-later) plus followed-but-
    // unwatched shows, which import as shows with no watched episodes. Watch-
    // later shows are handled below as watchlist entries instead.
    const showQueue: ImportedShow[] = [
      ...trackableShows(parsed),
      ...parsed.followedOnly.map((f) => ({ name: f.name, tvdbId: f.tvdbId, episodes: [] })),
    ]
    const wl = watchlistCandidates(parsed)
    const total = showQueue.length + parsed.movies.length + wl.length
    const showPayload: {
      detail: ShowDetail
      watched: { season: number; episode: number; watchedAt?: string }[]
      favorite?: boolean
      paused?: boolean
      emotions?: ImportedShow['emotions']
    }[] = []
    const moviePayload: { detail: MovieDetail; watchedAt?: string | null; favorite?: boolean }[] = []
    const watchlistPayload: { type: MediaType; id: number; name: string; poster_path: string | null }[] =
      []
    const missed: string[] = []
    let done = 0

    // Sequential with a small gap between TMDB lookups; state updates every
    // iteration keep the UI live even for thousands of rows.
    for (const show of showQueue) {
      if (cancelRef.current) break
      setProgress({ done, total, current: show.name })
      try {
        let tmdbId: number | null = null
        if (show.tvdbId) {
          const hit = await findByExternalId(show.tvdbId, 'tvdb_id')
          if (hit && hit.media_type === 'tv') tmdbId = hit.id
        }
        if (tmdbId == null) {
          const results = (await searchMulti(show.name)).filter((r) => r.media_type === 'tv')
          const exact = results.find((r) => looseName(r.name) === looseName(show.name))
          tmdbId = (exact ?? results[0])?.id ?? null
        }
        if (tmdbId == null) {
          missed.push(show.name)
        } else {
          const detail = await getShowDetail(tmdbId)
          showPayload.push({
            detail,
            watched: show.episodes,
            favorite: show.favorite,
            paused: show.paused,
            emotions: show.emotions,
          })
        }
      } catch {
        missed.push(show.name)
      }
      done++
      setProgress({ done, total, current: show.name })
      await delay(LOOKUP_GAP_MS)
    }

    for (const movie of parsed.movies) {
      if (cancelRef.current) break
      setProgress({ done, total, current: movie.title })
      try {
        let tmdbId: number | null = null
        if (movie.imdbId) {
          const hit = await findByExternalId(movie.imdbId, 'imdb_id')
          if (hit && hit.media_type === 'movie') tmdbId = hit.id
        }
        if (tmdbId == null) {
          const results = (await searchMulti(movie.title)).filter((r) => r.media_type === 'movie')
          const exact = results.find((r) => looseName(r.name) === looseName(movie.title))
          tmdbId = (exact ?? results[0])?.id ?? null
        }
        if (tmdbId == null) {
          missed.push(movie.title)
        } else {
          const detail = await getMovieDetail(tmdbId)
          moviePayload.push({ detail, watchedAt: movie.watchedAt ?? null, favorite: movie.favorite })
        }
      } catch {
        missed.push(movie.title)
      }
      done++
      setProgress({ done, total, current: movie.title })
      await delay(LOOKUP_GAP_MS)
    }

    // Watchlist ("to watch") entries resolve to a lightweight TMDB reference:
    // name + poster only, which is all WatchlistItem needs.
    for (const item of wl) {
      if (cancelRef.current) break
      setProgress({ done, total, current: item.name })
      try {
        let resolved: {
          type: MediaType
          id: number
          name: string
          poster_path: string | null
        } | null = null
        // 1) IMDb id → always a movie.
        if (!resolved && item.imdbId) {
          const hit = await findByExternalId(item.imdbId, 'imdb_id')
          if (hit && hit.media_type === 'movie') {
            resolved = { type: 'movie', id: hit.id, name: hit.name, poster_path: hit.poster_path }
          }
        }
        // 2) TVDB id → honor whatever media_type TMDB returns (movie or tv).
        if (!resolved && item.tvdbId) {
          const hit = await findByExternalId(item.tvdbId, 'tvdb_id')
          if (hit && (hit.media_type === 'tv' || hit.media_type === 'movie')) {
            resolved = {
              type: hit.media_type,
              id: hit.id,
              name: hit.name,
              poster_path: hit.poster_path,
            }
          }
        }
        // 3) Name search — constrained to the known type, else best of either.
        if (!resolved) {
          const results = (await searchMulti(item.name)).filter(
            (r) =>
              (r.media_type === 'tv' || r.media_type === 'movie') &&
              (item.type === 'unknown' || r.media_type === item.type),
          )
          const exact = results.find((r) => looseName(r.name) === looseName(item.name))
          const hit = exact ?? results[0]
          if (hit && (hit.media_type === 'tv' || hit.media_type === 'movie')) {
            resolved = {
              type: hit.media_type,
              id: hit.id,
              name: hit.name,
              poster_path: hit.poster_path,
            }
          }
        }
        if (!resolved) {
          missed.push(item.name)
        } else {
          watchlistPayload.push({
            type: resolved.type,
            id: resolved.id,
            name: resolved.name,
            poster_path: resolved.poster_path ?? null,
          })
        }
      } catch {
        missed.push(item.name)
      }
      done++
      setProgress({ done, total, current: item.name })
      await delay(LOOKUP_GAP_MS)
    }

    if (cancelRef.current) {
      showToast('Import cancelled — nothing was changed', '✋')
      setStep(2)
      return
    }

    // Re-run imports re-add records that may be tombstoned only in the REMOTE
    // sync meta; arm a one-shot reviveAll so every key this import (re-)adds
    // gets a fresh set-time and survives the next pullAndMerge.
    reviveNextLibraryChange()
    const counts = useLibrary.getState().bulkImport({
      shows: showPayload,
      movies: moviePayload,
      watchlist: watchlistPayload,
    })
    savePendingImport(null) // import finished — drop the stashed export
    try {
      // Suppresses the "Moving from TV Time?" first-visit prompt for good.
      localStorage.setItem(IMPORTED_KEY, '1')
    } catch {
      /* the prompt's library-size check covers this */
    }
    setResult(counts)
    setUnmatched(missed)
    setStep(4)
    showToast(
      counts.datesRepaired > 0
        ? `Imported ${counts.showsAdded} shows, ${counts.episodesMarked} episodes — and repaired ${counts.datesRepaired} watch dates`
        : `Imported ${counts.showsAdded} shows, ${counts.episodesMarked} episodes, ${counts.moviesAdded} movies`,
      '🚚',
    )
  }

  function copyUnmatched() {
    void navigator.clipboard.writeText(unmatched.join('\n'))
    showToast('Unmatched titles copied', '📋')
  }

  return (
    <div className="migrate-page">
      {/* Mid-flow the back target is an unmissable escape hatch (same
          navigate(-1) fallback); on the first step it's just "Import". */}
      <BackBar title={step > 0 && step < 4 ? 'Cancel import' : 'Import'} />
      <h1 className="page-title">Move in from TV Time</h1>
      <p className="page-subtitle">
        Bring your whole watch history — shows, episodes, movies, reactions and your watchlist —
        into Raed Tracker.
      </p>

      {/* ---- stepper ---- */}
      <ol className="mig-steps" aria-label="Import progress">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={`mig-step${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}
            aria-current={i === step ? 'step' : undefined}
          >
            <span className="mig-step-dot">{i < step ? '✓' : i + 1}</span>
            <span className="mig-step-label">{label}</span>
          </li>
        ))}
      </ol>

      {/* ================= step 1: choose a source & get your data ============ */}
      {step === 0 && (
        <section className="card mig-card">
          <div className="mig-card-title">Bring your history in from TV Time</div>

          <div className="mig-deadline" role="alert">
            ⚠️ <b>TV Time shuts down on July 15, 2026</b> — all account data is permanently
            deleted after that date. Import before then; once it&apos;s gone there is no way to
            get it back.
          </div>

          {/* ---- source picker ---- */}
          {source === null && (
            <div className="mig-picker">
              {directImportAvailable() && (
                <button
                  type="button"
                  className="mig-source"
                  onClick={() => {
                    setDirect({ state: 'form' })
                    setSource('direct')
                  }}
                >
                  <span className="mig-source-tag">Recommended · ~2 minutes · phone-friendly</span>
                  <span className="mig-source-title">Import directly from TV Time</span>
                  <span className="mig-source-desc">
                    Sign in with your TV Time account and we&apos;ll pull your whole library —
                    shows, episodes, watch dates and movies — straight over. No files, works right
                    on your phone.
                  </span>
                </button>
              )}
              <button type="button" className="mig-source" onClick={() => setSource('file')}>
                <span className="mig-source-tag">Import an export file</span>
                <span className="mig-source-title">I have an export file</span>
                <span className="mig-source-desc">
                  Already exported from TV Time? Bring the official export ZIP, or the JSON from the
                  desktop extension. This is the only path that also carries your{' '}
                  <b>reactions</b>.
                </span>
              </button>
            </div>
          )}

          {/* ---- TV Time Direct sign-in ---- */}
          {source === 'direct' && (
            <div className="mig-direct">
              {supabase && identity.state !== 'signed-in' ? (
                <>
                  <div className="mig-method">🔐 Sign in to Raed Tracker first</div>
                  <p className="mig-desc">
                    Your imported history lands in <b>your</b> library, so you need to be signed
                    into Raed Tracker before importing.
                  </p>
                  <div className="mig-actions">
                    <Link className="btn primary" to="/account">
                      Sign in →
                    </Link>
                    <button className="btn" onClick={() => setSource(null)}>
                      ← Back
                    </button>
                  </div>
                </>
              ) : direct.state === 'running' ? (
                <div className="mig-direct-running">
                  <LoadingSpinner />
                  <div className="mig-direct-phase">
                    {direct.phase === 'login' && 'Signing in to TV Time…'}
                    {direct.phase === 'movies' && 'Fetching your movies…'}
                    {direct.phase === 'shows' &&
                      `Fetching your shows… (${direct.done}/${direct.total})`}
                    {direct.phase === 'building' && 'Building your preview…'}
                  </div>
                  {direct.phase === 'shows' && direct.total > 0 && (
                    <ProgressBar value={direct.done / direct.total} />
                  )}
                  <button
                    className="btn"
                    onClick={() => {
                      cancelRef.current = true
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <form className="mig-direct-form" onSubmit={runDirect}>
                  <div className="mig-method">Sign in with your TV Time account</div>
                  {direct.state === 'error' && <ErrorBox message={direct.message} />}
                  <label className="mig-field">
                    <span>TV Time email</span>
                    <input
                      type="email"
                      autoComplete="off"
                      value={ttUser}
                      onChange={(e) => setTtUser(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </label>
                  <label className="mig-field">
                    <span>TV Time password</span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={ttPass}
                      onChange={(e) => setTtPass(e.target.value)}
                      placeholder="••••••••"
                    />
                  </label>
                  <p className="mig-privacy">
                    Sent once to TV Time through our secure relay to fetch your history — never
                    stored, never logged.
                  </p>
                  <div className="mig-actions">
                    <button className="btn primary" type="submit" disabled={!ttUser.trim() || !ttPass}>
                      Fetch my history →
                    </button>
                    <button className="btn" type="button" onClick={() => setSource(null)}>
                      ← Back
                    </button>
                  </div>
                  {direct.state === 'error' && (
                    <button className="mig-inline-btn" type="button" onClick={() => setSource('file')}>
                      Use an export file instead →
                    </button>
                  )}
                </form>
              )}
            </div>
          )}

          {/* ---- export-file guide ---- */}
          {source === 'file' && (
            <div className="mig-file">
              <div className="mig-method">
                <span className="mig-method-tag">Recommended file · phone-friendly · richest</span>
                Official TV Time export
              </div>
              <p className="mig-desc">
                This is the only export that includes your <b>reactions/emotions</b> along with
                every show, episode and watch date. It&apos;s a self-service download now — no
                waiting for an email — and works right in a phone browser.
              </p>
              <ol className="mig-instructions">
                <li>
                  Sign in at{' '}
                  <a
                    href="https://gdpr.tvtime.com/gdpr/self-service"
                    target="_blank"
                    rel="noreferrer"
                  >
                    gdpr.tvtime.com/gdpr/self-service
                  </a>{' '}
                  with your TV Time account.
                </li>
                <li>
                  Tap <b>Download</b> to save your data <b>ZIP</b>, and <b>don&apos;t unzip it</b> —
                  this page reads it directly.
                </li>
              </ol>

              <div className="mig-method">
                <span className="mig-method-tag">Desktop only · alternative</span>
                Chrome extension: TV Time Out by Refract
              </div>
              <ol className="mig-instructions">
                <li>
                  On a <b>computer with Google Chrome</b>, install{' '}
                  <a
                    href="https://chromewebstore.google.com/detail/tv-time-out-by-refract/pmejpdpjbkjklfceogdkolmgclldogbi"
                    target="_blank"
                    rel="noreferrer"
                  >
                    TV Time Out by Refract
                  </a>
                  , open{' '}
                  <a href="https://app.tvtime.com" target="_blank" rel="noreferrer">
                    app.tvtime.com
                  </a>
                  , click the extension, pick <b>JSON</b> and <b>Export my data</b>.
                </li>
                <li>
                  It reads your live library, so it captures recent changes — but it drops
                  reactions.
                </li>
              </ol>

              <p className="mig-desc">
                Bring <b>either or both</b> to the next step — they&apos;re merged automatically,
                and re-importing never creates duplicates.{' '}
                <b>You&apos;ll need to be signed in to import.</b>
              </p>

              <div className="mig-actions">
                <button className="btn primary" onClick={() => setStep(1)}>
                  I have my export →
                </button>
                <button className="btn" onClick={() => setSource(null)}>
                  ← Back
                </button>
                {identity.state === 'signed-out' && (
                  <Link className="btn" to="/account">
                    Sign in first →
                  </Link>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ================= step 2: upload (members only) ================= */}
      {step === 1 && supabase && identity.state !== 'signed-in' && (
        <section className="card mig-card">
          <div className="mig-card-title">🔐 Importing is for members</div>
          {identity.state === 'loading' ? (
            <div className="mig-who mig-who-loading" aria-busy="true">
              <LoadingSpinner />
              <span>Checking who&apos;s signed in…</span>
            </div>
          ) : (
            <>
              <p className="mig-desc">
                Sign in with your member account first, so your history lands in <b>your</b>{' '}
                library and follows you to every device. Don&apos;t have an account yet? Ask the
                person who shared this app with you.
              </p>
              <div className="mig-actions">
                <Link className="btn primary" to="/account">
                  Sign in →
                </Link>
                <button className="btn" onClick={() => setStep(0)}>
                  ← Back to the guide
                </button>
              </div>
            </>
          )}
        </section>
      )}
      {step === 1 && (!supabase || identity.state === 'signed-in') && (
        <section className="card mig-card">
          <div className="mig-card-title">📂 Upload your export</div>
          <p className="mig-desc">
            Everything is parsed locally in your browser — nothing is uploaded anywhere.
          </p>

          {parsing ? (
            <div className="mig-drop" aria-busy="true">
              <LoadingSpinner />
              <div className="mig-drop-hint">Reading your export…</div>
            </div>
          ) : (
            <div
              className={`mig-drop${dragOver ? ' drag' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="Upload TV Time export"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                void handleFiles(e.dataTransfer.files)
              }}
            >
              <div className="mig-drop-emoji">🗜️</div>
              <div className="mig-drop-main">
                Drop your TV Time exports — the official GDPR ZIP, the third-party JSON files, or
                BOTH for the richest import
              </div>
              <div className="mig-drop-hint">.zip, .json or .csv — or click to browse</div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.json,.csv,application/zip,application/json,text/csv"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              void handleFiles(e.target.files)
              e.target.value = ''
            }}
          />

          {/* Per-file detection chips (source + what it contained). */}
          {parsed && parsed.diagnostics.length > 0 && (
            <div className="mig-chips" aria-label="Detected files">
              {parsed.diagnostics.map((d) => (
                <span
                  key={d.file}
                  className={`mig-chip${d.detectedAs === 'unknown' ? ' mig-chip-muted' : ''}`}
                  title={d.note ?? undefined}
                >
                  <span className="mig-chip-file">{d.file}</span>
                  <span className="mig-chip-kind">
                    {chipDescription(d.detectedAs, d.rows)}
                  </span>
                </span>
              ))}
            </div>
          )}

          {parseError && <ErrorBox message={parseError} />}
          {nothingFound && parsed && (
            <>
              <ErrorBox message="No TV Time data recognized in those files — check you dropped the export ZIP, the JSON exports, or the CSVs." />
              <ul className="mig-diag-list">
                {parsed.diagnostics.map((d) => (
                  <li key={d.file}>
                    <b>{d.file}</b> — {d.detectedAs}
                    {d.note ? ` · ${d.note}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="mig-actions">
            <button className="btn" onClick={() => setStep(0)}>
              ← Back
            </button>
          </div>
        </section>
      )}

      {/* ================= step 3: preview ================= */}
      {step === 2 && parsed && (
        <section className="card mig-card">
          <div className="mig-card-title">🔍 Here&apos;s what we found</div>

          <IdentityCard identity={identity} />

          {/* Per-source breakdown, aggregated from the per-file diagnostics. */}
          {sources.length > 1 && (
            <div className="mig-sources">
              {sources.map((s) => (
                <div key={s.label} className="mig-source">
                  <div className="mig-source-head">
                    <span aria-hidden>{s.emoji}</span> {s.label}
                  </div>
                  <div className="mig-source-line">{sourceLine(s)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Merged totals. */}
          <div className="mig-stats">
            <div className="mig-stat">
              <div className="mig-stat-num">{fmt(shownShows.length)}</div>
              <div className="mig-stat-label">📺 shows</div>
            </div>
            <div className="mig-stat">
              <div className="mig-stat-num">{fmt(totalEpisodes)}</div>
              <div className="mig-stat-label">✅ watched episodes</div>
            </div>
            <div className="mig-stat">
              <div className="mig-stat-num">{fmt(parsed.movies.length)}</div>
              <div className="mig-stat-label">🎬 movies</div>
            </div>
            {parsed.followedOnly.length > 0 && (
              <div className="mig-stat">
                <div className="mig-stat-num">{fmt(parsed.followedOnly.length)}</div>
                <div className="mig-stat-label">➕ followed only</div>
              </div>
            )}
            {totalEmotions > 0 && (
              <div className="mig-stat">
                <div className="mig-stat-num">{fmt(totalEmotions)}</div>
                <div className="mig-stat-label">💬 reactions</div>
              </div>
            )}
            {watchlist.length > 0 && (
              <div className="mig-stat">
                <div className="mig-stat-num">{fmt(watchlist.length)}</div>
                <div className="mig-stat-label">🔖 watchlist</div>
              </div>
            )}
          </div>

          {/* Pre-flight data check: date coverage + expected queue order. */}
          {(() => {
            const pf = preflightOf(parsed)
            const total = pf.dated + pf.undated
            return (
              <div className="mig-preflight">
                {pf.undated === 0 && total > 0 ? (
                  <div className="mig-who mig-who-ok">
                    <span className="mig-who-icon" aria-hidden>
                      🧪
                    </span>
                    <div className="mig-who-text">
                      <div className="mig-who-main">
                        Data check: all {fmt(total)} episodes carry their original watch dates
                      </div>
                      <div className="mig-who-sub">
                        Your history and &ldquo;Keep watching&rdquo; order will be exact.
                      </div>
                    </div>
                  </div>
                ) : pf.undated > 0 ? (
                  <div className="mig-who mig-who-warn">
                    <span className="mig-who-icon" aria-hidden>
                      🧪
                    </span>
                    <div className="mig-who-text">
                      <div className="mig-who-main">
                        Data check: {fmt(pf.undated)} of {fmt(total)} episodes have no watch date
                      </div>
                      <div className="mig-who-sub">
                        Those will be stamped with today&apos;s date and sort as recently watched.
                        The rest keep their real dates.
                      </div>
                    </div>
                  </div>
                ) : null}
                {pf.top.length > 0 && (
                  <div className="mig-preflight-top">
                    <span className="mig-preflight-label">Keep watching will start with:</span>{' '}
                    {pf.top.map((t, i) => (
                      <span key={t.name}>
                        {i > 0 && ' · '}
                        <b>{t.name}</b>{' '}
                        <span className="mig-preflight-date">({t.last.slice(0, 10)})</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {shownShows.length > 0 && (
            <details className="mig-details">
              <summary>Per-show episode counts</summary>
              <ul className="mig-show-list">
                {shownShows.map((s) => (
                  <li key={`${s.tvdbId ?? ''}:${s.name}`}>
                    <span className="mig-show-name">
                      {s.favorite ? '⭐ ' : ''}
                      {s.name}
                    </span>
                    <span className="mig-show-count">
                      {s.episodes.length} ep{s.episodes.length === 1 ? '' : 's'}
                      {s.emotions && s.emotions.length > 0 ? ` · ${s.emotions.length} 💬` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <details className="mig-details">
            <summary>File diagnostics</summary>
            <ul className="mig-diag-list">
              {parsed.diagnostics.map((d) => (
                <li key={d.file}>
                  <b>{d.file}</b> — detected as <i>{d.detectedAs}</i> · {d.rows} rows
                  {d.skipped > 0 ? ` · ${d.skipped} skipped` : ''}
                  {d.note ? ` · ${d.note}` : ''}
                </li>
              ))}
            </ul>
          </details>

          {demo && (
            <div className="mig-warn" role="alert">
              <b>⚠️ Demo mode — import is blocked.</b> Matching your TV Time titles to real shows
              and movies needs a TMDB API key, and the app is currently running on sample data.
              Add a free key in <Link to="/settings">Settings</Link>, then come back — your parsed
              export will still be here.
            </div>
          )}

          <div className="mig-actions">
            <button className="btn" onClick={() => setStep(1)}>
              ← Choose different files
            </button>
            <button
              className="btn primary"
              disabled={demo || nothingFound}
              onClick={() => void runImport()}
            >
              Start import →
            </button>
          </div>
        </section>
      )}

      {/* ================= step 4: importing ================= */}
      {step === 3 && (
        <section className="card mig-card">
          <div className="mig-card-title">Importing your library…</div>
          <IdentityCard identity={identity} />
          <p className="mig-desc">
            Matching each title against TMDB — big libraries take a few minutes. Keep this tab
            open.
          </p>
          <ProgressBar value={progress.total > 0 ? progress.done / progress.total : 0} />
          <div className="mig-progress-line" aria-live="polite">
            {progress.current
              ? `Matching ${progress.current}… (${Math.min(progress.done + 1, progress.total)}/${progress.total})`
              : 'Starting…'}
          </div>
          <div className="mig-actions">
            <button
              className="btn danger"
              onClick={() => {
                cancelRef.current = true
              }}
            >
              Cancel import
            </button>
          </div>
        </section>
      )}

      {/* ================= step 5: done ================= */}
      {step === 4 && result && (
        <section className="card mig-card">
          <div className="mig-done-emoji" aria-hidden>
            🎉
          </div>
          <div className="mig-card-title" style={{ textAlign: 'center' }}>
            Welcome to Raed Tracker!
          </div>
          <div className="mig-stats">
            <div className="mig-stat">
              <div className="mig-stat-num">{fmt(result.showsAdded)}</div>
              <div className="mig-stat-label">📺 shows added</div>
            </div>
            <div className="mig-stat">
              <div className="mig-stat-num">{fmt(result.episodesMarked)}</div>
              <div className="mig-stat-label">✅ episodes marked</div>
            </div>
            <div className="mig-stat">
              <div className="mig-stat-num">{fmt(result.moviesAdded)}</div>
              <div className="mig-stat-label">🎬 movies added</div>
            </div>
            {result.emotionsApplied > 0 && (
              <div className="mig-stat">
                <div className="mig-stat-num">{fmt(result.emotionsApplied)}</div>
                <div className="mig-stat-label">💬 reactions applied</div>
              </div>
            )}
            {result.watchlistAdded > 0 && (
              <div className="mig-stat">
                <div className="mig-stat-num">{fmt(result.watchlistAdded)}</div>
                <div className="mig-stat-label">🔖 watchlist added</div>
              </div>
            )}
          </div>

          {unmatched.length > 0 ? (
            <div className="mig-unmatched">
              <div className="mig-unmatched-head">
                <span>
                  ⚠️ {unmatched.length} title{unmatched.length === 1 ? '' : 's'} couldn&apos;t be
                  matched — add them by hand via Search:
                </span>
                <button className="btn small" onClick={copyUnmatched}>
                  📋 Copy list
                </button>
              </div>
              <ul className="mig-unmatched-list">
                {unmatched.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mig-receipt-note">Everything we could match came through cleanly.</p>
          )}

          <p className="mig-receipt-note">
            TV Time ratings, comments and lists aren&apos;t carried — Raed Tracker doesn&apos;t have
            a place for them yet.
          </p>

          <div className="mig-actions" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => navigate('/shows')}>
              📺 Go to My Shows
            </button>
            <button className="btn" onClick={() => navigate('/stats')}>
              📊 See your stats
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

/** Short "what it contained" label for an upload chip. */
function chipDescription(kind: DetectedKind, rows: number): string {
  switch (kind) {
    case 'episode-history':
    case 'official episode history':
      return `${fmt(rows)} watched episodes`
    case 'official watch/watchlist records':
      return `${fmt(rows)} watch records`
    case 'followed-shows':
    case 'official followed shows':
      return `${fmt(rows)} followed shows`
    case 'third-party series JSON':
      return `${fmt(rows)} shows + episodes`
    case 'movies':
    case 'third-party movies JSON':
      return `${fmt(rows)} movies`
    case 'episode emotions':
      return `${fmt(rows)} reactions`
    default:
      return 'not recognized'
  }
}

/** One-line summary of a source's contribution for the breakdown card. */
function sourceLine(s: SourceRow): string {
  const parts: string[] = []
  if (s.shows) parts.push(`${fmt(s.shows)} shows`)
  if (s.episodes) parts.push(`${fmt(s.episodes)} watched episodes`)
  if (s.movies) parts.push(`${fmt(s.movies)} movies`)
  if (s.emotions) parts.push(`${fmt(s.emotions)} reactions`)
  if (s.watchlist) parts.push(`${fmt(s.watchlist)} watchlist`)
  return parts.length > 0 ? parts.join(' · ') : 'nothing new'
}
