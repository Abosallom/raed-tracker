// My Shows — TV Time-style "Watch Next" queue: check off the next aired
// episode of each show, react in the EpisodeSheet, and keep momentum.
// Rendered from the store; episode titles are fetched lazily and cached.

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Link } from 'react-router-dom'
import {
  airedEpisodeCount,
  isSeasonFinale,
  isSeasonPremiere,
  isSeriesPremiere,
  nextEpisode,
  seasonComplete,
  showProgress,
  useLibrary,
  displayWatchedCount,
  watchedCount,
} from '../store/library'
import type { SeasonDetail, TrackedShow } from '../types'
import { episodeKey } from '../types'
import { getSeasonDetail, stillUrl } from '../api/tmdb'
import {
  getFreshnessSnapshot,
  markSeen,
  refreshFollowedShows,
  subscribeFreshness,
} from '../lib/freshness'
import { byRecentActivity, lastActivity } from '../lib/activity'
import { detectStampedImport } from '../lib/healthcheck'
import { computeStreaks } from '../lib/streaks'
import { PosterImage, ProgressBar, timeAgo } from '../components/shared'
import { showToast } from '../components/toast'
import { fireConfetti } from '../components/Confetti'
import EpisodeSheet from '../components/EpisodeSheet'
import './myshows.css'

// ---------- helpers ----------

const pad2 = (n: number) => String(n).padStart(2, '0')
const epCode = (s: number, e: number) => `S${pad2(s)}E${pad2(e)}`

// "To Watch" recency window: activity within a month counts as recently
// stopped; older momentum drops to "Haven't seen in a while".
const STALE_MS = 30 * 86400000
const PREFETCH_CAP = 25 // max queue rows that fetch episode titles

// Module-level season cache — survives navigation, dedupes in-flight fetches.
const seasonCache = new Map<string, Promise<SeasonDetail>>()

function fetchSeason(showId: number, season: number): Promise<SeasonDetail> {
  const key = `${showId}:${season}`
  let p = seasonCache.get(key)
  if (!p) {
    p = getSeasonDetail(showId, season).catch((err) => {
      seasonCache.delete(key) // don't cache failures
      throw err
    })
    seasonCache.set(key, p)
  }
  return p
}


/** Aired episodes still unwatched AFTER the current queue row. */
function behindCount(show: TrackedShow): number {
  // Count unwatched aired episodes per key: watch records outside the aired
  // set (null-air-date episodes, mismapped import keys) must not deflate the
  // "+N behind" badge, so a plain aired-total minus watchedCount() won't do.
  let unwatchedAired = 0
  for (const s of Object.keys(show.snapshot.seasonEpisodeCounts).map(Number)) {
    const aired = airedEpisodeCount(show, s)
    for (let e = 1; e <= aired; e++) {
      if (!show.watched[episodeKey(s, e)]) unwatchedAired++
    }
  }
  return unwatchedAired - 1
}

function parseEpKey(key: string): { season: number; episode: number } | null {
  const m = /^s(\d+)e(\d+)$/.exec(key)
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : null
}

interface SheetInfo {
  showId: number
  showName: string
  season: number
  episode: number
  episodeTitle?: string
  variant?: 'default' | 'pause-this'
  onUndo?: () => void
}


// ---------- import-stamped dates notice (library health) ----------

const DATES_NOTICE_KEY = 'raedtracker_dates_notice'

/** Self-serve repair prompt: shows when many shows' ordering keys are import
    stamps (see lib/healthcheck). Dismissal is per-signature, so a NEW bad
    import re-surfaces it, and a successful repair hides it for good. */
function StampedDatesNotice() {
  const shows = useLibrary((s) => s.shows)
  const report = useMemo(() => detectStampedImport(shows), [shows])
  const [, force] = useState(0)
  if (!report) return null
  const sig = `${report.affectedShows}:${report.stampedRecords}`
  try {
    if (localStorage.getItem(DATES_NOTICE_KEY) === sig) return null
  } catch {
    /* storage unavailable — just show it */
  }
  return (
    <div className="dates-notice" role="status">
      <span aria-hidden>🩹</span>
      <div className="dates-notice-text">
        <b>{report.affectedShows} shows are missing real watch dates</b> — their order here
        won&apos;t match your true history. Re-import your TV Time export (it repairs the dates
        in place) to fix the order.
      </div>
      <div className="dates-notice-actions">
        <Link className="btn small primary" to="/migrate">
          Repair via import
        </Link>
        <button
          className="btn small"
          onClick={() => {
            try {
              localStorage.setItem(DATES_NOTICE_KEY, sig)
            } catch {
              /* ignore */
            }
            force((n) => n + 1)
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

// ---------- grid filters (P4a) ----------

type StatusFilter = 'all' | 'watching' | 'uptodate' | 'notstarted' | 'paused'
type SortMode = 'az' | 'recent' | 'behind' | 'watched'

interface ShowsFilters {
  status: StatusFilter
  genre: string // '' = any
  network: string // '' = any
  sort: SortMode
}

const FILTERS_KEY = 'raedtracker_shows_filters'
const DEFAULT_FILTERS: ShowsFilters = { status: 'all', genre: '', network: '', sort: 'recent' }

function loadFilters(): ShowsFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY)
    if (!raw) return { ...DEFAULT_FILTERS }
    const parsed = JSON.parse(raw) as Partial<ShowsFilters>
    return {
      status: parsed.status ?? DEFAULT_FILTERS.status,
      genre: typeof parsed.genre === 'string' ? parsed.genre : '',
      network: typeof parsed.network === 'string' ? parsed.network : '',
      sort: parsed.sort ?? DEFAULT_FILTERS.sort,
    }
  } catch {
    return { ...DEFAULT_FILTERS }
  }
}

function saveFilters(f: ShowsFilters) {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(f))
  } catch {
    /* filters just won't persist */
  }
}

const filtersActive = (f: ShowsFilters) =>
  f.status !== 'all' || f.genre !== '' || f.network !== '' || f.sort !== DEFAULT_FILTERS.sort

/** Per-show status bucket used by grid badges + the status filter. */
type ShowStatus = 'uptodate' | 'notstarted' | 'paused' | 'watching'
function showStatus(show: TrackedShow): ShowStatus {
  if (show.paused) return 'paused'
  const seen = watchedCount(show)
  if (seen === 0) return 'notstarted'
  if (nextEpisode(show) === null) return 'uptodate'
  return 'watching'
}

/** Does a non-paused show have a newly-aired (<=7d) unwatched episode? */
function hasNewlyAired(show: TrackedShow): boolean {
  if (show.paused) return false
  const next = show.snapshot.nextEpisodeToAir
  // Cheap heuristic on the snapshot: if the queue's next episode is unwatched
  // and there is behind-count > 0 we can't know air dates here, so fall back to
  // the freshness engine at the call site. This helper stays snapshot-only.
  if (next?.airDate) {
    const diff = Date.now() - new Date(next.airDate).getTime()
    if (diff >= 0 && diff <= 7 * 86400000) {
      const key = episodeKey(next.season, next.episode)
      if (!show.watched[key]) return true
    }
  }
  return false
}

// ---------- pull-to-refresh (touch) ----------

const PULL_THRESHOLD = 64 // px of indicator height that arms the release
const PULL_MAX = 110 // elastic cap
const PULL_HOLD = 48 // indicator height while refreshing
const PULL_MIN_SPIN_MS = 600 // keep the spinner visible at least this long

type PtrPhase = 'idle' | 'pulling' | 'refreshing'

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Elastic pull-to-refresh on `targetRef` (fires only when the document is
 * scrolled to the top). The indicator element (`spacerRef`) has its height
 * driven imperatively so touchmove never re-renders the page; React state
 * only tracks the coarse phase + "armed past threshold" flag.
 */
function usePullToRefresh(
  targetRef: RefObject<HTMLDivElement | null>,
  spacerRef: RefObject<HTMLDivElement | null>,
) {
  // React state is presentational only; the gesture logic below runs on
  // plain locals so it never lags behind batched renders.
  const [phase, setPhase] = useState<PtrPhase>('idle')
  const [armed, setArmed] = useState(false)

  // Suppress the browser's native overscroll/pull-to-reload while mounted.
  useEffect(() => {
    const root = document.documentElement
    const prev = root.style.overscrollBehaviorY
    root.style.overscrollBehaviorY = 'contain'
    return () => {
      root.style.overscrollBehaviorY = prev
    }
  }, [])

  useEffect(() => {
    const el = targetRef.current
    if (!el) return

    let startY = 0
    let dist = 0
    let tracking = false
    let busy = false // a triggered refresh is still settling

    const setHeight = (px: number, animate: boolean) => {
      const sp = spacerRef.current
      if (!sp) return
      sp.style.transition = animate && !prefersReducedMotion() ? 'height 0.25s ease' : 'none'
      sp.style.height = `${px}px`
    }

    const reset = (animate: boolean) => {
      setPhase('idle')
      setArmed(false)
      setHeight(0, animate)
    }

    const onStart = (e: TouchEvent) => {
      if (busy) return
      // Touches on the EpisodeSheet modal (a DOM child of this page) must not
      // drive pull-to-refresh: it would block the sheet's own scrolling and
      // fire a hidden forced refresh behind the backdrop.
      if (e.target instanceof Element && e.target.closest('.epsheet-backdrop')) return
      const top = document.scrollingElement?.scrollTop ?? window.scrollY
      if (top > 0) return
      startY = e.touches[0].clientY
      dist = 0
      tracking = true
    }

    const onMove = (e: TouchEvent) => {
      if (!tracking || busy) return
      const dy = e.touches[0].clientY - startY
      if (dy <= 0) {
        // Scrolling up — bail out of the gesture.
        if (dist > 0) reset(false)
        dist = 0
        return
      }
      const top = document.scrollingElement?.scrollTop ?? window.scrollY
      if (top > 0) {
        tracking = false
        if (dist > 0) reset(false)
        dist = 0
        return
      }
      if (e.cancelable) e.preventDefault() // we own the gesture now
      dist = Math.min(PULL_MAX, dy * 0.45) // elastic resistance
      setHeight(dist, false)
      setPhase('pulling')
      setArmed(dist >= PULL_THRESHOLD)
    }

    const onEnd = () => {
      if (!tracking || busy) return
      tracking = false
      if (dist >= PULL_THRESHOLD) {
        busy = true
        setPhase('refreshing')
        setArmed(false)
        setHeight(PULL_HOLD, true)
        const started = Date.now()
        void refreshFollowedShows({ force: true }).finally(() => {
          // Hold the spinner briefly so instant runs don't flicker.
          const wait = Math.max(0, PULL_MIN_SPIN_MS - (Date.now() - started))
          window.setTimeout(() => {
            busy = false
            reset(true)
          }, wait)
        })
      } else if (dist > 0) {
        reset(true)
      }
      dist = 0
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [targetRef, spacerRef])

  return { phase, armed }
}

// ---------- queue row ----------

// Memoized: the store updates immutably per show, so a single check-off only
// re-renders the affected row instead of all ~N queue rows.
const QueueRow = memo(function QueueRow({
  show,
  index,
  resuming,
  onCaughtUp,
  onOpenSheet,
}: {
  show: TrackedShow
  index: number
  resuming?: boolean
  onCaughtUp: (id: number) => void
  onOpenSheet: (s: SheetInfo) => void
}) {
  const toggleEpisode = useLibrary((s) => s.toggleEpisode)
  const reactionPrompt = useLibrary((s) => s.reactionPrompt)
  const snap = show.snapshot

  // While the row animates out (fully caught up) keep showing the last episode.
  const storeNext = nextEpisode(show)
  const lastRef = useRef(storeNext)
  if (storeNext) lastRef.current = storeNext
  const shown = storeNext ?? lastRef.current
  const leaving = storeNext === null

  const [pop, setPop] = useState(false)
  const [flash, setFlash] = useState(false)
  const [checked, setChecked] = useState(false)
  const [epInfo, setEpInfo] = useState<{
    title: string
    airDate: string | null
    still: string | null
  } | null>(null)
  const [epLoading, setEpLoading] = useState(index < PREFETCH_CAP)
  // Which still src has finished loading — drives the crossfade + widening.
  const [stillLoadedSrc, setStillLoadedSrc] = useState<string | null>(null)

  const season = shown?.season
  const episode = shown?.episode

  useEffect(() => {
    if (season == null || episode == null || index >= PREFETCH_CAP) return
    let alive = true
    setEpLoading(true)
    setEpInfo(null)
    fetchSeason(snap.id, season)
      .then((d) => {
        if (!alive) return
        const ep = d.episodes.find((e) => e.episode_number === episode)
        setEpInfo(ep ? { title: ep.name, airDate: ep.air_date, still: ep.still_path } : null)
      })
      .catch(() => {
        /* row still renders without a title */
      })
      .finally(() => {
        if (alive) setEpLoading(false)
      })
    return () => {
      alive = false
    }
  }, [snap.id, season, episode, index])

  // Episode still (16:9) crossfades over the poster once it has loaded.
  const stillSrc = stillUrl(epInfo?.still ?? null)
  const stillOn = stillSrc !== null && stillLoadedSrc === stillSrc

  // P0g row-exit: when the row advances to a new episode, briefly render the
  // OUTGOING poster+still as an absolute overlay that slides/fades out while
  // the new art fades in underneath. `outgoing` holds the frozen last art.
  const epKeyStr = shown ? `${shown.season}:${shown.episode}` : ''
  const prevEpKeyRef = useRef(epKeyStr)
  const [outgoing, setOutgoing] = useState<{ poster: string | null; still: string | null } | null>(
    null,
  )
  const outgoingTimer = useRef<number | null>(null)
  const checkFxTimer = useRef<number | null>(null)
  const lastArtRef = useRef<{ poster: string | null; still: string | null }>({
    poster: snap.poster_path,
    still: null,
  })
  // Keep the "current art" ref fresh for the NEXT advance to reference.
  lastArtRef.current = { poster: snap.poster_path, still: stillOn ? stillSrc : null }

  useEffect(() => {
    if (prevEpKeyRef.current === epKeyStr) return
    // Freeze the art that was on screen for the episode we just left.
    setOutgoing(lastArtRef.current)
    prevEpKeyRef.current = epKeyStr
    // NOTE: `checked` is deliberately NOT reset here. toggleEpisode() advances
    // the episode synchronously inside handleCheck, so this effect fires in the
    // same commit as setChecked(true) — clearing it here killed the tick-draw
    // animation before it ever painted. handleCheck's own timer resets it.
    if (outgoingTimer.current) window.clearTimeout(outgoingTimer.current)
    outgoingTimer.current = window.setTimeout(() => setOutgoing(null), 420)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epKeyStr])

  useEffect(
    () => () => {
      if (outgoingTimer.current) window.clearTimeout(outgoingTimer.current)
      if (checkFxTimer.current) window.clearTimeout(checkFxTimer.current)
    },
    [],
  )

  if (!shown) return null

  const behind = behindCount(show)
  const isNew = (() => {
    if (!epInfo?.airDate) return false
    const diff = Date.now() - new Date(epInfo.airDate).getTime()
    return diff >= 0 && diff <= 7 * 86400000
  })()

  const handleCheck = (btn: HTMLButtonElement) => {
    if (leaving) return
    // Haptic tick where supported (Android Chrome etc.); iOS Safari has no
    // navigator.vibrate, so the optional call is a silent no-op there.
    try {
      navigator.vibrate?.(12)
    } catch {
      /* haptics unavailable — non-critical */
    }
    const { season: s, episode: e } = shown
    setPop(true)
    setChecked(true)
    setFlash(true)
    // One timer clears all three transient classes; keep a ref so a rapid
    // second check restarts the window instead of truncating its animation.
    if (checkFxTimer.current) window.clearTimeout(checkFxTimer.current)
    checkFxTimer.current = window.setTimeout(() => {
      setPop(false)
      setFlash(false)
      // Reset the tick to idle for the next (already-shown) episode.
      setChecked(false)
    }, 700)

    // Snapshot pre-check state for milestone deltas: lifetime episode total
    // across ALL shows and the longest-streak length, both compared after the
    // toggle so we only celebrate a genuine increase.
    const before = useLibrary.getState()
    const wasStale = Date.now() - lastActivity(show) > STALE_MS
    let lifetimeBefore = 0
    for (const sh of Object.values(before.shows)) lifetimeBefore += watchedCount(sh)
    const streakBefore = computeStreaks(before.shows, before.movies)

    toggleEpisode(snap.id, s, e)

    const after = useLibrary.getState()
    const updated = after.shows[snap.id]

    let lifetimeAfter = 0
    for (const sh of Object.values(after.shows)) lifetimeAfter += watchedCount(sh)
    const streakAfter = computeStreaks(after.shows, after.movies)

    // Milestone detection on the check-offs users actually reach: series/season
    // premieres, season finales, lifetime hundreds/thousands, new best streak,
    // and every 10th lifetime episode. Big completions keep the full burst;
    // the rest get a quick micro-burst.
    const seriesPremiere = updated ? isSeriesPremiere(updated, s, e) : false
    const seasonPremiere = updated ? isSeasonPremiere(updated, s, e) : false
    const seasonFinale = updated ? isSeasonFinale(updated, s, e) : false
    const tenth = lifetimeAfter > 0 && lifetimeAfter % 10 === 0
    // Crossed a hundred/thousand boundary on THIS check (compare before/after).
    const hitHundred =
      Math.floor(lifetimeAfter / 100) > Math.floor(lifetimeBefore / 100) && lifetimeAfter >= 100
    const hitThousand =
      Math.floor(lifetimeAfter / 1000) > Math.floor(lifetimeBefore / 1000) && lifetimeAfter >= 1000
    const newBestStreak = streakAfter.longest > streakBefore.longest

    // Sheet-worthy milestones are exactly what the Settings copy documents:
    // premieres, finales and completions. Round-number/streak celebrations
    // below stay confetti + toast only — an unexplained sheet on the 20th
    // lifetime episode read as a random quiz.
    const caughtUp = updated ? nextEpisode(updated) === null : false
    const reactionMilestone =
      caughtUp ||
      (updated ? seasonComplete(updated, s) : false) ||
      seasonFinale ||
      seriesPremiere ||
      seasonPremiere

    // P5b: checking an episode of a STALE show (no activity for >1 month before
    // this check) opens the EpisodeSheet in its 'pause-this' variant instead of
    // the normal reaction sheet — nudging the user to pause or resume in
    // earnest. Takes precedence over the reaction-frequency preference.
    const openPause = wasStale && updated !== undefined && !caughtUp
    // Reaction-sheet frequency: 'always' opens the deep-react sheet on every
    // check-off, 'milestones' only on premieres/finales/completions, 'never'
    // relies on the toast + inline reactions on the show page.
    const openReact =
      !openPause &&
      (reactionPrompt === 'always' || (reactionPrompt === 'milestones' && reactionMilestone))

    // The reaction sheet confirms the check itself and carries its own Undo —
    // a simultaneous toast stacked on top of the sheet and hid the emoji row.
    if (!openReact) {
      showToast(`${snap.name} · ${epCode(s, e)} watched ✓`, '📺', {
        label: 'Undo',
        onClick: () => toggleEpisode(snap.id, s, e),
      })
    }
    // Drop lingering focus once no sheet needs it — a resting focus/hover
    // state painted a false "watched" ring on the NEXT episode's circle.
    if (!openPause && !openReact) btn.blur()

    if (caughtUp) {
      fireConfetti()
      showToast(`All caught up on ${snap.name} 🎉`)
      onCaughtUp(snap.id)
    } else if (updated && seasonComplete(updated, s)) {
      // Season finale / season complete — full burst.
      fireConfetti()
      showToast(`Season ${s} complete! 🎉`, '🏆')
    } else if (seasonFinale) {
      fireConfetti()
      showToast(`Season ${s} finale watched 🎬`, '🏁')
    } else if (hitThousand) {
      // Lifetime 1000th — full burst.
      fireConfetti()
      showToast(`${lifetimeAfter.toLocaleString()} episodes watched! 🎉`, '🏆')
    } else if (hitHundred) {
      // Lifetime 100th (and every following hundred) — micro-burst.
      fireConfetti({ intensity: 'micro' })
      showToast(`${lifetimeAfter} episodes watched! 🎉`, '💯')
    } else if (newBestStreak) {
      // Extended the streak to a new personal best — micro-burst.
      fireConfetti({ intensity: 'micro' })
      showToast(`New best streak — ${streakAfter.longest} days! 🔥`, '🔥')
    } else if (seriesPremiere) {
      fireConfetti({ intensity: 'micro' })
      showToast(`${snap.name} — series premiere! 🎉`, '🎬')
    } else if (seasonPremiere) {
      fireConfetti({ intensity: 'micro' })
      showToast(`Season ${s} premiere 🎬`, '🎬')
    } else if (tenth) {
      fireConfetti({ intensity: 'micro' })
      showToast(`${lifetimeAfter} episodes watched! 🎉`, '🔟')
    }

    if (openPause) {
      onOpenSheet({
        showId: snap.id,
        showName: snap.name,
        season: s,
        episode: e,
        episodeTitle: epInfo?.title,
        variant: 'pause-this',
      })
    } else if (openReact) {
      onOpenSheet({
        showId: snap.id,
        showName: snap.name,
        season: s,
        episode: e,
        episodeTitle: epInfo?.title,
        onUndo: () => toggleEpisode(snap.id, s, e),
      })
    }
  }

  return (
    <div
      className={`queue-row${flash ? ' flash' : ''}${leaving ? ' leaving' : ''}${
        resuming ? ' resuming' : ''
      }`}
    >
      <Link
        to={`/show/${snap.id}`}
        className={`queue-poster${stillOn ? ' has-still' : ''}`}
        title={snap.name}
      >
        {/* Incoming art (keyed on episode so it re-mounts + fades in). */}
        <div key={epKeyStr} className="queue-art-in">
          <PosterImage path={snap.poster_path} title={snap.name} />
          {stillSrc && (
            <img
              className={`queue-still${stillOn ? ' on' : ''}`}
              src={stillSrc}
              alt=""
              loading="lazy"
              ref={(img) => {
                // Cached stills can complete before onLoad is attached.
                if (img && img.complete && img.naturalWidth > 0) setStillLoadedSrc(stillSrc)
              }}
              onLoad={() => setStillLoadedSrc(stillSrc)}
            />
          )}
        </div>
        {/* Outgoing art — frozen copy of the episode we just left, fading out. */}
        {outgoing && (
          <div className="queue-art-out" aria-hidden="true">
            {outgoing.still ? (
              <img className="queue-still on" src={outgoing.still} alt="" />
            ) : (
              <PosterImage path={outgoing.poster} title="" />
            )}
          </div>
        )}
      </Link>

      <div className="queue-main">
        <Link to={`/show/${snap.id}`} className="queue-showpill">
          <span className="queue-showpill-name">{snap.name}</span>
          <span className="queue-showpill-arrow" aria-hidden="true">
            ›
          </span>
        </Link>

        {/* Keyed by episode so advancing slides the new episode in. */}
        <div key={`s${shown.season}e${shown.episode}`} className="queue-ep">
          <div className="queue-ep-line">
            <span className="queue-ep-code">
              S{pad2(shown.season)} <span className="queue-ep-sep">|</span> E{pad2(shown.episode)}
            </span>
            {behind > 0 && !leaving && (
              // Same definition as the grid badge: TOTAL unwatched aired
              // episodes (the two views previously disagreed by one).
              <span
                className="queue-behind"
                title={`${behind + 1} aired episodes to watch`}
              >
                {behind + 1} left
              </span>
            )}
            {shown.episode === 1 && <span className="queue-badge premiere">Premiere</span>}
            {isNew && <span className="queue-badge new">New</span>}
          </div>
          <div className="queue-ep-title">{epLoading ? '…' : epInfo?.title ?? ''}</div>
        </div>
      </div>

      <button
        className={`queue-check${pop ? ' pop' : ''}${checked ? ' checked' : ''}`}
        onClick={(ev) => handleCheck(ev.currentTarget)}
        title={`Mark ${epCode(shown.season, shown.episode)} watched`}
        aria-label={`Mark ${snap.name} ${epCode(shown.season, shown.episode)} watched`}
      >
        <svg
          className="queue-check-svg"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M5 12.5l4.2 4.2L19 7"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
})

// ---------- compact rows (paused / filtered views) ----------

function CompactRow({ show, action }: { show: TrackedShow; action?: ReactNode }) {
  const snap = show.snapshot
  const seen = displayWatchedCount(show)
  return (
    <div className="queue-compact-row">
      <Link to={`/show/${snap.id}`} className="queue-compact-poster" title={snap.name}>
        <PosterImage path={snap.poster_path} title={snap.name} />
      </Link>
      <div className="queue-compact-main">
        <Link to={`/show/${snap.id}`} className="queue-compact-name">
          {snap.name}
        </Link>
        <div className="queue-compact-progress">
          <ProgressBar value={showProgress(show)} />
          <span className="queue-compact-eps">
            {seen}/{snap.totalEpisodes}
          </span>
        </div>
      </div>
      {action}
    </div>
  )
}

// ---------- page ----------

type View = 'queue' | 'notstarted' | 'uptodate'
type Layout = 'list' | 'grid'

const LAYOUT_KEY = 'raedtracker_shows_view'

// P4c: the poster grid is the PRIMARY landing view. First-time visitors (no
// stored preference) get grid; the list/grid toggle still switches and persists.
function loadLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.5 4h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="1.5" y="10" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.5 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <polyline
        points="23 4 23 10 17 10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 3.5h12M4 8h8M6.5 12.5h3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default function MyShows() {
  const shows = useLibrary((s) => s.shows)
  const toggleEpisode = useLibrary((s) => s.toggleEpisode)
  const togglePauseShow = useLibrary((s) => s.togglePauseShow)

  const [view, setView] = useState<View>('queue')
  const [layout, setLayout] = useState<Layout>(loadLayout)
  const [favOnly, setFavOnly] = useState(false)
  const [filters, setFilters] = useState<ShowsFilters>(loadFilters)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sheet, setSheet] = useState<SheetInfo | null>(null)
  const [leavingIds, setLeavingIds] = useState<number[]>([])
  // Shows just un-paused: animate their re-insertion into Watch Next once.
  const [resumingIds, setResumingIds] = useState<number[]>([])

  // Freshness engine: refreshing flag (spinner) + newly-aired ribbon.
  const freshness = useSyncExternalStore(subscribeFreshness, getFreshnessSnapshot)
  const pageRef = useRef<HTMLDivElement>(null)
  const ptrRef = useRef<HTMLDivElement>(null)
  const { phase: ptrPhase, armed: ptrArmed } = usePullToRefresh(pageRef, ptrRef)

  const leaveTimers = useRef<number[]>([])
  useEffect(
    () => () => {
      for (const t of leaveTimers.current) window.clearTimeout(t)
    },
    [],
  )

  // Freeze row order + staleness bucket per visit, so a checked row advances
  // IN PLACE instead of jumping to the top of the "recently watched" sort.
  const layoutRef = useRef(new Map<number, { rank: number; stale: boolean }>())

  // All derived lists in one memo: sorting ~150 shows and scanning thousands
  // of watch records on every unrelated state change (sheet open, PTR phase,
  // freshness emits) caused 100ms+ renders per tap on large libraries.
  const {
    all,
    pool,
    gridPool,
    fresh,
    stale,
    paused,
    notStarted,
    upToDate,
    recent,
    totalEps,
    genreOptions,
    networkOptions,
  } = useMemo(() => {
    const all = Object.values(shows)
    const pool = favOnly ? all.filter((s) => s.favorite) : all
    const nowMs = Date.now()

    let nextRank = layoutRef.current.size
    for (const s of [...all].sort(byRecentActivity)) {
      if (!layoutRef.current.has(s.snapshot.id)) {
        layoutRef.current.set(s.snapshot.id, {
          rank: nextRank++,
          stale: nowMs - lastActivity(s) > STALE_MS,
        })
      }
    }
    const meta = (s: TrackedShow) =>
      layoutRef.current.get(s.snapshot.id) ?? { rank: 1e9, stale: false }
    const byRank = (a: TrackedShow, b: TrackedShow) => meta(a).rank - meta(b).rank

    // ----- P4a filters + sort apply to BOTH layouts (the sheet previously
    // only drove the grid, silently ignoring list view) -----
    const matchesFilters = (s: TrackedShow) => {
      if (filters.status !== 'all' && showStatus(s) !== filters.status) return false
      if (filters.genre && !s.snapshot.genres.includes(filters.genre)) return false
      if (filters.network && s.snapshot.network !== filters.network) return false
      return true
    }
    const filtered = pool.filter(matchesFilters)
    const sortShows = (list: TrackedShow[]) => {
      if (filters.sort === 'az')
        return [...list].sort((a, b) => a.snapshot.name.localeCompare(b.snapshot.name))
      if (filters.sort === 'behind')
        return [...list].sort((a, b) => behindCount(b) - behindCount(a) || byRank(a, b))
      if (filters.sort === 'watched') return [...list].sort(byRecentActivity)
      return [...list].sort(byRank) // recently added / frozen activity order
    }

    const queueable = filtered.filter(
      (s) => !s.paused && (nextEpisode(s) !== null || leavingIds.includes(s.snapshot.id)),
    )
    // "To Watch" = shows the user STOPPED recently: real watch activity
    // inside the recency window. Everything else queueable (stale momentum
    // or never started) belongs to "Haven't seen in a while".
    const stoppedRecently = (s: TrackedShow) => watchedCount(s) > 0 && !meta(s).stale
    const fresh = sortShows(queueable.filter(stoppedRecently))
    const stale = sortShows(queueable.filter((s) => !stoppedRecently(s)))
    const paused = sortShows(filtered.filter((s) => s.paused))
    const notStarted = sortShows(filtered.filter((s) => watchedCount(s) === 0))
    const upToDate = sortShows(
      filtered.filter((s) => !s.paused && watchedCount(s) > 0 && nextEpisode(s) === null),
    )

    // Last 10 checks across every show, newest first.
    const history: { show: TrackedShow; season: number; episode: number; watchedAt: string }[] = []
    for (const show of pool) {
      for (const [key, rec] of Object.entries(show.watched)) {
        const pe = parseEpKey(key)
        if (pe) history.push({ show, ...pe, watchedAt: rec.watchedAt })
      }
    }
    // Same-moment batches (Mark all / season fill share one timestamp) tie-
    // break by episode order so the list reads E05, E04, E03 — not scrambled.
    history.sort(
      (a, b) =>
        b.watchedAt.localeCompare(a.watchedAt) || b.season - a.season || b.episode - a.episode,
    )
    const recent = history.slice(0, 10)

    const totalEps = all.reduce((n, s) => n + watchedCount(s), 0)

    // ----- P4a filter option sets (from snapshots) -----
    const genreSet = new Set<string>()
    const networkSet = new Set<string>()
    for (const s of pool) {
      for (const g of s.snapshot.genres) genreSet.add(g)
      if (s.snapshot.network) networkSet.add(s.snapshot.network)
    }
    const genreOptions = [...genreSet].sort((a, b) => a.localeCompare(b))
    const networkOptions = [...networkSet].sort((a, b) => a.localeCompare(b))

    // ----- P4a/P4c: the grid pool is the same filtered + sorted set -----
    const gridPool = sortShows(filtered)

    return {
      all,
      pool,
      gridPool,
      fresh,
      stale,
      paused,
      notStarted,
      upToDate,
      recent,
      totalEps,
      genreOptions,
      networkOptions,
    }
  }, [shows, favOnly, leavingIds, filters])

  const handleCaughtUp = useCallback((id: number) => {
    setLeavingIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
    leaveTimers.current.push(
      window.setTimeout(() => setLeavingIds((ids) => ids.filter((x) => x !== id)), 520),
    )
  }, [])

  const handleResume = useCallback(
    (id: string | number) => {
      const numId = Number(id)
      togglePauseShow(numId)
      setResumingIds((ids) => (ids.includes(numId) ? ids : [...ids, numId]))
      leaveTimers.current.push(
        window.setTimeout(
          () => setResumingIds((ids) => ids.filter((x) => x !== numId)),
          460,
        ),
      )
    },
    [togglePauseShow],
  )
  const queueCount = fresh.length + stale.length

  // Persistence stays outside the setState updaters (updaters can run twice
  // / during render — side effects there are a React violation).
  const toggleLayout = () => {
    const next: Layout = layout === 'list' ? 'grid' : 'list'
    setLayout(next)
    try {
      localStorage.setItem(LAYOUT_KEY, next)
    } catch {
      /* view preference just won't persist */
    }
  }

  const patchFilters = (patch: Partial<ShowsFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    saveFilters(next)
  }
  const resetFilters = () => {
    const next = { ...DEFAULT_FILTERS }
    setFilters(next)
    saveFilters(next)
  }
  const hasActiveFilters = filtersActive(filters)
  // Filters that HIDE shows (a non-default sort alone can't empty the queue).
  const hasNarrowingFilters =
    filters.status !== 'all' || filters.genre !== '' || filters.network !== ''

  // Show IDs that just gained episodes on the last refresh (drives the grid
  // NEW badge alongside the persistent snapshot heuristic).
  const freshShowIds = useMemo(
    () => new Set(freshness.newlyAired.map((g) => g.showId)),
    [freshness.newlyAired],
  )

  // Zero-count chips are pure noise — each chip appears once it has content
  // (or while its view is open, so it can still be toggled off).
  const browseChips = (
    <div className="queue-browse">
      {(notStarted.length > 0 || view === 'notstarted') && (
        <button
          className={`queue-chip${view === 'notstarted' ? ' active' : ''}`}
          onClick={() => setView(view === 'notstarted' ? 'queue' : 'notstarted')}
        >
          ○ Not started <span className="queue-chip-count">{notStarted.length}</span>
        </button>
      )}
      {(upToDate.length > 0 || view === 'uptodate') && (
        <button
          className={`queue-chip${view === 'uptodate' ? ' active' : ''}`}
          onClick={() => setView(view === 'uptodate' ? 'queue' : 'uptodate')}
        >
          ✓ Up to date <span className="queue-chip-count">{upToDate.length}</span>
        </button>
      )}
      {view !== 'queue' && (
        <button className="queue-chip" onClick={() => setView('queue')}>
          ‹ Back to queue
        </button>
      )}
    </div>
  )

  return (
    <div ref={pageRef}>
      {/* Elastic pull-to-refresh indicator (height driven by usePullToRefresh) */}
      <div
        ref={ptrRef}
        className={`ptr${ptrArmed ? ' armed' : ''}${ptrPhase === 'refreshing' ? ' refreshing' : ''}`}
        aria-hidden={ptrPhase === 'idle'}
      >
        <div className="ptr-inner">
          {ptrPhase === 'refreshing' ? (
            <span className="ptr-spinner" aria-hidden="true" />
          ) : (
            <span className="ptr-arrow" aria-hidden="true">
              ↓
            </span>
          )}
          <span className="ptr-label">
            {ptrPhase === 'refreshing'
              ? 'Checking for new episodes…'
              : ptrArmed
                ? 'Release to refresh'
                : 'Pull to refresh'}
          </span>
        </div>
      </div>

      <StampedDatesNotice />
      <div className="toptabs" role="tablist" aria-label="My Shows sections">
        <span className="toptab active" role="tab" aria-selected="true">
          Keep Watching
          {queueCount > 0 && <span className="toptab-count">{queueCount}</span>}
        </span>
        <Link to="/upcoming" className="toptab" role="tab" aria-selected="false">
          Upcoming
        </Link>
        <Link to="/watchlist" className="toptab" role="tab" aria-selected="false">
          Watchlist
        </Link>
        <span className="toptabs-spacer" />
        {/* First run: no content means nothing to filter, favorite or re-lay-
            out — hide the whole action cluster so the empty state is the one
            focal point. */}
        {all.length > 0 && (
        <div className="toptabs-actions">
          <button
            className={`queue-chip queue-fav${favOnly ? ' active' : ''}`}
            onClick={() => setFavOnly((v) => !v)}
            title="Only favorite shows"
            aria-pressed={favOnly}
          >
            ★ Favorites
          </button>
          <button
            className={`queue-chip queue-filters-btn${hasActiveFilters ? ' active' : ''}`}
            onClick={() => setFiltersOpen(true)}
            title="Filter & sort the grid"
            aria-haspopup="dialog"
          >
            <FilterIcon />
            <span className="queue-filters-label">Filters</span>
            {hasActiveFilters && <span className="queue-filters-dot" aria-hidden="true" />}
          </button>
          <button
            className={`view-toggle queue-refresh-btn${freshness.refreshing ? ' spinning' : ''}`}
            onClick={() => void refreshFollowedShows({ force: true })}
            disabled={freshness.refreshing}
            title="Check for new episodes"
            aria-label="Check for new episodes"
          >
            <RefreshIcon />
          </button>
          <button
            className="view-toggle"
            onClick={toggleLayout}
            title={layout === 'list' ? 'Switch to grid view' : 'Switch to list view'}
            aria-label={layout === 'list' ? 'Switch to grid view' : 'Switch to list view'}
          >
            {layout === 'list' ? <GridIcon /> : <ListIcon />}
          </button>
        </div>
        )}
      </div>

      {/* No placeholder sentence on first run — the empty state below is the
          single message. */}
      {all.length > 0 && (
        <p className="page-subtitle">
          {`${all.length} ${all.length === 1 ? 'show' : 'shows'} tracked · ${totalEps} ${
            totalEps === 1 ? 'episode' : 'episodes'
          } watched`}
        </p>
      )}

      {freshness.newlyAired.length > 0 && (
        <div className="queue-ribbon" role="status">
          <span className="queue-ribbon-icon" aria-hidden="true">
            📡
          </span>
          <span className="queue-ribbon-text">
            New episodes:{' '}
            {freshness.newlyAired.map((g, i) => (
              <span key={g.showId} className="queue-ribbon-item">
                {i > 0 && ', '}
                <Link to={`/show/${g.showId}`}>{g.name}</Link>{' '}
                <span className="queue-ribbon-count">+{g.count}</span>
              </span>
            ))}
          </span>
          <button
            className="queue-ribbon-dismiss"
            onClick={markSeen}
            title="Dismiss"
            aria-label="Dismiss new episodes notice"
          >
            ✕
          </button>
        </div>
      )}

      {all.length === 0 ? (
        <div className="empty-state fade-in">
          <div className="big">📺</div>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
            You aren't tracking any shows yet
          </p>
          <p style={{ marginTop: 4 }}>Find something great and start checking off episodes.</p>
          <Link className="btn primary" to="/search" style={{ marginTop: 18 }}>
            Find shows to track
          </Link>
        </div>
      ) : view !== 'queue' ? (
        <>
          {browseChips}
          <h2 className="queue-section-title">
            {view === 'notstarted' ? '○ Not started' : '✓ Up to date'}
          </h2>
          {(view === 'notstarted' ? notStarted : upToDate).length === 0 ? (
            <div className="empty-state fade-in">
              <div className="big">{view === 'notstarted' ? '🌱' : '🏁'}</div>
              <p>
                {view === 'notstarted'
                  ? 'No untouched shows — everything here has at least one episode watched.'
                  : 'No shows fully caught up yet. Keep watching!'}
              </p>
              <Link className="btn primary" to="/search" style={{ marginTop: 18 }}>
                Find more shows
              </Link>
            </div>
          ) : (
            <div className="queue-list stagger">
              {(view === 'notstarted' ? notStarted : upToDate).map((s) => (
                <CompactRow key={s.snapshot.id} show={s} />
              ))}
            </div>
          )}
        </>
      ) : layout === 'grid' ? (
        pool.length === 0 ? (
          <div className="empty-state fade-in">
            <div className="big">☆</div>
            <p>No favorites yet — hit the ★ star on any show.</p>
          </div>
        ) : gridPool.length === 0 ? (
          <div className="empty-state fade-in">
            <div className="big">🔍</div>
            <p>No shows match these filters.</p>
            <button className="btn primary" onClick={resetFilters} style={{ marginTop: 18 }}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="poster-grid stagger">
            {gridPool.map((s) => {
              const seen = displayWatchedCount(s)
              const status = showStatus(s)
              const behind = status === 'watching' ? behindCount(s) + 1 : 0
              // NEW badge: snapshot heuristic (aired within 7d, unwatched) OR a
              // fresh hit from the last refresh (before the ribbon is dismissed).
              const newlyAired =
                status !== 'paused' &&
                (hasNewlyAired(s) || freshShowIds.has(s.snapshot.id))
              return (
                <Link
                  key={s.snapshot.id}
                  to={`/show/${s.snapshot.id}`}
                  className="queue-grid-card"
                  title={s.snapshot.name}
                >
                  <div className="queue-grid-poster">
                    <PosterImage path={s.snapshot.poster_path} title={s.snapshot.name} />
                    {/* P4b status/behind badges overlaid on the poster. */}
                    <div className="queue-grid-badges" aria-hidden="true">
                      {status === 'paused' && (
                        <span className="grid-badge paused" title="Paused">
                          ⏸
                        </span>
                      )}
                      {status === 'uptodate' && (
                        <span className="grid-badge uptodate" title="Up to date">
                          ✓
                        </span>
                      )}
                      {status === 'watching' && behind > 0 && (
                        <span className="grid-badge behind" title={`${behind} to watch`}>
                          +{behind}
                        </span>
                      )}
                      {newlyAired && (
                        <span className="grid-badge new" title="New episode aired">
                          NEW
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="queue-grid-name">{s.snapshot.name}</div>
                  <div className="queue-grid-progress">
                    <ProgressBar value={showProgress(s)} />
                    <span className="queue-grid-eps">
                      {seen}/{s.snapshot.totalEpisodes}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )
      ) : (
        <>
          {recent.length > 0 && (
            <section className="queue-section">
              <button
                className="queue-collapse-head"
                onClick={() => setHistoryOpen((v) => !v)}
                aria-expanded={historyOpen}
              >
                <span className={`queue-caret${historyOpen ? ' open' : ''}`} aria-hidden="true">
                  ▸
                </span>
                Watched history
                {/* "last N", not a bare count — a bare "10" read as the
                    lifetime total and contradicted the header stats. */}
                <span className="queue-chip-count">last {recent.length}</span>
              </button>
              {historyOpen && (
                <div className="queue-history stagger">
                  {recent.map((h) => (
                    <div
                      key={`${h.show.snapshot.id}:s${h.season}e${h.episode}`}
                      className="queue-history-row"
                    >
                      <Link to={`/show/${h.show.snapshot.id}`} className="queue-history-name">
                        {h.show.snapshot.name}
                      </Link>
                      <span className="queue-history-ep">{epCode(h.season, h.episode)}</span>
                      <span className="queue-history-time">{timeAgo(h.watchedAt)}</span>
                      <button
                        className="queue-undo"
                        title="Undo — mark unwatched"
                        aria-label="Undo — mark unwatched"
                        onClick={() => {
                          toggleEpisode(h.show.snapshot.id, h.season, h.episode)
                          showToast(
                            `${h.show.snapshot.name} · ${epCode(h.season, h.episode)} unchecked ↩`,
                            '↩️',
                          )
                        }}
                      >
                        ✓
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="queue-section">
            {/* "Up next", not "To Watch" — the active tab already says Keep
                Watching, and "To watch" is a Movies segment name. */}
            <h2 className="queue-section-title">Up next</h2>
            {fresh.length === 0 && stale.length === 0 ? (
              hasNarrowingFilters ? (
                // A narrowing filter (status/genre/network) is hiding the
                // queue — never show the "all caught up" celebration while
                // unwatched episodes are merely filtered out.
                <div className="empty-state fade-in">
                  <div className="big">🔍</div>
                  <p>No shows match these filters.</p>
                  <button className="btn primary" onClick={resetFilters} style={{ marginTop: 18 }}>
                    Clear filters
                  </button>
                </div>
              ) : (
              <div className="empty-state fade-in">
                <div className="big">{favOnly && pool.length === 0 ? '☆' : '🎉'}</div>
                <p>
                  {favOnly && pool.length === 0
                    ? 'No favorites yet — hit the ★ star on any show.'
                    : 'All caught up — nothing left to watch.'}
                </p>
                <Link className="btn primary" to="/search" style={{ marginTop: 18 }}>
                  Find something new
                </Link>
              </div>
              )
            ) : (
              <div className="queue-list stagger">
                {fresh.map((s, i) => (
                  <QueueRow
                    key={s.snapshot.id}
                    show={s}
                    index={i}
                    resuming={resumingIds.includes(s.snapshot.id)}
                    onCaughtUp={handleCaughtUp}
                    onOpenSheet={setSheet}
                  />
                ))}
              </div>
            )}
          </section>

          {stale.length > 0 && (
            <section className="queue-section">
              <h2 className="queue-section-title">Haven't seen in a while</h2>
              <div className="queue-list stagger">
                {stale.map((s, i) => (
                  <QueueRow
                    key={s.snapshot.id}
                    show={s}
                    index={fresh.length + i}
                    resuming={resumingIds.includes(s.snapshot.id)}
                    onCaughtUp={handleCaughtUp}
                    onOpenSheet={setSheet}
                  />
                ))}
              </div>
            </section>
          )}

          {paused.length > 0 && (
            <section className="queue-section">
              <h2 className="queue-section-title">Paused</h2>
              <div className="queue-list stagger">
                {paused.map((s) => (
                  <CompactRow
                    key={s.snapshot.id}
                    show={s}
                    action={
                      <button
                        className="btn small"
                        onClick={() => {
                          handleResume(s.snapshot.id)
                          showToast(`Resumed ${s.snapshot.name} ▶`, '▶️')
                        }}
                      >
                        ▶ Resume
                      </button>
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {browseChips}
        </>
      )}

      {sheet && <EpisodeSheet {...sheet} onClose={() => setSheet(null)} />}

      {filtersOpen && (
        <FiltersSheet
          filters={filters}
          genreOptions={genreOptions}
          networkOptions={networkOptions}
          matchCount={gridPool.length}
          onPatch={patchFilters}
          onReset={resetFilters}
          onClose={() => setFiltersOpen(false)}
        />
      )}
    </div>
  )
}

// ---------- filters sheet (P4a) — slide-up, EpisodeSheet-styled ----------

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'watching', label: 'Watching' },
  { value: 'uptodate', label: 'Up to date' },
  { value: 'notstarted', label: 'Not started' },
  { value: 'paused', label: 'Paused' },
]

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'az', label: 'A–Z' },
  { value: 'recent', label: 'Recently added' },
  { value: 'watched', label: 'Recently watched' },
  { value: 'behind', label: 'Most behind' },
]

function FiltersSheet({
  filters,
  genreOptions,
  networkOptions,
  matchCount,
  onPatch,
  onReset,
  onClose,
}: {
  filters: ShowsFilters
  genreOptions: string[]
  networkOptions: string[]
  matchCount: number
  onPatch: (patch: Partial<ShowsFilters>) => void
  onReset: () => void
  onClose: () => void
}) {
  // Close on Escape; lock body scroll while the sheet is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="shfilters-backdrop" onClick={onClose}>
      <div
        className="shfilters"
        role="dialog"
        aria-modal="true"
        aria-label="Filter and sort shows"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shfilters-grip" aria-hidden="true" />
        <div className="shfilters-head">
          <h2 className="shfilters-title">Filters</h2>
          <button className="shfilters-reset" onClick={onReset} disabled={!filtersActive(filters)}>
            Reset
          </button>
        </div>

        <div className="shfilters-body">
          <div className="shfilters-group">
            <div className="shfilters-label">Status</div>
            <div className="shfilters-chips">
              {STATUS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`shfilters-chip${filters.status === o.value ? ' active' : ''}`}
                  onClick={() => onPatch({ status: o.value })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {genreOptions.length > 0 && (
            <div className="shfilters-group">
              <div className="shfilters-label">Genre</div>
              <div className="shfilters-chips">
                <button
                  className={`shfilters-chip${filters.genre === '' ? ' active' : ''}`}
                  onClick={() => onPatch({ genre: '' })}
                >
                  Any
                </button>
                {genreOptions.map((g) => (
                  <button
                    key={g}
                    className={`shfilters-chip${filters.genre === g ? ' active' : ''}`}
                    onClick={() => onPatch({ genre: filters.genre === g ? '' : g })}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          )}

          {networkOptions.length > 0 && (
            <div className="shfilters-group">
              <div className="shfilters-label">Network</div>
              <div className="shfilters-chips">
                <button
                  className={`shfilters-chip${filters.network === '' ? ' active' : ''}`}
                  onClick={() => onPatch({ network: '' })}
                >
                  Any
                </button>
                {networkOptions.map((n) => (
                  <button
                    key={n}
                    className={`shfilters-chip${filters.network === n ? ' active' : ''}`}
                    onClick={() => onPatch({ network: filters.network === n ? '' : n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="shfilters-group">
            <div className="shfilters-label">Sort</div>
            <div className="shfilters-chips">
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`shfilters-chip${filters.sort === o.value ? ' active' : ''}`}
                  onClick={() => onPatch({ sort: o.value })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button className="shfilters-apply" onClick={onClose}>
          Show {matchCount} {matchCount === 1 ? 'show' : 'shows'}
        </button>
      </div>
    </div>
  )
}
