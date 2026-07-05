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
import { PosterImage, ProgressBar, timeAgo } from '../components/shared'
import { showToast } from '../components/toast'
import { fireConfetti } from '../components/Confetti'
import EpisodeSheet from '../components/EpisodeSheet'
import './myshows.css'

// ---------- helpers ----------

const pad2 = (n: number) => String(n).padStart(2, '0')
const epCode = (s: number, e: number) => `S${pad2(s)}E${pad2(e)}`

const STALE_MS = 30 * 86400000 // "haven't watched for a while" threshold
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

/** Most recent watch activity (falls back to when the show was added). */
function lastActivity(show: TrackedShow): number {
  let t = new Date(show.addedAt).getTime()
  for (const rec of Object.values(show.watched)) {
    const w = new Date(rec.watchedAt).getTime()
    if (w > t) t = w
  }
  return t
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

  if (!shown) return null

  // Episode still (16:9) crossfades over the poster once it has loaded.
  const stillSrc = stillUrl(epInfo?.still ?? null)
  const stillOn = stillSrc !== null && stillLoadedSrc === stillSrc

  const behind = behindCount(show)
  const isNew = (() => {
    if (!epInfo?.airDate) return false
    const diff = Date.now() - new Date(epInfo.airDate).getTime()
    return diff >= 0 && diff <= 7 * 86400000
  })()

  const handleCheck = () => {
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
    setFlash(true)
    window.setTimeout(() => {
      setPop(false)
      setFlash(false)
    }, 700)
    toggleEpisode(snap.id, s, e)
    showToast(`${snap.name} · ${epCode(s, e)} watched ✓`, '📺')
    const updated = useLibrary.getState().shows[snap.id]

    // Milestone detection on the check-offs users actually reach: series/season
    // premieres, season finales, and every 10th lifetime episode. Big
    // completions keep the full burst; the rest get a quick micro-burst.
    const lifetimeEps = updated ? watchedCount(updated) : 0
    const seriesPremiere = updated ? isSeriesPremiere(updated, s, e) : false
    const seasonPremiere = updated ? isSeasonPremiere(updated, s, e) : false
    const seasonFinale = updated ? isSeasonFinale(updated, s, e) : false
    const tenth = lifetimeEps > 0 && lifetimeEps % 10 === 0
    let milestone = false

    if (updated && nextEpisode(updated) === null) {
      fireConfetti()
      showToast(`All caught up on ${snap.name} 🎉`)
      onCaughtUp(snap.id)
      milestone = true
    } else if (updated && seasonComplete(updated, s)) {
      fireConfetti()
      showToast(`Season ${s} complete! 🎉`, '🏆')
      milestone = true
    } else if (seasonFinale) {
      fireConfetti({ intensity: 'micro' })
      showToast(`Season ${s} finale watched 🎬`, '🏁')
      milestone = true
    } else if (seriesPremiere) {
      fireConfetti({ intensity: 'micro' })
      showToast(`${snap.name} — series premiere! 🎉`, '🎬')
      milestone = true
    } else if (seasonPremiere) {
      fireConfetti({ intensity: 'micro' })
      showToast(`Season ${s} premiere 🎬`, '🎬')
      milestone = true
    } else if (tenth) {
      fireConfetti({ intensity: 'micro' })
      showToast(`${lifetimeEps} episodes watched! 🎉`, '🔟')
      milestone = true
    }

    // Reaction-sheet frequency: 'always' opens the deep-react sheet on every
    // check-off, 'milestones' only on premieres/finales/completions, 'never'
    // relies on the toast + inline reactions on the show page.
    const openSheet =
      reactionPrompt === 'always' || (reactionPrompt === 'milestones' && milestone)
    if (openSheet) {
      onOpenSheet({
        showId: snap.id,
        showName: snap.name,
        season: s,
        episode: e,
        episodeTitle: epInfo?.title,
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
              <span
                className="queue-behind"
                title={`${behind} more aired ${behind === 1 ? 'episode' : 'episodes'} after this one`}
              >
                +{behind}
              </span>
            )}
            {shown.episode === 1 && <span className="queue-badge premiere">Premiere</span>}
            {isNew && <span className="queue-badge new">New</span>}
          </div>
          <div className="queue-ep-title">{epLoading ? '…' : epInfo?.title ?? ''}</div>
        </div>
      </div>

      <button
        className={`queue-check${pop ? ' pop' : ''}`}
        onClick={handleCheck}
        title={`Mark ${epCode(shown.season, shown.episode)} watched`}
        aria-label={`Mark ${snap.name} ${epCode(shown.season, shown.episode)} watched`}
      >
        ✓
      </button>
    </div>
  )
})

// ---------- compact rows (paused / filtered views) ----------

function CompactRow({ show, action }: { show: TrackedShow; action?: ReactNode }) {
  const snap = show.snapshot
  const seen = watchedCount(show)
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

function loadLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
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

export default function MyShows() {
  const shows = useLibrary((s) => s.shows)
  const toggleEpisode = useLibrary((s) => s.toggleEpisode)
  const togglePauseShow = useLibrary((s) => s.togglePauseShow)

  const [view, setView] = useState<View>('queue')
  const [layout, setLayout] = useState<Layout>(loadLayout)
  const [favOnly, setFavOnly] = useState(false)
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
  const { all, pool, gridPool, fresh, stale, paused, notStarted, upToDate, recent, totalEps } =
    useMemo(() => {
      const all = Object.values(shows)
      const pool = favOnly ? all.filter((s) => s.favorite) : all
      const nowMs = Date.now()

      let nextRank = layoutRef.current.size
      for (const s of [...all].sort((a, b) => lastActivity(b) - lastActivity(a))) {
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

      const queueable = pool.filter(
        (s) => !s.paused && (nextEpisode(s) !== null || leavingIds.includes(s.snapshot.id)),
      )
      const fresh = queueable.filter((s) => !meta(s).stale).sort(byRank)
      const stale = queueable.filter((s) => meta(s).stale).sort(byRank)
      const paused = pool.filter((s) => s.paused).sort(byRank)
      const notStarted = pool.filter((s) => watchedCount(s) === 0).sort(byRank)
      const upToDate = pool
        .filter((s) => !s.paused && watchedCount(s) > 0 && nextEpisode(s) === null)
        .sort(byRank)

      // Last 10 checks across every show, newest first.
      const history: { show: TrackedShow; season: number; episode: number; watchedAt: string }[] =
        []
      for (const show of pool) {
        for (const [key, rec] of Object.entries(show.watched)) {
          const pe = parseEpKey(key)
          if (pe) history.push({ show, ...pe, watchedAt: rec.watchedAt })
        }
      }
      history.sort((a, b) => b.watchedAt.localeCompare(a.watchedAt))
      const recent = history.slice(0, 10)

      const totalEps = all.reduce((n, s) => n + watchedCount(s), 0)
      const gridPool = [...pool].sort(byRank)

      return { all, pool, gridPool, fresh, stale, paused, notStarted, upToDate, recent, totalEps }
    }, [shows, favOnly, leavingIds])

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

  const toggleLayout = () =>
    setLayout((l) => {
      const next: Layout = l === 'list' ? 'grid' : 'list'
      try {
        localStorage.setItem(LAYOUT_KEY, next)
      } catch {
        /* view preference just won't persist */
      }
      return next
    })

  const browseChips = (
    <div className="queue-browse">
      <button
        className={`queue-chip${view === 'notstarted' ? ' active' : ''}`}
        onClick={() => setView(view === 'notstarted' ? 'queue' : 'notstarted')}
      >
        ○ Not started <span className="queue-chip-count">{notStarted.length}</span>
      </button>
      <button
        className={`queue-chip${view === 'uptodate' ? ' active' : ''}`}
        onClick={() => setView(view === 'uptodate' ? 'queue' : 'uptodate')}
      >
        ✓ Up to date <span className="queue-chip-count">{upToDate.length}</span>
      </button>
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

      <div className="toptabs" role="tablist" aria-label="My Shows sections">
        <span className="toptab active" role="tab" aria-selected="true">
          Watch List
          {queueCount > 0 && <span className="toptab-count">{queueCount}</span>}
        </span>
        <Link to="/upcoming" className="toptab" role="tab" aria-selected="false">
          Upcoming
        </Link>
        <span className="toptabs-spacer" />
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
      </div>

      <p className="page-subtitle">
        {all.length === 0
          ? 'Your watch-next queue lives here.'
          : `${all.length} ${all.length === 1 ? 'show' : 'shows'} tracked · ${totalEps} ${
              totalEps === 1 ? 'episode' : 'episodes'
            } watched`}
      </p>

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
            🔍 Find shows to track
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
                🔍 Find more shows
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
        ) : (
          <div className="poster-grid stagger">
            {gridPool.map((s) => {
              const seen = watchedCount(s)
              return (
                <Link
                  key={s.snapshot.id}
                  to={`/show/${s.snapshot.id}`}
                  className="queue-grid-card"
                  title={s.snapshot.name}
                >
                  <div className="queue-grid-poster">
                    <PosterImage path={s.snapshot.poster_path} title={s.snapshot.name} />
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
                <span className="queue-chip-count">{recent.length}</span>
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
            <h2 className="queue-section-title">Watch next</h2>
            {fresh.length === 0 && stale.length === 0 ? (
              <div className="empty-state fade-in">
                <div className="big">{favOnly && pool.length === 0 ? '☆' : '🎉'}</div>
                <p>
                  {favOnly && pool.length === 0
                    ? 'No favorites yet — hit the ★ star on any show.'
                    : 'All caught up — nothing queued to watch next.'}
                </p>
                <Link className="btn primary" to="/search" style={{ marginTop: 18 }}>
                  🔍 Find something new
                </Link>
              </div>
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
              <h2 className="queue-section-title">Haven't watched for a while</h2>
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
    </div>
  )
}
