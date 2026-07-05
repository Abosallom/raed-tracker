// TV Time migration wizard: parse a GDPR export (ZIP/CSVs), preview it,
// map everything to TMDB and merge into the library via bulkImport.

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { MovieDetail, ShowDetail } from '../types'
import {
  findByExternalId,
  getMovieDetail,
  getShowDetail,
  isDemoMode,
  searchMulti,
} from '../api/tmdb'
import { useLibrary } from '../store/library'
import { reviveNextLibraryChange } from '../store/sync'
import { BackBar } from '../components/BackBar'
import { ErrorBox, LoadingSpinner, ProgressBar } from '../components/shared'
import { showToast } from '../components/toast'
import type { TvTimeImport } from '../lib/tvtime-import'
import { parseExportFiles } from '../lib/tvtime-import'
import './migrate.css'

const STEPS = ['Get your export', 'Upload', 'Preview', 'Import', 'Done'] as const

const LOOKUP_GAP_MS = 250

// The demo-mode warning promises the parsed export survives a trip to
// Settings (which reloads the page after saving a TMDB key), so the parsed
// model is kept in sessionStorage — it outlives both the SPA navigation and
// the reload, but not the tab.
const PENDING_IMPORT_KEY = 'showtrackr_migrate_pending'

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

interface ImportResult {
  showsAdded: number
  episodesMarked: number
  moviesAdded: number
}

export default function Migrate() {
  const navigate = useNavigate()
  const demo = isDemoMode()

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

  const totalEpisodes = parsed
    ? parsed.shows.reduce((sum, s) => sum + s.episodes.length, 0)
    : 0
  const nothingFound =
    parsed !== null &&
    parsed.shows.length === 0 &&
    parsed.followedOnly.length === 0 &&
    parsed.movies.length === 0

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
        model.shows.length > 0 || model.followedOnly.length > 0 || model.movies.length > 0
      savePendingImport(found ? model : null)
      if (found) {
        showToast(`Parsed ${model.diagnostics.length} file${model.diagnostics.length === 1 ? '' : 's'}`, '📦')
        setStep(2)
      }
    } catch {
      setParseError('Could not read those files — drop the TV Time ZIP or the CSVs inside it.')
    } finally {
      setParsing(false)
    }
  }

  async function runImport() {
    if (!parsed || demo) return
    cancelRef.current = false
    setStep(3)
    setUnmatched([])

    // Followed-but-unwatched shows import as shows with no watched episodes.
    const showQueue = [
      ...parsed.shows,
      ...parsed.followedOnly.map((f) => ({ ...f, episodes: [] })),
    ]
    const total = showQueue.length + parsed.movies.length
    const showPayload: {
      detail: ShowDetail
      watched: { season: number; episode: number; watchedAt?: string }[]
    }[] = []
    const moviePayload: { detail: MovieDetail; watchedAt?: string | null }[] = []
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
          showPayload.push({ detail, watched: show.episodes })
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
          moviePayload.push({ detail, watchedAt: movie.watchedAt ?? null })
        }
      } catch {
        missed.push(movie.title)
      }
      done++
      setProgress({ done, total, current: movie.title })
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
    const counts = useLibrary.getState().bulkImport({ shows: showPayload, movies: moviePayload })
    savePendingImport(null) // import finished — drop the stashed export
    setResult(counts)
    setUnmatched(missed)
    setStep(4)
    showToast(
      `Imported ${counts.showsAdded} shows, ${counts.episodesMarked} episodes, ${counts.moviesAdded} movies`,
      '🚚',
    )
  }

  function copyUnmatched() {
    void navigator.clipboard.writeText(unmatched.join('\n'))
    showToast('Unmatched titles copied', '📋')
  }

  return (
    <div className="migrate-page">
      <BackBar title="Import" />
      <h1 className="page-title">Move in from TV Time 🚚</h1>
      <p className="page-subtitle">
        Bring your whole watch history — shows, episodes and movies — into Raed Tracker.
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

      {/* ================= step 1: get your export ================= */}
      {step === 0 && (
        <section className="card mig-card">
          <div className="mig-card-title">📨 Get your data out of TV Time</div>
          <ol className="mig-instructions">
            <li>
              In the TV Time app, open <b>Profile → Settings</b> and request your{' '}
              <b>personal data</b> (the GDPR export).
            </li>
            <li>
              No such option in your version? Email TV Time support and ask for your personal data
              export instead.
            </li>
            <li>
              They&apos;ll email you a <b>ZIP file</b> — usually within a few days.
            </li>
            <li>
              Drop that ZIP here <b>as-is</b> on the next step (or the CSV files inside it, if you
              already unpacked it).
            </li>
          </ol>
          <div className="mig-actions">
            <button className="btn primary" onClick={() => setStep(1)}>
              I have my export →
            </button>
          </div>
        </section>
      )}

      {/* ================= step 2: upload ================= */}
      {step === 1 && (
        <section className="card mig-card">
          <div className="mig-card-title">📂 Upload your export</div>
          <p className="mig-desc">
            Drop the TV Time ZIP (or its CSV files) below. Everything is parsed locally in your
            browser — nothing is uploaded anywhere.
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
              <div className="mig-drop-main">Drop your TV Time export here</div>
              <div className="mig-drop-hint">.zip or .csv files — or click to browse</div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.csv,application/zip,text/csv"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              void handleFiles(e.target.files)
              e.target.value = ''
            }}
          />

          {parseError && <ErrorBox message={parseError} />}
          {nothingFound && parsed && (
            <>
              <ErrorBox message="No TV Time data recognized in those files — check you dropped the export ZIP or its CSVs." />
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

          <div className="mig-stats">
            <div className="mig-stat">
              <div className="mig-stat-num">{parsed.shows.length}</div>
              <div className="mig-stat-label">📺 shows</div>
            </div>
            <div className="mig-stat">
              <div className="mig-stat-num">{totalEpisodes}</div>
              <div className="mig-stat-label">✅ watched episodes</div>
            </div>
            <div className="mig-stat">
              <div className="mig-stat-num">{parsed.movies.length}</div>
              <div className="mig-stat-label">🎬 movies</div>
            </div>
            {parsed.followedOnly.length > 0 && (
              <div className="mig-stat">
                <div className="mig-stat-num">{parsed.followedOnly.length}</div>
                <div className="mig-stat-label">➕ followed only</div>
              </div>
            )}
          </div>

          {parsed.shows.length > 0 && (
            <details className="mig-details">
              <summary>Per-show episode counts</summary>
              <ul className="mig-show-list">
                {parsed.shows.map((s) => (
                  <li key={`${s.tvdbId ?? ''}:${s.name}`}>
                    <span className="mig-show-name">{s.name}</span>
                    <span className="mig-show-count">
                      {s.episodes.length} ep{s.episodes.length === 1 ? '' : 's'}
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
              disabled={demo || (parsed.shows.length === 0 && parsed.followedOnly.length === 0 && parsed.movies.length === 0)}
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
          <div className="mig-card-title">🚚 Importing your library…</div>
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
              <div className="mig-stat-num">{result.showsAdded}</div>
              <div className="mig-stat-label">📺 shows added</div>
            </div>
            <div className="mig-stat">
              <div className="mig-stat-num">{result.episodesMarked}</div>
              <div className="mig-stat-label">✅ episodes marked</div>
            </div>
            <div className="mig-stat">
              <div className="mig-stat-num">{result.moviesAdded}</div>
              <div className="mig-stat-label">🎬 movies added</div>
            </div>
          </div>

          {unmatched.length > 0 && (
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
          )}

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
