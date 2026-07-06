// Settings — pill tabs (Account | App | Upcoming | Data): account & sync,
// theme, notifications, privacy, language + about, upcoming-schedule filters,
// TMDB API key, cache, local data export/import and danger zone.

import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getApiKey, isDemoMode, setApiKey } from '../api/tmdb'
import { useLibrary } from '../store/library'
import type { ReactionPrompt } from '../store/library'
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
// Mirrors REFRESHED_KEY in src/lib/freshness.ts: the {showId: iso} map of last
// background-refresh times. Cleared by the "Clear cache" button so a fresh
// pull re-fetches every followed show.
const REFRESHED_STORAGE_KEY = 'raedtracker_refreshed'

// ---------- notification prefs (in-app banners/toasts only — no push) --------
// Persisted as { episodeAirs: boolean, newSeason: boolean } under this key.
const NOTIFY_PREFS_KEY = 'raedtracker_notify_prefs'
interface NotifyPrefs {
  episodeAirs: boolean
  newSeason: boolean
}
const DEFAULT_NOTIFY: NotifyPrefs = { episodeAirs: true, newSeason: true }

function loadNotifyPrefs(): NotifyPrefs {
  try {
    const raw = localStorage.getItem(NOTIFY_PREFS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<NotifyPrefs>
      return {
        episodeAirs: p.episodeAirs !== false,
        newSeason: p.newSeason !== false,
      }
    }
  } catch {
    /* corrupted — fall through to defaults */
  }
  return { ...DEFAULT_NOTIFY }
}

function saveNotifyPrefs(prefs: NotifyPrefs) {
  try {
    localStorage.setItem(NOTIFY_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* storage full/unavailable — prefs just won't persist */
  }
}

// ---------- private-profile flag --------------------------------------------
// A single boolean under this key. Settings ONLY writes it; Profile.tsx (owned
// by another agent) is the live reader and renders a 🔒 chip when it is 'true'.
const PRIVATE_PROFILE_KEY = 'raedtracker_private_profile'

function loadPrivateProfile(): boolean {
  try {
    return localStorage.getItem(PRIVATE_PROFILE_KEY) === 'true'
  } catch {
    return false
  }
}

function savePrivateProfile(on: boolean) {
  try {
    localStorage.setItem(PRIVATE_PROFILE_KEY, on ? 'true' : 'false')
  } catch {
    /* storage full/unavailable — flag just won't persist */
  }
}

// ---------- language prefs --------------------------------------------------
// Persisted as { titles: LangCode, comments: LangCode } under this key. Applies
// to newly loaded titles/comments only; api/tmdb.ts is untouched here.
const LANG_PREFS_KEY = 'raedtracker_lang_prefs'
const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
] as const
type LangCode = (typeof LANGUAGES)[number]['code']
const LANG_CODES = LANGUAGES.map((l) => l.code) as readonly LangCode[]
interface LangPrefs {
  titles: LangCode
  comments: LangCode
}
const DEFAULT_LANG: LangPrefs = { titles: 'en', comments: 'en' }

function isLang(v: unknown): v is LangCode {
  return typeof v === 'string' && (LANG_CODES as readonly string[]).includes(v)
}

function loadLangPrefs(): LangPrefs {
  try {
    const raw = localStorage.getItem(LANG_PREFS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<LangPrefs>
      return {
        titles: isLang(p.titles) ? p.titles : 'en',
        comments: isLang(p.comments) ? p.comments : 'en',
      }
    }
  } catch {
    /* corrupted — fall through to defaults */
  }
  return { ...DEFAULT_LANG }
}

function saveLangPrefs(prefs: LangPrefs) {
  try {
    localStorage.setItem(LANG_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* storage full/unavailable — prefs just won't persist */
  }
}

// ---------- upcoming-schedule filters (SHARED with Upcoming.tsx) -------------
// Shared localStorage key. The Upcoming page (src/pages/Upcoming.tsx) is the
// live CONSUMER and reads/writes the full shape:
//   { network: string | null, hideTba: boolean, hideWatched: boolean }
// This settings tab reads/writes the SAME key and shape; both sides preserve
// all three fields on save, and each re-reads on mount.
const UPCOMING_FILTERS_KEY = 'raedtracker_upcoming_filters'
// A curated list of common networks for the settings chip row. The Upcoming
// page derives its chips from live entries; here we can't load them, so we
// offer the frequently-scheduled streamers/channels plus the user's pick.
const UPCOMING_NETWORKS = [
  'Netflix',
  'HBO',
  'Max',
  'Apple TV+',
  'Prime Video',
  'Disney+',
  'AMC',
  'Hulu',
  'FX',
  'BBC',
] as const
interface UpcomingFilters {
  network: string | null
  hideTba: boolean
  hideWatched: boolean
}

function loadUpcomingFilters(): UpcomingFilters {
  try {
    const raw = localStorage.getItem(UPCOMING_FILTERS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as {
        network?: unknown
        networks?: unknown
        hideTba?: unknown
        hideWatched?: unknown
      }
      let network: string | null = null
      if (typeof p.network === 'string') network = p.network
      else if (Array.isArray(p.networks)) {
        const first = p.networks.find((n): n is string => typeof n === 'string')
        network = first ?? null
      }
      return {
        network,
        hideTba: p.hideTba === true,
        hideWatched: p.hideWatched === true,
      }
    }
  } catch {
    /* corrupted — fall through to defaults */
  }
  return { network: null, hideTba: false, hideWatched: false }
}

function saveUpcomingFilters(prefs: UpcomingFilters) {
  try {
    localStorage.setItem(UPCOMING_FILTERS_KEY, JSON.stringify(prefs))
  } catch {
    /* storage full/unavailable — filters just won't persist */
  }
}

// ---------- cache clearing --------------------------------------------------
// Estimate freed space via the StorageManager quota delta, then clear the
// tmdb-* runtime caches (posters + API responses) and the freshness refresh map.
async function clearTmdbCaches(): Promise<{ freedLabel: string | null }> {
  let before: number | undefined
  try {
    before = (await navigator.storage?.estimate?.())?.usage
  } catch {
    before = undefined
  }

  // Delete every CacheStorage bucket whose name mentions "tmdb" (workbox names
  // them tmdb-images / tmdb-api from vite.config.ts).
  try {
    if ('caches' in window) {
      const names = await caches.keys()
      await Promise.all(
        names.filter((n) => n.toLowerCase().includes('tmdb')).map((n) => caches.delete(n)),
      )
    }
  } catch {
    /* CacheStorage unavailable — nothing to clear */
  }

  // Drop the freshness "last refreshed" map so the next pull re-fetches shows.
  try {
    localStorage.removeItem(REFRESHED_STORAGE_KEY)
  } catch {
    /* storage unavailable */
  }

  let freedLabel: string | null = null
  try {
    const after = (await navigator.storage?.estimate?.())?.usage
    if (before !== undefined && after !== undefined && before > after) {
      freedLabel = formatBytes(before - after)
    }
  } catch {
    /* estimate unavailable */
  }
  return { freedLabel }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

type SettingsTab = 'account' | 'app' | 'upcoming' | 'data'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'account', label: '👤 Account' },
  { id: 'app', label: '🎛️ App' },
  { id: 'upcoming', label: '📅 Upcoming' },
  { id: 'data', label: '💾 Data' },
]

const THEME_OPTIONS: { value: ThemePref; emoji: string; title: string; desc: string }[] = [
  { value: 'auto', emoji: '🌗', title: 'Auto', desc: 'Sync with your device appearance' },
  { value: 'dark', emoji: '🌙', title: 'Dark', desc: 'Dark grey, easy on the eyes' },
  { value: 'light', emoji: '☀️', title: 'Light', desc: 'Bright surfaces, same yellow accent' },
]

const REACTION_OPTIONS: { value: ReactionPrompt; emoji: string; title: string; desc: string }[] = [
  { value: 'always', emoji: '💬', title: 'Always', desc: 'Open the react sheet after every check-off' },
  {
    value: 'milestones',
    emoji: '🏆',
    title: 'Milestones only',
    desc: 'Only on premieres, finales and completions',
  },
  { value: 'never', emoji: '🚫', title: 'Never', desc: 'Just a toast — react inline on the show page' },
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
  const [notify, setNotify] = useState<NotifyPrefs>(loadNotifyPrefs)
  const [privateProfile, setPrivateProfile] = useState<boolean>(loadPrivateProfile)
  const [lang, setLang] = useState<LangPrefs>(loadLangPrefs)
  const [upcoming, setUpcoming] = useState<UpcomingFilters>(loadUpcomingFilters)
  const [clearing, setClearing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const shows = useLibrary((s) => s.shows)
  const movies = useLibrary((s) => s.movies)
  const watchlist = useLibrary((s) => s.watchlist)
  const comments = useLibrary((s) => s.comments)
  const resetAll = useLibrary((s) => s.resetAll)
  const reactionPrompt = useLibrary((s) => s.reactionPrompt)
  const setReactionPrompt = useLibrary((s) => s.setReactionPrompt)

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

  function chooseReactionPrompt(pref: ReactionPrompt) {
    setReactionPrompt(pref) // persisted in the library store
    const opt = REACTION_OPTIONS.find((o) => o.value === pref)
    showToast(`Reaction prompts: ${opt?.title ?? pref}`, opt?.emoji ?? '💬')
  }

  // NOTE: persistence + toasts live OUTSIDE the setState calls below. React
  // may run updater functions during render, so side effects inside them
  // trigger "Cannot update a component (Toaster) while rendering another".
  function toggleNotify(field: keyof NotifyPrefs) {
    const next = { ...notify, [field]: !notify[field] }
    setNotify(next)
    saveNotifyPrefs(next)
  }

  function togglePrivate() {
    const next = !privateProfile
    setPrivateProfile(next)
    savePrivateProfile(next)
    showToast(next ? 'Profile set to private 🔒' : 'Profile is public again', '🔒')
  }

  function chooseLang(field: keyof LangPrefs, code: LangCode) {
    const next = { ...lang, [field]: code }
    setLang(next)
    saveLangPrefs(next)
  }

  function selectUpcomingNetwork(n: string) {
    // Single-select, matching the Upcoming page: tapping the active chip
    // clears back to "All".
    const next = { ...upcoming, network: upcoming.network === n ? null : n }
    setUpcoming(next)
    saveUpcomingFilters(next)
  }

  function toggleUpcoming(field: 'hideTba' | 'hideWatched') {
    const next = { ...upcoming, [field]: !upcoming[field] }
    setUpcoming(next)
    saveUpcomingFilters(next)
  }

  async function clearCache() {
    if (
      !(await confirm({
        title: 'Clear cached data?',
        message:
          'Removes downloaded posters and TMDB responses, and forces your shows to re-check for new episodes. Your library and watched history are not touched.',
        confirmLabel: 'Clear cache',
      }))
    ) {
      return
    }
    setClearing(true)
    const { freedLabel } = await clearTmdbCaches()
    setClearing(false)
    showToast(freedLabel ? `Cache cleared — freed ${freedLabel}` : 'Cache cleared', '🧹')
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
              <div className="settings-card-title">💬 Reaction prompts</div>
            </div>
            <p className="settings-card-desc">
              Choose how often the “How did it feel?” sheet pops up after you check off an
              episode. You can always react inline on the show page.
            </p>
            <div
              className="settings-theme-options"
              role="radiogroup"
              aria-label="Reaction prompt frequency"
            >
              {REACTION_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`settings-theme-row${reactionPrompt === opt.value ? ' selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="reactionPrompt"
                    value={opt.value}
                    checked={reactionPrompt === opt.value}
                    onChange={() => chooseReactionPrompt(opt.value)}
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

          {/* ---------- Notifications ---------- */}
          <section className="card">
            <div className="settings-card-head">
              <div className="settings-card-title">🔔 Notifications</div>
            </div>
            <p className="settings-card-desc">
              Choose which in-app alerts you see while you use Raed Tracker.
            </p>
            <div className="settings-toggle-list">
              <label className="settings-toggle-row">
                <span className="settings-toggle-text">
                  <span className="settings-toggle-title">Episode airs</span>
                  <span className="settings-toggle-desc">
                    Banner when a new episode of a followed show drops
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="settings-switch"
                  role="switch"
                  checked={notify.episodeAirs}
                  onChange={() => toggleNotify('episodeAirs')}
                />
              </label>
              <label className="settings-toggle-row">
                <span className="settings-toggle-text">
                  <span className="settings-toggle-title">New season</span>
                  <span className="settings-toggle-desc">
                    Banner when a show you track returns for a new season
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="settings-switch"
                  role="switch"
                  checked={notify.newSeason}
                  onChange={() => toggleNotify('newSeason')}
                />
              </label>
            </div>
            <p className="settings-note">
              These control in-app banners and toasts only — Raed Tracker doesn't send push
              notifications, so nothing reaches you unless the app is open.
            </p>
          </section>

          {/* ---------- Privacy ---------- */}
          <section className="card">
            <div className="settings-card-head">
              <div className="settings-card-title">🔒 Privacy</div>
            </div>
            <div className="settings-toggle-list">
              <label className="settings-toggle-row">
                <span className="settings-toggle-text">
                  <span className="settings-toggle-title">Set profile to private</span>
                  <span className="settings-toggle-desc">
                    Adds a 🔒 badge to your profile and keeps your activity to yourself
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="settings-switch"
                  role="switch"
                  checked={privateProfile}
                  onChange={togglePrivate}
                />
              </label>
            </div>
            <details className="settings-disclosure">
              <summary>Privacy &amp; Legal</summary>
              <div className="settings-disclosure-body">
                <p>
                  <b>Your data stays yours.</b> Everything you track lives in this browser's
                  local storage, and — only when you sign in to sync — in your own Supabase
                  account. There is no third-party analytics, ad tracking or profile-selling:
                  no one but you (and the account admin, for provisioned members) can read your
                  library.
                </p>
                <p>
                  <b>What we fetch.</b> Show and movie metadata comes from <b>TMDB</b> (The Movie
                  Database); posters are served from TMDB's image CDN. Requests to TMDB include
                  only the title IDs you look up — never your identity.
                </p>
                <p>
                  <b>Deleting your data.</b> Use <em>Data → Danger zone</em> to wipe everything
                  on this device, or <em>Account → Cloud data</em> to remove the synced copy.
                </p>
                <p className="settings-attribution" style={{ marginTop: 0 }}>
                  This product uses the TMDB API but is not endorsed or certified by TMDB.
                </p>
                <p style={{ marginTop: 8 }}>
                  <Link to="/privacy">Read the full privacy policy →</Link>
                </p>
              </div>
            </details>
          </section>

          {/* ---------- Language ---------- */}
          <section className="card">
            <div className="settings-card-head">
              <div className="settings-card-title">🌐 Language</div>
            </div>
            <p className="settings-card-desc">
              Preferred languages for titles and discussion.
            </p>
            <div className="settings-select-row">
              <label className="settings-select-label" htmlFor="lang-titles">
                Titles language
              </label>
              <select
                id="lang-titles"
                className="settings-select"
                value={lang.titles}
                onChange={(e) => chooseLang('titles', e.target.value as LangCode)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-select-row">
              <label className="settings-select-label" htmlFor="lang-comments">
                Comments language
              </label>
              <select
                id="lang-comments"
                className="settings-select"
                value={lang.comments}
                onChange={(e) => chooseLang('comments', e.target.value as LangCode)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="settings-note">Applies to newly loaded titles.</p>
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
            <p className="settings-version">
              Raed Tracker v{__APP_VERSION__} · TMDB data · IMDb links
            </p>
          </section>
        </div>
      )}

      {/* ================= Upcoming tab ================= */}
      {tab === 'upcoming' && (
        <div key="upcoming" className="settings-stack fade-in">
          <section className="card">
            <div className="settings-card-head">
              <div className="settings-card-title">📅 Upcoming schedule</div>
            </div>
            <p className="settings-card-desc">
              Tune what shows up on the <Link to="/upcoming">Upcoming</Link> page. These filters
              are shared — changes here apply there too.
            </p>

            <div className="settings-field-label">Network</div>
            <div className="settings-chip-filters" role="group" aria-label="Network filter">
              <button
                className={`chip settings-filter-chip${upcoming.network === null ? ' on' : ''}`}
                aria-pressed={upcoming.network === null}
                onClick={() => {
                  const next = { ...upcoming, network: null }
                  setUpcoming(next)
                  saveUpcomingFilters(next)
                }}
              >
                All networks
              </button>
              {UPCOMING_NETWORKS.map((n) => (
                <button
                  key={n}
                  className={`chip settings-filter-chip${upcoming.network === n ? ' on' : ''}`}
                  aria-pressed={upcoming.network === n}
                  onClick={() => selectUpcomingNetwork(n)}
                >
                  {n}
                </button>
              ))}
              {/* Surface a persisted custom network (picked on the Upcoming page)
                  so it stays togglable here even if it isn't in the curated list. */}
              {upcoming.network && !UPCOMING_NETWORKS.includes(upcoming.network as never) && (
                <button
                  className="chip settings-filter-chip on"
                  aria-pressed
                  onClick={() => selectUpcomingNetwork(upcoming.network as string)}
                >
                  {upcoming.network}
                </button>
              )}
            </div>

            <div className="settings-toggle-list" style={{ marginTop: 16 }}>
              <label className="settings-toggle-row">
                <span className="settings-toggle-text">
                  <span className="settings-toggle-title">Hide TBA</span>
                  <span className="settings-toggle-desc">
                    Hide episodes without a confirmed title
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="settings-switch"
                  role="switch"
                  checked={upcoming.hideTba}
                  onChange={() => toggleUpcoming('hideTba')}
                />
              </label>
              <label className="settings-toggle-row">
                <span className="settings-toggle-text">
                  <span className="settings-toggle-title">Hide watched</span>
                  <span className="settings-toggle-desc">
                    Drop episodes you've already checked off
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="settings-switch"
                  role="switch"
                  checked={upcoming.hideWatched}
                  onChange={() => toggleUpcoming('hideWatched')}
                />
              </label>
            </div>
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
              <div className="settings-card-title">🧹 Cached data</div>
            </div>
            <p className="settings-card-desc">
              Raed Tracker caches posters and TMDB responses so it loads fast and works
              offline. Clearing the cache frees storage and forces your shows to re-check for
              new episodes on the next refresh — your library and watched history stay put.
            </p>
            <div className="settings-actions">
              <button className="btn" disabled={clearing} onClick={() => void clearCache()}>
                {clearing ? 'Clearing…' : '🧹 Clear cache'}
              </button>
            </div>
          </section>

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
