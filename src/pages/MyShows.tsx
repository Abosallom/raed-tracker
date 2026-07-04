// My Shows — TV Time-style "Watch Next" queue: check off the next aired
// episode of each show, react in the EpisodeSheet, and keep momentum.
// Rendered from the store; episode titles are fetched lazily and cached.

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  airedEpisodeCount,
  nextEpisode,
  showProgress,
  useLibrary,
  watchedCount,
} from '../store/library'
import type { SeasonDetail, TrackedShow } from '../types'
import { getSeasonDetail } from '../api/tmdb'
import { PosterImage, ProgressBar, timeAgo } from '../components/shared'
import { showToast } from '../components/toast'
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
  let aired = 0
  for (const s of Object.keys(show.snapshot.seasonEpisodeCounts).map(Number)) {
    aired += airedEpisodeCount(show, s)
  }
  return aired - watchedCount(show) - 1
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

// ---------- queue row ----------

function QueueRow({
  show,
  index,
  onCaughtUp,
  onOpenSheet,
}: {
  show: TrackedShow
  index: number
  onCaughtUp: (id: number) => void
  onOpenSheet: (s: SheetInfo) => void
}) {
  const toggleEpisode = useLibrary((s) => s.toggleEpisode)
  const snap = show.snapshot

  // While the row animates out (fully caught up) keep showing the last episode.
  const storeNext = nextEpisode(show)
  const lastRef = useRef(storeNext)
  if (storeNext) lastRef.current = storeNext
  const shown = storeNext ?? lastRef.current
  const leaving = storeNext === null

  const [pop, setPop] = useState(false)
  const [flash, setFlash] = useState(false)
  const [epInfo, setEpInfo] = useState<{ title: string; airDate: string | null } | null>(null)
  const [epLoading, setEpLoading] = useState(index < PREFETCH_CAP)

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
        setEpInfo(ep ? { title: ep.name, airDate: ep.air_date } : null)
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

  const behind = behindCount(show)
  const isNew = (() => {
    if (!epInfo?.airDate) return false
    const diff = Date.now() - new Date(epInfo.airDate).getTime()
    return diff >= 0 && diff <= 7 * 86400000
  })()

  const handleCheck = () => {
    if (leaving) return
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
    if (updated && nextEpisode(updated) === null) {
      showToast(`All caught up on ${snap.name} 🎉`)
      onCaughtUp(snap.id)
    }
    onOpenSheet({
      showId: snap.id,
      showName: snap.name,
      season: s,
      episode: e,
      episodeTitle: epInfo?.title,
    })
  }

  return (
    <div className={`queue-row${flash ? ' flash' : ''}${leaving ? ' leaving' : ''}`}>
      <Link to={`/show/${snap.id}`} className="queue-poster" title={snap.name}>
        <PosterImage path={snap.poster_path} title={snap.name} />
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
}

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

export default function MyShows() {
  const shows = useLibrary((s) => s.shows)
  const toggleEpisode = useLibrary((s) => s.toggleEpisode)
  const togglePauseShow = useLibrary((s) => s.togglePauseShow)

  const [view, setView] = useState<View>('queue')
  const [favOnly, setFavOnly] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sheet, setSheet] = useState<SheetInfo | null>(null)
  const [leavingIds, setLeavingIds] = useState<number[]>([])
  const leaveTimers = useRef<number[]>([])
  useEffect(
    () => () => {
      for (const t of leaveTimers.current) window.clearTimeout(t)
    },
    [],
  )

  const all = Object.values(shows)
  const pool = favOnly ? all.filter((s) => s.favorite) : all
  const nowMs = Date.now()

  // Freeze row order + staleness bucket per visit, so a checked row advances
  // IN PLACE instead of jumping to the top of the "recently watched" sort.
  const layoutRef = useRef(new Map<number, { rank: number; stale: boolean }>())
  {
    let nextRank = layoutRef.current.size
    for (const s of [...all].sort((a, b) => lastActivity(b) - lastActivity(a))) {
      if (!layoutRef.current.has(s.snapshot.id)) {
        layoutRef.current.set(s.snapshot.id, {
          rank: nextRank++,
          stale: nowMs - lastActivity(s) > STALE_MS,
        })
      }
    }
  }
  const meta = (s: TrackedShow) => layoutRef.current.get(s.snapshot.id) ?? { rank: 1e9, stale: false }
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
  const history: { show: TrackedShow; season: number; episode: number; watchedAt: string }[] = []
  for (const show of pool) {
    for (const [key, rec] of Object.entries(show.watched)) {
      const pe = parseEpKey(key)
      if (pe) history.push({ show, ...pe, watchedAt: rec.watchedAt })
    }
  }
  history.sort((a, b) => b.watchedAt.localeCompare(a.watchedAt))
  const recent = history.slice(0, 10)

  const handleCaughtUp = (id: number) => {
    setLeavingIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
    leaveTimers.current.push(
      window.setTimeout(() => setLeavingIds((ids) => ids.filter((x) => x !== id)), 520),
    )
  }

  const totalEps = all.reduce((n, s) => n + watchedCount(s), 0)
  const queueCount = fresh.length + stale.length

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
    <div>
      <h1 className="page-title">My Shows</h1>
      <p className="page-subtitle">
        {all.length === 0
          ? 'Your watch-next queue lives here.'
          : `${all.length} ${all.length === 1 ? 'show' : 'shows'} tracked · ${totalEps} ${
              totalEps === 1 ? 'episode' : 'episodes'
            } watched`}
      </p>

      <div className="queue-header">
        <div className="queue-segmented" role="tablist" aria-label="My Shows sections">
          <button className="queue-seg active" role="tab" aria-selected="true">
            Watch Next <span className="queue-seg-count">{queueCount}</span>
          </button>
          <Link to="/upcoming" className="queue-seg" role="tab" aria-selected="false">
            Upcoming
          </Link>
        </div>
        <span className="queue-header-spacer" />
        <button
          className={`queue-chip queue-fav${favOnly ? ' active' : ''}`}
          onClick={() => setFavOnly((v) => !v)}
          title="Only favorite shows"
        >
          ★ Favorites
        </button>
      </div>

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
                          togglePauseShow(s.snapshot.id)
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
