// Settings — pill tabs (Account | App | Data): account & sync, theme + about,
// TMDB API key, local data export/import and danger zone.

import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getApiKey, isDemoMode, setApiKey } from '../api/tmdb'
import { useLibrary } from '../store/library'
import { getSyncStatus, noteLibraryReplaced } from '../store/sync'
import { AccountSyncCard } from '../components/AccountSync'
import { BackBar } from '../components/BackBar'
import { confirm } from '../components/confirm'
import { showToast } from '../components/toast'
import { getThemePref, setThemePref } from '../lib/theme'
import type { ThemePref } from '../lib/theme'
import './settings.css'

const LIBRARY_STORAGE_KEY = 'showtrackr_library'
// Mirrors META_KEY in src/store/sync.ts (tombstones + LWW set-times).
const SYNC_META_STORAGE_KEY = 'showtrackr_sync_meta'
// Mirrors WIPED_BACKUP_KEY in src/store/sync.ts: connect() stashes the local
// library here before wiping it on an account switch, so the data (possibly
// including signed-out work) stays recoverable from this card.
const WIPED_BACKUP_STORAGE_KEY = 'showtrackr_wiped_library_backup'

type SettingsTab = 'account' | 'app' | 'data'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'account', label: '👤 Account' },
  { id: 'app', label: '🎛️ App' },
  { id: 'data', label: '💾 Data' },
]

const THEME_OPTIONS: { value: ThemePref; emoji: string; title: string; desc: string }[] = [
  { value: 'auto', emoji: '🌗', title: 'Auto', desc: 'Sync with your device appearance' },
  { value: 'dark', emoji: '🌙', title: 'Dark', desc: 'Dark grey, easy on the eyes' },
  { value: 'light', emoji: '☀️', title: 'Light', desc: 'Bright surfaces, same yellow accent' },
]

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Structural check that a parsed file really is a Raed Tracker backup — the
 * zustand persist wrapper ({ state, version }) with sanely-typed slices —
 * before it is allowed to overwrite the persisted library.
 */
function isValidBackup(parsed: unknown): boolean {
  if (!isRecord(parsed) || !isRecord(parsed.state)) return false
  const state = parsed.state
  if (
    !isRecord(state.shows) ||
    !isRecord(state.movies) ||
    !Array.isArray(state.watchlist) ||
    !Array.isArray(state.comments)
  ) {
    return false
  }
  for (const show of Object.values(state.shows)) {
    if (!isRecord(show) || !isRecord(show.snapshot) || !isRecord(show.watched)) return false
  }
  for (const movie of Object.values(state.movies)) {
    if (!isRecord(movie) || !isRecord(movie.snapshot)) return false
  }
  return true
}

export default function Settings() {
  const demo = isDemoMode()
  const [tab, setTab] = useState<SettingsTab>('account')
  const [key, setKey] = useState(() => getApiKey())
  const [themePref, setPref] = useState<ThemePref>(() => getThemePref())
  const [dataMessage, setDataMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [wipedBackup, setWipedBackup] = useState<string | null>(() => {
    try {
      return localStorage.getItem(WIPED_BACKUP_STORAGE_KEY)
    } catch {
      return null
    }
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

  const shows = useLibrary((s) => s.shows)
  const movies = useLibrary((s) => s.movies)
  const watchlist = useLibrary((s) => s.watchlist)
  const comments = useLibrary((s) => s.comments)
  const resetAll = useLibrary((s) => s.resetAll)

  function saveKey() {
    setApiKey(key)
    showToast('TMDB key saved — reloading…', '🔑')
    window.location.reload()
  }

  function removeKey() {
    setApiKey('')
    showToast('TMDB key removed — back to demo mode', '🔑')
    window.location.reload()
  }

  function chooseTheme(pref: ThemePref) {
    setThemePref(pref) // persists + applies instantly, no reload needed
    setPref(pref)
    const opt = THEME_OPTIONS.find((o) => o.value === pref)
    showToast(`Theme: ${opt?.title ?? pref}`, opt?.emoji ?? '🎨')
  }

  function exportData() {
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY)
    if (!raw) {
      setDataMessage({ text: 'Nothing to export yet — your library is empty.', error: true })
      return
    }
    const blob = new Blob([raw], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'showtrackr-backup.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setDataMessage({ text: 'Backup downloaded as showtrackr-backup.json.', error: false })
    showToast('Backup downloaded', '⬇️')
  }

  async function importFile(file: File) {
    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      setDataMessage({
        text: 'Import failed — that file is not valid JSON.',
        error: true,
      })
      return
    }
    if (!isValidBackup(parsed)) {
      setDataMessage({
        text: 'Import failed — that file is not a Raed Tracker backup (use a file created with “Export backup”).',
        error: true,
      })
      return
    }
    const hasData =
      Object.keys(shows).length > 0 ||
      Object.keys(movies).length > 0 ||
      watchlist.length > 0 ||
      comments.length > 0
    if (
      hasData &&
      !(await confirm({
        title: 'Replace current library?',
        message: 'Importing this backup will replace your current library on this device.',
        confirmLabel: 'Replace library',
      }))
    ) {
      return
    }
    // Record sync tombstones for everything the imported backup drops, so a
    // signed-in user's "replace" survives the reload instead of being
    // re-merged back from the cloud copy.
    noteLibraryReplaced((parsed as { state: Parameters<typeof noteLibraryReplaced>[0] }).state)
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(parsed))
    showToast('Backup imported — reloading…', '⬆️')
    window.location.reload()
  }

  function downloadWipedBackup() {
    if (!wipedBackup) return
    const blob = new Blob([wipedBackup], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'showtrackr-recovered-library.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    showToast('Recovered library downloaded', '🛟')
  }

  async function discardWipedBackup() {
    if (
      !(await confirm({
        title: 'Discard recovered snapshot?',
        message: 'The recovered library snapshot will be deleted. This cannot be undone.',
        confirmLabel: 'Discard',
        danger: true,
      }))
    ) {
      return
    }
    try {
      localStorage.removeItem(WIPED_BACKUP_STORAGE_KEY)
    } catch {
      // storage unavailable — nothing to remove
    }
    setWipedBackup(null)
    showToast('Recovered snapshot discarded', '🗑️')
  }

  async function confirmReset() {
    // While signed in the reset is deliberately synced: tombstones propagate
    // to the cloud copy and every other device — say so instead of promising
    // an "on this device" wipe that actually destroys everything everywhere.
    // An 'error' status with an email is still a signed-in session (transient
    // network failure), so it gets the synced wording and behaviour too.
    const status = getSyncStatus()
    const signedIn =
      status.state === 'synced' ||
      status.state === 'syncing' ||
      (status.state === 'error' && status.email !== undefined)
    if (
      await confirm({
        title: 'Reset everything?',
        message: signedIn
          ? 'This permanently deletes your shows, movies, watchlist, comments and profile — including your cloud copy and every synced device.'
          : 'This permanently deletes your shows, movies, watchlist, comments and profile on this device.',
        confirmLabel: 'Reset everything',
        danger: true,
      })
    ) {
      resetAll()
      if (!signedIn) {
        // The signed-out dialog promises a device-local wipe, but resetAll()'s
        // store transition just tombstoned every item in the sync meta. Left
        // in place, those tombstones would be merged on a future sign-in and
        // silently wipe the cloud copy (and every other device) too. Drop
        // them so signing back in restores the cloud library instead.
        try {
          localStorage.removeItem(SYNC_META_STORAGE_KEY)
        } catch {
          // storage unavailable — nothing to clean up
        }
      }
      showToast('Library reset', '🗑️')
      window.location.reload()
    }
  }

  return (
    <div>
      <BackBar title="Settings" />
      <h1 className="page-title">Settings</h1>
      <p className="page-subtitle">Data source, backups and app info.</p>

      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`settings-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ================= Account tab ================= */}
      {tab === 'account' && (
        <div key="account" className="settings-stack fade-in">
          <AccountSyncCard />

          <section className="card">
            <div className="settings-card-head">
              <div className="settings-card-title">🔐 Security &amp; sign-in</div>
            </div>
            <p className="settings-card-desc">
              Email, password and session controls live on the account page.
            </p>
            <div className="settings-actions">
              <Link to="/account" className="btn">
                Open account security →
              </Link>
            </div>
          </section>
        </div>
      )}

      {/* ================= App tab ================= */}
      {tab === 'app' && (
        <div key="app" className="settings-stack fade-in">
          <section className="card">
            <div className="settings-card-head">
              <div className="settings-card-title">🎨 Theme</div>
            </div>
            <p className="settings-card-desc">
              Pick how Raed Tracker looks. Changes apply instantly — no reload.
            </p>
            <div className="settings-theme-options" role="radiogroup" aria-label="Theme">
              {THEME_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`settings-theme-row${themePref === opt.value ? ' selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={opt.value}
                    checked={themePref === opt.value}
                    onChange={() => chooseTheme(opt.value)}
                  />
                  <span className="settings-theme-emoji" aria-hidden>
                    {opt.emoji}
                  </span>
                  <span className="settings-theme-text">
                    <span className="settings-theme-title">{opt.title}</span>
                    <span className="settings-theme-desc">{opt.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="settings-card-head">
              <div className="settings-card-title">ℹ️ About</div>
            </div>
            <p className="settings-card-desc">
              <b>Raed Tracker</b> — a TV Time-style tracker for the shows and movies you love.
            </p>
            <ul className="settings-features">
              <li>Track watched episodes and movies with per-season progress</li>
              <li>Emotion reactions — how did that episode make you feel?</li>
              <li>Watchlist, upcoming episodes and premieres</li>
              <li>Comment threads on shows, episodes and movies</li>
              <li>Watch-time stats: hours watched, streaks and top genres</li>
              <li>TMDB metadata with IMDb links, plus a keyless demo mode</li>
            </ul>
            <p className="settings-note">
              Your library and comments are stored on this device, and synced to your account
              when you sign in — export a backup before switching browsers if you stay signed
              out.
            </p>
            <p className="settings-version">Raed Tracker · TMDB data · IMDb links</p>
          </section>
        </div>
      )}

      {/* ================= Data tab ================= */}
      {tab === 'data' && (
        <div key="data" className="settings-stack fade-in">
          <section className="card">
            <div className="settings-card-head">
              <div className="settings-card-title">🎬 Data source</div>
              <span className="settings-status">
                <span
                  className="settings-dot"
                  style={{ background: demo ? 'var(--yellow)' : 'var(--green)' }}
                />
                {demo ? 'Demo mode (sample data)' : 'Connected to TMDB ✓'}
              </span>
            </div>
            <p className="settings-card-desc">
              Raed Tracker uses <b>TMDB</b> (The Movie Database) for show and movie metadata —
              posters, episodes, air dates and cast — and every title links out to <b>IMDb</b>.
              Without an API key the app runs on a small set of sample data.
            </p>

            <div className="settings-key-row">
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="TMDB API key or Read Access Token"
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveKey()
                }}
              />
              <button className="btn primary" onClick={saveKey}>
                Save
              </button>
              {getApiKey() && (
                <button className="btn danger" onClick={removeKey}>
                  Remove key
                </button>
              )}
            </div>

            <ol className="settings-steps">
              <li>
                Create a free account at{' '}
                <a href="https://www.themoviedb.org/signup" target="_blank" rel="noreferrer">
                  themoviedb.org
                </a>
              </li>
              <li>
                Go to <b>Settings → API</b> and request a key
              </li>
              <li>
                Paste the <b>“API Read Access Token”</b> or v3 key here
              </li>
            </ol>

            <p className="settings-attribution">
              This product uses the TMDB API but is not endorsed or certified by TMDB.
            </p>
          </section>

          <section className="card">
            <div className="settings-card-head">
              <div className="settings-card-title">💾 Your data</div>
            </div>
            <p className="settings-card-desc">
              Everything you track is stored <b>locally in this browser</b>, and — when you sign
              in to sync — mirrored to your cloud account. Export a JSON backup to keep it safe
              or move it to another browser, and import it back any time.
            </p>

            <div className="settings-chips">
              <span className="chip">📺 {Object.keys(shows).length} shows</span>
              <span className="chip">🎬 {Object.keys(movies).length} movies</span>
              <span className="chip">🔖 {watchlist.length} watchlist</span>
              <span className="chip">💬 {comments.length} comments</span>
            </div>

            <div className="settings-actions">
              <button className="btn primary" onClick={exportData}>
                ⬇️ Export backup
              </button>
              <button className="btn" onClick={() => fileInputRef.current?.click()}>
                ⬆️ Import backup
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void importFile(file)
                  e.target.value = ''
                }}
              />
            </div>
            {dataMessage && (
              <p
                className="settings-feedback"
                style={{ color: dataMessage.error ? 'var(--red)' : 'var(--green)' }}
              >
                {dataMessage.text}
              </p>
            )}
          </section>

          {wipedBackup !== null && (
            <section className="card">
              <div className="settings-card-head">
                <div className="settings-card-title">🛟 Recovered library snapshot</div>
              </div>
              <p className="settings-card-desc">
                Signing in to a different account replaced the library that was on this device.
                The old library was saved first — download it as a backup (you can re-import it
                via “Import backup” on the account it belongs to), or discard it if you no
                longer need it.
              </p>
              <div className="settings-actions">
                <button className="btn primary" onClick={downloadWipedBackup}>
                  ⬇️ Download snapshot
                </button>
                <button className="btn danger" onClick={() => void discardWipedBackup()}>
                  Discard
                </button>
              </div>
            </section>
          )}

          <section className="card">
            <div className="settings-card-head">
              <div className="settings-card-title">📥 Import from TV Time</div>
            </div>
            <p className="settings-card-desc">
              Moving from another tracker? Import your shows, watched episodes and movies from a
              TV Time data export.
            </p>
            <div className="settings-actions">
              <Link to="/migrate" className="btn primary">
                📥 Import from TV Time
              </Link>
            </div>
          </section>

          <section className="card settings-danger">
            <div className="settings-card-head">
              <div className="settings-card-title" style={{ color: 'var(--red)' }}>
                ⚠️ Danger zone
              </div>
            </div>
            <p className="settings-card-desc">
              Wipe your entire library — shows, movies, watchlist, comments and profile. This
              cannot be undone (export a backup first!).
            </p>
            <div className="settings-actions">
              <button className="btn danger" onClick={() => void confirmReset()}>
                Reset everything
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
