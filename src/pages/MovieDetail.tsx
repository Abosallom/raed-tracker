// Movie detail page — route /movie/:id
// Backdrop hero, watched toggle + emotion reaction, watchlist, favorite,
// IMDb link, cast strip and comments. Works in demo mode (ids 800001-800006).

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type {
  CastMember,
  Emotion,
  MovieDetail as MovieDetailData,
  SearchResult,
} from '../types'
import { EMOTIONS } from '../types'
import {
  backdropUrl,
  getMovieDetail,
  getRecommendations,
  getTrailerKey,
  imdbTitleUrl,
  profileUrl,
  youtubeUrl,
} from '../api/tmdb'
import { useLibrary } from '../store/library'
import {
  ErrorBox,
  MediaRow,
  PosterImage,
  Rating,
  ReactionPicker,
  SkeletonDetail,
  formatMinutes,
} from '../components/shared'
import { CommentsSection } from '../components/CommentsSection'
import { BackBar } from '../components/BackBar'
import { showToast } from '../components/toast'
import { ConfettiHost, fireConfetti } from '../components/Confetti'
import './moviedetail.css'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

function CastStrip({ cast }: { cast: CastMember[] }) {
  if (cast.length === 0) return null
  return (
    <>
      <div className="section-title">Cast</div>
      <div className="moviedetail-cast stagger">
        {cast.map((c) => {
          const photo = profileUrl(c.profile_path)
          return (
            <div key={c.id} className="moviedetail-cast-member">
              {photo ? (
                <img className="moviedetail-cast-photo" src={photo} alt={c.name} loading="lazy" />
              ) : (
                <div className="moviedetail-cast-initials">{initials(c.name)}</div>
              )}
              <div className="moviedetail-cast-name">{c.name}</div>
              <div className="moviedetail-cast-role">{c.character}</div>
            </div>
          )
        })}
      </div>
    </>
  )
}

export default function MovieDetail() {
  const { id } = useParams()
  const movieId = Number(id)

  const [detail, setDetail] = useState<MovieDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trailerKey, setTrailerKey] = useState<string | null>(null)
  const [recs, setRecs] = useState<SearchResult[]>([])

  const tracked = useLibrary((s) => s.movies[movieId])
  const onWatchlist = useLibrary((s) =>
    s.watchlist.some((w) => w.type === 'movie' && w.id === movieId),
  )
  const addMovie = useLibrary((s) => s.addMovie)
  const removeMovie = useLibrary((s) => s.removeMovie)
  const toggleMovieWatched = useLibrary((s) => s.toggleMovieWatched)
  const setMovieEmotion = useLibrary((s) => s.setMovieEmotion)
  const toggleFavoriteMovie = useLibrary((s) => s.toggleFavoriteMovie)
  const addToWatchlist = useLibrary((s) => s.addToWatchlist)
  const removeFromWatchlist = useLibrary((s) => s.removeFromWatchlist)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError(null)
    if (!Number.isFinite(movieId)) {
      setError('Invalid movie id.')
      return
    }
    getMovieDetail(movieId)
      .then((m) => {
        if (!cancelled) setDetail(m)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load movie.')
      })
    return () => {
      cancelled = true
    }
  }, [movieId])

  // Trailer + "More like this" load alongside the main detail (best-effort:
  // failures/demo mode just hide those bits).
  useEffect(() => {
    let cancelled = false
    setTrailerKey(null)
    setRecs([])
    if (!Number.isFinite(movieId)) return
    getTrailerKey('movie', movieId).then((key) => {
      if (!cancelled) setTrailerKey(key)
    })
    getRecommendations('movie', movieId)
      .then((items) => {
        if (!cancelled) setRecs(items.slice(0, 12))
      })
      .catch(() => {
        if (!cancelled) setRecs([])
      })
    return () => {
      cancelled = true
    }
  }, [movieId])

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
        <SkeletonDetail />
      </div>
    )

  const year = detail.release_date ? detail.release_date.slice(0, 4) : null
  const watched = tracked?.watched ?? null
  const emotionMeta = watched?.emotion
    ? EMOTIONS.find((e) => e.key === watched.emotion)
    : undefined

  const backdrop = backdropUrl(detail.backdrop_path)

  const handleWatchedToggle = () => {
    const wasWatched = Boolean(tracked?.watched)
    if (!tracked) addMovie(detail)
    toggleMovieWatched(movieId)
    if (wasWatched) {
      showToast(`${detail.title} unmarked`, '↩️')
    } else {
      fireConfetti()
      showToast(`${detail.title} watched — enjoy the credits! 🎉`, '🎬')
    }
  }

  const handleWatchlistToggle = () => {
    if (onWatchlist) {
      removeFromWatchlist('movie', movieId)
      showToast('Removed from watchlist', '🔖')
    } else {
      addToWatchlist({
        type: 'movie',
        id: movieId,
        name: detail.title,
        poster_path: detail.poster_path,
      })
      showToast('Added to watchlist', '🔖')
    }
  }

  const handleEmotionChange = (e: Emotion | undefined) => {
    setMovieEmotion(movieId, e)
    const meta = e ? EMOTIONS.find((m) => m.key === e) : undefined
    if (meta) showToast(`Feeling ${meta.emoji} about it!`)
    else showToast('Reaction cleared', '↩️')
  }

  return (
    <div>
      <BackBar title={detail.title} />
      <ConfettiHost />
      <div className="moviedetail-hero">
        {backdrop && (
          <div className="moviedetail-hero-bg" style={{ backgroundImage: `url(${backdrop})` }} />
        )}
        <div className="moviedetail-hero-inner">
          <div className="moviedetail-poster">
            <PosterImage path={detail.poster_path} title={detail.title} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="moviedetail-title">{detail.title}</div>
            {detail.tagline && <div className="moviedetail-tagline">“{detail.tagline}”</div>}

            <div className="moviedetail-chips">
              {year && <span className="chip">{year}</span>}
              {detail.runtime != null && detail.runtime > 0 && (
                <span className="chip">{formatMinutes(detail.runtime)}</span>
              )}
              <Rating value={detail.vote_average} />
              {detail.genres.map((g) => (
                <span key={g.id} className="chip">
                  {g.name}
                </span>
              ))}
            </div>

            <div className="moviedetail-actions">
              <button
                className={`btn moviedetail-watched-btn${watched ? ' is-watched' : ' primary'}`}
                onClick={handleWatchedToggle}
              >
                {watched ? '✓ Watched' : '+ Mark watched'}
              </button>

              <button className="btn" onClick={handleWatchlistToggle}>
                {onWatchlist ? '🔖 On watchlist' : '🔖 Add to watchlist'}
              </button>

              {tracked && (
                <button
                  className={`btn moviedetail-fav${tracked.favorite ? ' is-fav' : ''}`}
                  title={tracked.favorite ? 'Unfavorite' : 'Favorite'}
                  onClick={() => {
                    const wasFavorite = tracked.favorite
                    toggleFavoriteMovie(movieId)
                    showToast(
                      wasFavorite ? 'Removed from favorites' : 'Added to favorites',
                      wasFavorite ? '☆' : '⭐',
                    )
                  }}
                >
                  {tracked.favorite ? '★' : '☆'}
                </button>
              )}

              {trailerKey && (
                <a
                  className="btn moviedetail-trailer-btn"
                  href={youtubeUrl(trailerKey)}
                  target="_blank"
                  rel="noreferrer"
                >
                  ▶ Trailer
                </a>
              )}
              {detail.imdb_id && (
                <a
                  className="btn moviedetail-imdb-btn"
                  href={imdbTitleUrl(detail.imdb_id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  IMDb ↗
                </a>
              )}

              {tracked && (
                <button
                  className="btn danger"
                  onClick={() => {
                    removeMovie(movieId)
                    showToast(`Removed ${detail.title} from library`, '🗑️')
                  }}
                >
                  Remove from library
                </button>
              )}
            </div>

            {watched && (
              <div className="moviedetail-feel-card">
                <span className="moviedetail-feel-label">How did it make you feel?</span>
                <ReactionPicker value={watched.emotion} onChange={handleEmotionChange} />
                <span className="moviedetail-feel-date">
                  {emotionMeta ? `${emotionMeta.label} · ` : ''}
                  Watched{' '}
                  {new Date(watched.watchedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {detail.overview && (
        <>
          <div className="section-title">Overview</div>
          <p className="moviedetail-overview">{detail.overview}</p>
        </>
      )}

      <CastStrip cast={detail.cast} />

      <div style={{ marginTop: 32 }}>
        <CommentsSection mediaKey={`movie:${movieId}`} />
      </div>

      {recs.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 32 }}>
            More like this
          </div>
          <MediaRow items={recs} />
        </>
      )}
    </div>
  )
}
