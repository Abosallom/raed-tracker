// Show detail page — /show/:id
// Backdrop hero, tracking actions, season/episode checklist, cast, comments.

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { Emotion, SearchResult, SeasonDetail, ShowDetail } from '../types'
import { EMOTIONS, episodeKey } from '../types'
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
  nextEpisode,
  showProgress,
  useLibrary,
  watchedCount,
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
import { ConfettiHost, fireConfetti } from '../components/Confetti'
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

/** Small circular progress ring (watched/aired) shown beside the season tabs. */
function SeasonRing({ watched, aired }: { watched: number; aired: number }) {
  const r = 12
  const c = 2 * Math.PI * r
  const value = aired > 0 ? Math.min(1, watched / aired) : 0
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
          stroke={value >= 1 ? 'var(--green)' : 'var(--accent)'}
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeDasharray={`${c * value} ${c}`}
          transform="rotate(-90 16 16)"
        />
      </svg>
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
  const toggleEpisode = useLibrary((s) => s.toggleEpisode)
  const setEpisodeEmotion = useLibrary((s) => s.setEpisodeEmotion)
  const markSeasonWatched = useLibrary((s) => s.markSeasonWatched)
  const markSeasonUnwatched = useLibrary((s) => s.markSeasonUnwatched)
  const markShowWatched = useLibrary((s) => s.markShowWatched)
  const addToWatchlist = useLibrary((s) => s.addToWatchlist)
  const removeFromWatchlist = useLibrary((s) => s.removeFromWatchlist)

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
  const watched = tracked ? watchedCount(tracked) : 0
  const upNext = tracked ? nextEpisode(tracked) : null
  // Local calendar date, NOT the UTC one (toISOString) — must agree with
  // library.ts todayISO()/airedEpisodeCount so episode rows and the header's
  // aired counts flip "aired" at the same local midnight.
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const ensureFollowed = () => {
    if (!tracked) addShow(detail)
  }

  /** After marking, celebrate if season `s` (aired eps) or the whole show is now done. */
  const celebrateIfComplete = (s: number) => {
    const show = useLibrary.getState().shows[id]
    if (!show) return
    if (nextEpisode(show) === null) {
      fireConfetti()
      showToast(`${detail.name} complete — you've seen it all! 🎉`, '🏆')
      return
    }
    const aired = airedEpisodeCount(show, s)
    if (aired === 0) return
    for (let e = 1; e <= aired; e++) {
      if (!show.watched[episodeKey(s, e)]) return
    }
    fireConfetti()
    showToast(`Season ${s} complete! 🎉`, '🏆')
  }

  const handleToggleEpisode = (s: number, e: number) => {
    const wasWatched = Boolean(tracked?.watched[episodeKey(s, e)])
    ensureFollowed()
    toggleEpisode(id, s, e)
    if (wasWatched) {
      showToast(`${epCode(s, e)} unmarked`, '↩️')
    } else {
      showToast(`${epCode(s, e)} marked watched ✓`, '🎬')
      celebrateIfComplete(s)
    }
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
      <ConfettiHost />

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
              {year && <span className="chip">{year}</span>}
              {detail.status && <span className="chip">{detail.status}</span>}
              <Rating value={detail.vote_average} />
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
        <div className="card show-detail-progress-card">
          <div className="show-detail-progress-top">
            <div>
              <strong>{watched}</strong>{' '}
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
          <div className="show-detail-episodes">
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
                      onClick={() => handleToggleEpisode(ep.season_number, ep.episode_number)}
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
            ✓ Log {epCode(upNext.season, upNext.episode)}
          </button>
        </div>
      )}
    </div>
  )
}
