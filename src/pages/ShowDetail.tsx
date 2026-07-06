// Show detail page — /show/:id
// Backdrop hero, tracking actions, season/episode checklist, cast, comments.

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { Emotion, SearchResult, SeasonDetail, ShowDetail } from '../types'
import { EMOTIONS, episodeKey } from '../types'
import { compactNumber, watchedByCount, watcherCluster } from '../api/social'
import {
  backdropUrl,
  getRecommendations,
  getSeasonDetail,
  getShowDetail,
  getTrailerKey,
  imdbTitleUrl,
  profileUrl,
  stillUrl,
  youtubeUrl,
} from '../api/tmdb'
import {
  airedEpisodeCount,
  isSeasonFinale,
  isSeasonPremiere,
  isSeriesPremiere,
  nextEpisode,
  showProgress,
  useLibrary,
  displayWatchedCount,
} from '../store/library'
import {
  ErrorBox,
  MediaRow,
  PosterImage,
  ProgressBar,
  Rating,
  ReactionPicker,
  SkeletonDetail,
} from '../components/shared'
import { CommentsSection } from '../components/CommentsSection'
import { BackBar } from '../components/BackBar'
import { showToast } from '../components/toast'
import { fireConfetti } from '../components/Confetti'
import EpisodeSheet from '../components/EpisodeSheet'
import './show-detail.css'

function epCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** Whole days from today's local midnight (0 = airs today; past dates clamp to 0). */
function daysUntil(airDate: string): number {
  const target = new Date(`${airDate}T00:00:00`).getTime()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((target - today.getTime()) / 86_400_000))
}

/** "today" / "tomorrow" / "in N days" for a daysUntil() value. */
function inDaysLabel(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

function toastEmotion(emo: Emotion | undefined) {
  const meta = emo ? EMOTIONS.find((m) => m.key === emo) : undefined
  if (meta) showToast(`Feeling ${meta.emoji} about it!`)
  else showToast('Reaction cleared', '↩️')
}

/** Small circular progress ring + fraction shown beside the season tabs.
    The fraction label (and a ✓ glyph at 100%) makes it read as progress, not
    as a stuck loading spinner. */
function SeasonRing({ watched, aired }: { watched: number; aired: number }) {
  const r = 12
  const c = 2 * Math.PI * r
  const value = aired > 0 ? Math.min(1, watched / aired) : 0
  const complete = value >= 1
  return (
    <div
      className="show-detail-season-ring"
      role="img"
      aria-label={`${watched} of ${aired} aired episodes watched this season`}
      title={`${watched}/${aired} aired watched`}
    >
      <svg width={32} height={32} viewBox="0 0 32 32">
        <circle cx={16} cy={16} r={r} fill="none" stroke="var(--border)" strokeWidth={3.5} />
        <circle
          className="show-detail-season-ring-fill"
          cx={16}
          cy={16}
          r={r}
          fill="none"
          stroke={complete ? 'var(--green)' : 'var(--accent)'}
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeDasharray={`${c * value} ${c}`}
          transform="rotate(-90 16 16)"
        />
        {complete && (
          <text
            x={16}
            y={16}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={13}
            fill="var(--green)"
          >
            ✓
          </text>
        )}
      </svg>
      <span className="show-detail-season-ring-frac" aria-hidden="true">
        {watched}/{aired}
      </span>
    </div>
  )
}

/** Placeholder rows shown while a season's episodes are loading. */
function SeasonSkeleton() {
  return (
    <div className="show-detail-episodes" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="show-detail-ep">
          <span className="show-detail-ep-num" />
          <div className="skeleton show-detail-ep-still" />
          <div className="show-detail-ep-main">
            <div className="skeleton skeleton-line" style={{ width: '38%', marginTop: 0 }} />
            <div className="skeleton skeleton-line" style={{ width: '22%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Stacked emoji-avatar cluster + "Watched by +NNN" — a chip-sized social
    proof cue on the hero. Links nowhere (yet). */
function WatchedByChip({ mediaId, voteCount }: { mediaId: number; voteCount?: number }) {
  const cluster = watcherCluster(mediaId, 3)
  const total = watchedByCount(mediaId, voteCount)
  return (
    <span className="detail-watchedby" title={`Watched by ${total.toLocaleString()} people`}>
      <span className="detail-watchedby-avatars" aria-hidden="true">
        {cluster.map((u, i) => (
          <span key={u.id} className="detail-watchedby-avatar" style={{ zIndex: cluster.length - i }}>
            {u.avatar}
          </span>
        ))}
      </span>
      <span className="detail-watchedby-label">Watched by +{compactNumber(total)}</span>
    </span>
  )
}

/** 10-star personal rating row (shown when the title is tracked). Tapping a
    star sets that rating; tapping the same star again clears it. */
function StarRating({
  value,
  onRate,
}: {
  value: number | undefined
  onRate: (rating: number | undefined) => void
}) {
  const [hover, setHover] = useState(0)
  const [popped, setPopped] = useState(0)
  return (
    <div className="detail-rating" role="group" aria-label="Your rating out of 10">
      <span className="detail-rating-label">Your rating</span>
      <div className="detail-rating-stars" onMouseLeave={() => setHover(0)}>
        {Array.from({ length: 10 }, (_, i) => {
          const n = i + 1
          const active = (hover || value || 0) >= n
          return (
            <button
              key={n}
              type="button"
              className={`detail-rating-star${active ? ' on' : ''}${popped === n ? ' pop' : ''}`}
              aria-label={`Rate ${n} of 10`}
              aria-pressed={value === n}
              onMouseEnter={() => setHover(n)}
              onClick={() => {
                const next = value === n ? undefined : n
                onRate(next)
                setPopped(n)
                window.setTimeout(() => setPopped(0), 260)
              }}
            >
              ★
            </button>
          )
        })}
      </div>
      <span className="detail-rating-value">{value ? `${value}/10` : '—'}</span>
    </div>
  )
}

/** Slide-up "Add to list" sheet: toggle the title in/out of existing lists,
    or quick-create a new list. Self-contained (mirrors EpisodeSheet/confirm). */
function AddToListSheet({
  item,
  onClose,
}: {
  item: { type: 'tv' | 'movie'; id: number; name: string; poster_path: string | null }
  onClose: () => void
}) {
  const lists = useLibrary((s) => s.lists)
  const toggleListItem = useLibrary((s) => s.toggleListItem)
  const createList = useLibrary((s) => s.createList)
  const [newName, setNewName] = useState('')
  const [closing, setClosing] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)

  const close = () => {
    setClosing(true)
    window.setTimeout(onClose, 200)
  }

  useEffect(() => {
    sheetRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const inList = (id: string) =>
    lists.find((l) => l.id === id)?.items.some((i) => i.type === item.type && i.id === item.id) ??
    false

  const handleToggle = (listId: string, listName: string) => {
    const was = inList(listId)
    toggleListItem(listId, item)
    showToast(was ? `Removed from ${listName}` : `Added to ${listName}`, was ? '↩️' : '📋')
  }

  const handleCreate = () => {
    const name = newName.trim()
    if (!name) return
    const listId = createList(name)
    toggleListItem(listId, item)
    setNewName('')
    showToast(`Added to ${name}`, '📋')
  }

  return (
    <div className={`addlist-backdrop${closing ? ' closing' : ''}`} onClick={close}>
      <div
        ref={sheetRef}
        tabIndex={-1}
        className={`addlist-sheet${closing ? ' closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Add ${item.name} to a list`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="addlist-grip" aria-hidden="true" />
        <div className="addlist-head">
          <div className="addlist-title">Add to list</div>
          <button className="addlist-close" onClick={close} aria-label="Close" title="Close">
            ✕
          </button>
        </div>

        {lists.length > 0 ? (
          <div className="addlist-items">
            {lists.map((l) => {
              const checked = inList(l.id)
              return (
                <button
                  key={l.id}
                  className={`addlist-item${checked ? ' checked' : ''}`}
                  aria-pressed={checked}
                  onClick={() => handleToggle(l.id, l.name)}
                >
                  <span className="addlist-check" aria-hidden="true">
                    {checked ? '✓' : ''}
                  </span>
                  <span className="addlist-name">{l.name}</span>
                  <span className="addlist-count">{l.items.length}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="addlist-empty">No lists yet — create one below.</div>
        )}

        <div className="addlist-create">
          <input
            className="addlist-input"
            type="text"
            value={newName}
            placeholder="New list name…"
            maxLength={60}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
            }}
          />
          <button
            className="btn primary small"
            disabled={!newName.trim()}
            onClick={handleCreate}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ShowDetailPage() {
  const { id: idParam } = useParams()
  const id = Number(idParam)

  const [detail, setDetail] = useState<ShowDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [season, setSeason] = useState<number | null>(null)
  const [seasonDetail, setSeasonDetail] = useState<SeasonDetail | null>(null)
  const [seasonLoading, setSeasonLoading] = useState(false)
  const [seasonError, setSeasonError] = useState<string | null>(null)

  const [trailerKey, setTrailerKey] = useState<string | null>(null)
  const [recs, setRecs] = useState<SearchResult[]>([])

  const tracked = useLibrary((s) => s.shows[id])
  const onWatchlist = useLibrary((s) => s.watchlist.some((w) => w.type === 'tv' && w.id === id))
  const addShow = useLibrary((s) => s.addShow)
  const refreshShow = useLibrary((s) => s.refreshShow)
  const removeShow = useLibrary((s) => s.removeShow)
  const toggleFavoriteShow = useLibrary((s) => s.toggleFavoriteShow)
  const togglePauseShow = useLibrary((s) => s.togglePauseShow)
  const toggleEpisode = useLibrary((s) => s.toggleEpisode)
  const setEpisodeEmotion = useLibrary((s) => s.setEpisodeEmotion)
  const markSeasonWatched = useLibrary((s) => s.markSeasonWatched)
  const markSeasonUnwatched = useLibrary((s) => s.markSeasonUnwatched)
  const markShowWatched = useLibrary((s) => s.markShowWatched)
  const addToWatchlist = useLibrary((s) => s.addToWatchlist)
  const removeFromWatchlist = useLibrary((s) => s.removeFromWatchlist)
  const setShowRating = useLibrary((s) => s.setShowRating)
  const reactionPrompt = useLibrary((s) => s.reactionPrompt)

  // Post-check reaction sheet (same one the queue uses) + add-to-list sheet.
  // variant 'pause-this' is the hero Pause button's confirm sheet.
  const [sheet, setSheet] = useState<{
    season: number
    episode: number
    episodeTitle?: string
    variant?: 'default' | 'pause-this'
  } | null>(null)
  const [addListOpen, setAddListOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setDetail(null)
    setSeason(null)
    setSeasonDetail(null)
    getShowDetail(id)
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        // Keep the tracked snapshot in sync with freshly fetched detail
        // (new seasons/episodes since the show was added).
        refreshShow(d)
        // Default season: the one holding the next unwatched episode when the
        // show is followed, else season 1 (fall back to the first listed
        // season, e.g. Specials-only shows). Episodes load immediately.
        const show = useLibrary.getState().shows[id]
        const next = show ? nextEpisode(show) : null
        const fallback = d.seasons.find((s) => s.season_number === 1) ?? d.seasons[0]
        setSeason(
          next && d.seasons.some((s) => s.season_number === next.season)
            ? next.season
            : (fallback?.season_number ?? null),
        )
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load show.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, refreshShow])

  // Trailer + "More like this" load alongside the main detail (best-effort:
  // failures/demo mode just hide those bits).
  useEffect(() => {
    let cancelled = false
    setTrailerKey(null)
    setRecs([])
    getTrailerKey('tv', id).then((key) => {
      if (!cancelled) setTrailerKey(key)
    })
    getRecommendations('tv', id)
      .then((items) => {
        if (!cancelled) setRecs(items.slice(0, 12))
      })
      .catch(() => {
        if (!cancelled) setRecs([])
      })
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (season == null) return
    let cancelled = false
    setSeasonLoading(true)
    setSeasonError(null)
    setSeasonDetail(null)
    getSeasonDetail(id, season)
      .then((s) => {
        if (!cancelled) setSeasonDetail(s)
      })
      .catch((e: unknown) => {
        if (!cancelled) setSeasonError(e instanceof Error ? e.message : 'Failed to load season.')
      })
      .finally(() => {
        if (!cancelled) setSeasonLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, season])

  // ----- auto-scroll to the next unwatched episode (once per navigation) -----
  const seasonBodyRef = useRef<HTMLDivElement | null>(null)
  const autoScrolledRef = useRef(false)
  const [highlightKey, setHighlightKey] = useState<string | null>(null)
  const highlightTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    autoScrolledRef.current = false
  }, [id])

  useEffect(() => () => window.clearTimeout(highlightTimer.current), [])

  useEffect(() => {
    if (seasonLoading || !seasonDetail || autoScrolledRef.current) return
    const show = useLibrary.getState().shows[id]
    if (!show) return // only followed shows scroll to "up next"
    const next = nextEpisode(show)
    if (!next || next.season !== seasonDetail.season_number) return
    const key = episodeKey(next.season, next.episode)
    const row = seasonBodyRef.current?.querySelector<HTMLElement>(`[data-ep-key="${key}"]`)
    if (!row) return
    autoScrolledRef.current = true
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    row.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
    setHighlightKey(key)
    window.clearTimeout(highlightTimer.current)
    highlightTimer.current = window.setTimeout(() => setHighlightKey(null), 2000)
  }, [id, seasonDetail, seasonLoading])

  // ----- mobile quick-log bar: shown while the episode list is on screen -----
  const [epListVisible, setEpListVisible] = useState(false)

  useEffect(() => {
    const el = seasonBodyRef.current
    if (!el || !seasonDetail) {
      setEpListVisible(false)
      return
    }
    const io = new IntersectionObserver((entries) =>
      setEpListVisible(entries.some((e) => e.isIntersecting)),
    )
    io.observe(el)
    return () => {
      io.disconnect()
      setEpListVisible(false)
    }
  }, [seasonDetail, seasonLoading])

  if (loading)
    return (
      <div>
        <BackBar />
        <SkeletonDetail />
      </div>
    )
  if (error)
    return (
      <div>
        <BackBar />
        <ErrorBox message={error} />
      </div>
    )
  if (!detail)
    return (
      <div>
        <BackBar />
        <ErrorBox message="Show not found." />
      </div>
    )

  const followed = Boolean(tracked)
  const backdrop = backdropUrl(detail.backdrop_path)
  const year = detail.first_air_date?.slice(0, 4)
  const network = detail.networks[0]?.name
  const progress = tracked ? showProgress(tracked) : 0
  const upNext = tracked ? nextEpisode(tracked) : null
  // Local calendar date, NOT the UTC one (toISOString) — must agree with
  // library.ts todayISO()/airedEpisodeCount so episode rows and the header's
  // aired counts flip "aired" at the same local midnight.
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const ensureFollowed = () => {
    if (!tracked) addShow(detail)
  }

  /**
   * After marking, celebrate. Returns true if a "big" completion (season/show)
   * already fired the full burst, so a single-episode caller can skip its own
   * premiere/finale micro-burst.
   */
  const celebrateIfComplete = (s: number): boolean => {
    const show = useLibrary.getState().shows[id]
    if (!show) return false
    if (nextEpisode(show) === null) {
      fireConfetti()
      showToast(`${detail.name} complete — you've seen it all! 🎉`, '🏆')
      return true
    }
    const aired = airedEpisodeCount(show, s)
    if (aired === 0) return false
    for (let e = 1; e <= aired; e++) {
      if (!show.watched[episodeKey(s, e)]) return false
    }
    fireConfetti()
    showToast(`Season ${s} complete! 🎉`, '🏆')
    return true
  }

  const handleToggleEpisode = (s: number, e: number, episodeTitle?: string) => {
    const wasWatched = Boolean(tracked?.watched[episodeKey(s, e)])
    ensureFollowed()
    toggleEpisode(id, s, e)
    if (wasWatched) {
      // Unchecking stays silent — no reaction sheet.
      showToast(`${epCode(s, e)} unmarked`, '↩️')
      return
    }
    showToast(`${epCode(s, e)} marked watched ✓`, '🎬')
    const big = celebrateIfComplete(s)
    // Micro-burst on the premieres/finales users actually reach.
    const show = useLibrary.getState().shows[id]
    let milestone = big
    if (!big && show) {
      if (isSeasonFinale(show, s, e)) {
        fireConfetti({ intensity: 'micro' })
        showToast(`Season ${s} finale watched 🎬`, '🏁')
        milestone = true
      } else if (isSeriesPremiere(show, s, e)) {
        fireConfetti({ intensity: 'micro' })
        showToast(`${detail.name} — series premiere! 🎉`, '🎬')
        milestone = true
      } else if (isSeasonPremiere(show, s, e)) {
        fireConfetti({ intensity: 'micro' })
        showToast(`Season ${s} premiere 🎬`, '🎬')
        milestone = true
      }
    }
    // Fire the same deep-react EpisodeSheet the queue uses, honoring the store
    // pref: 'always' every check, 'milestones' only premieres/finales/completions,
    // 'never' skips.
    const openSheet =
      reactionPrompt === 'always' || (reactionPrompt === 'milestones' && milestone)
    if (openSheet) setSheet({ season: s, episode: e, episodeTitle })
  }

  const handleMarkSeason = (s: number) => {
    ensureFollowed()
    markSeasonWatched(id, s)
    showToast(`Season ${s} marked watched ✓`, '📺')
    celebrateIfComplete(s)
  }

  const seasonWatchedCount =
    seasonDetail && tracked
      ? seasonDetail.episodes.filter(
          (ep) => tracked.watched[episodeKey(ep.season_number, ep.episode_number)],
        ).length
      : 0

  // Episodes of the selected season that have already aired ("mark season" only
  // covers these). For tracked shows this MUST match what markSeasonWatched()
  // marks (snapshot-derived airedEpisodeCount) — counting null-air-date
  // episodes as aired would leave a "Mark season watched" button that does
  // nothing while still toasting success.
  const seasonAiredCount =
    seasonDetail && season != null
      ? tracked
        ? airedEpisodeCount(tracked, season)
        : seasonDetail.episodes.filter((ep) => !(ep.air_date != null && ep.air_date > todayStr))
            .length
      : 0

  const nextAir = detail.next_episode_to_air
  const nextAirDays = nextAir?.air_date ? daysUntil(nextAir.air_date) : null

  return (
    <div>
      <BackBar />

      {/* ---------- hero ---------- */}
      <div className="show-detail-hero">
        {backdrop && (
          <div className="show-detail-hero-bg" style={{ backgroundImage: `url(${backdrop})` }} />
        )}
        <div className="show-detail-hero-content">
          <div className="show-detail-poster">
            <PosterImage path={detail.poster_path} title={detail.name} />
          </div>
          <div className="show-detail-headline">
            <div>
              <div className="show-detail-title">{detail.name}</div>
              {detail.tagline && <div className="show-detail-tagline">{detail.tagline}</div>}
            </div>
            <div className="show-detail-chips">
              {tracked?.paused && <span className="chip show-detail-paused-chip">⏸ Paused</span>}
              {year && <span className="chip">{year}</span>}
              {detail.status && <span className="chip">{detail.status}</span>}
              <Rating value={detail.vote_average} />
              <WatchedByChip mediaId={id} />
              <span className="chip">
                {detail.number_of_seasons} season{detail.number_of_seasons === 1 ? '' : 's'} ·{' '}
                {detail.number_of_episodes} ep
              </span>
              {network && <span className="chip">{network}</span>}
              {detail.genres.map((g) => (
                <span key={g.id} className="chip">
                  {g.name}
                </span>
              ))}
            </div>
            <div className="show-detail-actions">
              {followed ? (
                <button
                  className="btn"
                  onClick={() => {
                    removeShow(id)
                    showToast(`Unfollowed ${detail.name}`, '👋')
                  }}
                  title="Stop following"
                >
                  ✓ Following
                </button>
              ) : (
                <button
                  className="btn primary"
                  onClick={() => {
                    addShow(detail)
                    showToast(`Following ${detail.name} ✓`, '📺')
                  }}
                >
                  + Add show
                </button>
              )}
              {onWatchlist ? (
                <button
                  className="btn"
                  onClick={() => {
                    removeFromWatchlist('tv', id)
                    showToast('Removed from watchlist', '🔖')
                  }}
                >
                  ✓ Watchlist
                </button>
              ) : (
                <button
                  className="btn"
                  onClick={() => {
                    addToWatchlist({
                      type: 'tv',
                      id,
                      name: detail.name,
                      poster_path: detail.poster_path,
                    })
                    showToast('Added to watchlist', '🔖')
                  }}
                >
                  + Watchlist
                </button>
              )}
              {followed && tracked && (
                <button
                  className="btn"
                  onClick={() => {
                    const wasFavorite = tracked.favorite
                    toggleFavoriteShow(id)
                    showToast(
                      wasFavorite ? 'Removed from favorites' : 'Added to favorites',
                      wasFavorite ? '☆' : '⭐',
                    )
                  }}
                  title={tracked.favorite ? 'Remove from favorites' : 'Add to favorites'}
                  style={tracked.favorite ? { color: 'var(--yellow)' } : undefined}
                >
                  {tracked.favorite ? '★ Favorite' : '☆ Favorite'}
                </button>
              )}
              {followed && tracked && (
                <button
                  className="btn"
                  onClick={() => {
                    if (tracked.paused) {
                      // Resuming is a plain toggle; the sheet is a pause prompt.
                      togglePauseShow(id)
                      showToast('Resumed ▶', '▶️')
                      return
                    }
                    // TV Time-style "PAUSE THIS?" sheet (equalizer hero)
                    // instead of an instant state flip.
                    const next = nextEpisode(tracked)
                    setSheet({
                      season: next?.season ?? 1,
                      episode: next?.episode ?? 1,
                      variant: 'pause-this',
                    })
                  }}
                  title={tracked.paused ? 'Resume this show' : 'Pause — hide from Watch Next'}
                >
                  {tracked.paused ? '▶ Resume' : '⏸ Pause'}
                </button>
              )}
              <button className="btn" onClick={() => setAddListOpen(true)} title="Add to a list">
                📋 Add to list
              </button>
              {trailerKey && (
                <a
                  className="btn show-detail-trailer-btn"
                  href={youtubeUrl(trailerKey)}
                  target="_blank"
                  rel="noreferrer"
                >
                  ▶ YouTube trailer
                </a>
              )}
              {detail.imdb_id && (
                <a
                  className="btn show-detail-imdb-btn"
                  href={imdbTitleUrl(detail.imdb_id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  IMDb ↗
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- next-episode countdown ---------- */}
      {nextAir && nextAir.air_date && nextAirDays != null && (
        <div className="show-detail-countdown">
          <span className="show-detail-countdown-dot" aria-hidden="true" />
          <span>
            Next episode <strong>{inDaysLabel(nextAirDays)}</strong> —{' '}
            {epCode(nextAir.season_number, nextAir.episode_number)} ·{' '}
            {new Date(`${nextAir.air_date}T00:00:00`).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        </div>
      )}

      {/* ---------- progress ---------- */}
      {followed && tracked && (
        <div className={`card show-detail-progress-card${tracked.paused ? ' paused' : ''}`}>
          <div className="show-detail-progress-top">
            <div>
              <strong>{displayWatchedCount(tracked)}</strong>{' '}
              <span style={{ color: 'var(--text-dim)' }}>
                of {tracked.snapshot.totalEpisodes} episodes watched
              </span>
              {upNext ? (
                <span className="chip" style={{ marginLeft: 10 }}>
                  Up next: {epCode(upNext.season, upNext.episode)}
                </span>
              ) : (
                <span className="chip" style={{ marginLeft: 10, color: 'var(--green)' }}>
                  All caught up 🎉
                </span>
              )}
            </div>
            {upNext && (
              <button
                className="btn small"
                onClick={() => {
                  markShowWatched(id)
                  fireConfetti()
                  showToast(`${detail.name} — all episodes watched ✓`, '🎉')
                }}
              >
                Mark all watched
              </button>
            )}
          </div>
          <ProgressBar value={progress} />
          <StarRating
            value={tracked.rating}
            onRate={(rating) => {
              setShowRating(id, rating)
              if (rating) showToast(`Rated ${rating}/10 ★`, '⭐')
              else showToast('Rating cleared', '↩️')
            }}
          />
        </div>
      )}

      {detail.overview && <p className="show-detail-overview">{detail.overview}</p>}

      {/* ---------- seasons ---------- */}
      <div className="section-title">Episodes</div>
      <div className="show-detail-season-tabs-row">
        <div className="show-detail-season-tabs">
          {detail.seasons.map((s) => (
            <button
              key={s.id}
              className={`show-detail-season-tab${season === s.season_number ? ' active' : ''}`}
              onClick={() => setSeason(s.season_number)}
            >
              {s.name || `Season ${s.season_number}`}
            </button>
          ))}
        </div>
        {!seasonLoading && seasonDetail && seasonAiredCount > 0 && (
          <SeasonRing watched={seasonWatchedCount} aired={seasonAiredCount} />
        )}
      </div>

      {seasonLoading && <SeasonSkeleton />}
      {seasonError && <ErrorBox message={seasonError} />}
      {!seasonLoading && seasonDetail && season != null && (
        <div key={season} ref={seasonBodyRef} className="show-detail-season-body">
          <div className="show-detail-season-head">
            <span style={{ color: 'var(--text-dim)', fontSize: 13.5 }}>
              {seasonWatchedCount}/{seasonDetail.episodes.length} watched
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {seasonWatchedCount < seasonAiredCount && (
                <button className="btn small" onClick={() => handleMarkSeason(season)}>
                  Mark season watched
                </button>
              )}
              {seasonWatchedCount > 0 && (
                <button
                  className="btn small"
                  onClick={() => {
                    markSeasonUnwatched(id, season)
                    showToast(`Season ${season} unmarked`, '↩️')
                  }}
                >
                  Unmark season
                </button>
              )}
            </div>
          </div>
          <div
            className={`show-detail-episodes${
              followed && upNext && epListVisible ? ' has-quickbar' : ''
            }`}
          >
            {seasonDetail.episodes.map((ep) => {
              const key = episodeKey(ep.season_number, ep.episode_number)
              const record = tracked?.watched[key]
              const isWatched = Boolean(record)
              const isFuture = ep.air_date != null && ep.air_date > todayStr
              const still = stillUrl(ep.still_path)
              return (
                <div
                  key={ep.id}
                  data-ep-key={key}
                  className={`show-detail-ep${isWatched ? ' watched' : ''}${
                    highlightKey === key ? ' spotlight' : ''
                  }`}
                >
                  <span className="show-detail-ep-num">
                    {epCode(ep.season_number, ep.episode_number)}
                  </span>
                  {still ? (
                    <img
                      className="show-detail-ep-still"
                      src={still}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <div
                      className="show-detail-ep-still show-detail-ep-still-fallback"
                      aria-hidden="true"
                    />
                  )}
                  <div className="show-detail-ep-main">
                    <div className="show-detail-ep-name">{ep.name}</div>
                    <div className="show-detail-ep-meta">
                      {[ep.air_date, ep.runtime ? `${ep.runtime} min` : null]
                        .filter(Boolean)
                        .join(' · ')}
                      {ep.vote_average > 0 && (
                        <span className="show-detail-ep-rating">
                          ★ {ep.vote_average.toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>
                  {isWatched && (
                    <ReactionPicker
                      compact
                      value={record?.emotion}
                      onChange={(emo) => {
                        setEpisodeEmotion(id, ep.season_number, ep.episode_number, emo)
                        toastEmotion(emo)
                      }}
                    />
                  )}
                  {isFuture && ep.air_date ? (
                    <span className="show-detail-future-chip">
                      {inDaysLabel(daysUntil(ep.air_date))}
                    </span>
                  ) : (
                    <button
                      className={`show-detail-ep-toggle${isWatched ? ' on' : ''}`}
                      title={isWatched ? 'Mark unwatched' : 'Mark watched'}
                      onClick={() =>
                        handleToggleEpisode(ep.season_number, ep.episode_number, ep.name)
                      }
                    >
                      ✓
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ---------- cast ---------- */}
      {detail.cast.length > 0 && (
        <>
          <div className="section-title">Cast</div>
          <div className="show-detail-cast stagger">
            {detail.cast.map((c) => {
              const img = profileUrl(c.profile_path)
              return (
                <div key={c.id} className="show-detail-cast-card">
                  {img ? (
                    <img className="show-detail-cast-img" src={img} alt={c.name} loading="lazy" />
                  ) : (
                    <div className="show-detail-cast-fallback">{initials(c.name)}</div>
                  )}
                  <div className="show-detail-cast-name">{c.name}</div>
                  <div className="show-detail-cast-role">{c.character}</div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ---------- comments ---------- */}
      <div style={{ marginTop: 28 }}>
        <CommentsSection mediaKey={`tv:${id}`} />
      </div>

      {/* ---------- recommendations ---------- */}
      {recs.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 28 }}>
            More like this
          </div>
          <MediaRow items={recs} />
        </>
      )}

      {/* ---------- mobile quick-log bar (fixed above the tab bar) ---------- */}
      {followed && upNext && (
        <div
          className={`show-detail-quickbar${epListVisible ? ' visible' : ''}`}
          aria-hidden={!epListVisible}
        >
          <button
            className="show-detail-quickbar-btn"
            tabIndex={epListVisible ? 0 : -1}
            onClick={() => handleToggleEpisode(upNext.season, upNext.episode)}
          >
            {/* When viewing the up-next season the button logs the row you're
                looking at ("Log …"); on any other season it reads as a shortcut
                back to the queue ("Continue … →") so it never looks like a bug. */}
            {season === upNext.season
              ? `✓ Log ${epCode(upNext.season, upNext.episode)}`
              : `Continue ${epCode(upNext.season, upNext.episode)} →`}
          </button>
        </div>
      )}

      {sheet && (
        <EpisodeSheet
          showId={id}
          showName={detail.name}
          season={sheet.season}
          episode={sheet.episode}
          episodeTitle={sheet.episodeTitle}
          variant={sheet.variant}
          // Hero-initiated pause prompt: "Keep watching" just closes — there
          // is no freshly-checked episode for the reaction steps to describe.
          keepAction={sheet.variant === 'pause-this' ? 'close' : undefined}
          onClose={() => setSheet(null)}
        />
      )}

      {addListOpen && (
        <AddToListSheet
          item={{ type: 'tv', id, name: detail.name, poster_path: detail.poster_path }}
          onClose={() => setAddListOpen(false)}
        />
      )}
    </div>
  )
}
