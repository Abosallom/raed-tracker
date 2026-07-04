// Show detail page — /show/:id
// Backdrop hero, tracking actions, season/episode checklist, cast, comments.

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { Emotion, SeasonDetail, ShowDetail } from '../types'
import { EMOTIONS, episodeKey } from '../types'
import {
  backdropUrl,
  getSeasonDetail,
  getShowDetail,
  imdbTitleUrl,
  profileUrl,
  stillUrl,
} from '../api/tmdb'
import {
  nextEpisode,
  showProgress,
  useLibrary,
  watchedCount,
} from '../store/library'
import {
  ErrorBox,
  PosterImage,
  ProgressBar,
  Rating,
  ReactionPicker,
  SkeletonDetail,
} from '../components/shared'
import { CommentsSection } from '../components/CommentsSection'
import { showToast } from '../components/toast'
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

function daysUntil(airDate: string): number {
  const ms = new Date(`${airDate}T00:00:00`).getTime() - Date.now()
  return Math.max(1, Math.ceil(ms / 86_400_000))
}

function toastEmotion(emo: Emotion | undefined) {
  const meta = emo ? EMOTIONS.find((m) => m.key === emo) : undefined
  if (meta) showToast(`Feeling ${meta.emoji} about it!`)
  else showToast('Reaction cleared', '↩️')
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
        setSeason(d.seasons[0]?.season_number ?? null)
        // Keep the tracked snapshot in sync with freshly fetched detail
        // (new seasons/episodes since the show was added).
        refreshShow(d)
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

  if (loading) return <SkeletonDetail />
  if (error) return <ErrorBox message={error} />
  if (!detail) return <ErrorBox message="Show not found." />

  const followed = Boolean(tracked)
  const backdrop = backdropUrl(detail.backdrop_path)
  const year = detail.first_air_date?.slice(0, 4)
  const network = detail.networks[0]?.name
  const progress = tracked ? showProgress(tracked) : 0
  const watched = tracked ? watchedCount(tracked) : 0
  const upNext = tracked ? nextEpisode(tracked) : null
  const todayStr = new Date().toISOString().slice(0, 10)

  const ensureFollowed = () => {
    if (!tracked) addShow(detail)
  }

  const handleToggleEpisode = (s: number, e: number) => {
    const wasWatched = Boolean(tracked?.watched[episodeKey(s, e)])
    ensureFollowed()
    toggleEpisode(id, s, e)
    showToast(
      wasWatched ? `${epCode(s, e)} unmarked` : `${epCode(s, e)} marked watched ✓`,
      wasWatched ? '↩️' : '🎬',
    )
  }

  const handleMarkSeason = (s: number) => {
    ensureFollowed()
    markSeasonWatched(id, s)
    showToast(`Season ${s} marked watched ✓`, '📺')
  }

  const seasonWatchedCount =
    seasonDetail && tracked
      ? seasonDetail.episodes.filter(
          (ep) => tracked.watched[episodeKey(ep.season_number, ep.episode_number)],
        ).length
      : 0

  // Episodes of the selected season that have already aired ("mark season" only covers these).
  const seasonAiredCount = seasonDetail
    ? seasonDetail.episodes.filter((ep) => !(ep.air_date != null && ep.air_date > todayStr)).length
    : 0

  return (
    <div>
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

      {seasonLoading && <SeasonSkeleton />}
      {seasonError && <ErrorBox message={seasonError} />}
      {!seasonLoading && seasonDetail && season != null && (
        <div key={season} className="show-detail-season-body">
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
                <div key={ep.id} className={`show-detail-ep${isWatched ? ' watched' : ''}`}>
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
                      in {daysUntil(ep.air_date)} day{daysUntil(ep.air_date) === 1 ? '' : 's'}
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
    </div>
  )
}
