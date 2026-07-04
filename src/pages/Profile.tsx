// Profile page — avatar, display name, mini-stats, favorites, own comments.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Comment, TrackedMovie, TrackedShow } from '../types'
import { totalMinutesWatched, useLibrary, watchedCount } from '../store/library'
import { PosterImage, formatMinutes, timeAgo } from '../components/shared'
import './profile.css'

const AVATAR_CHOICES = [
  '🍿', '📺', '🎬', '🦉',
  '🌙', '🔥', '⭐', '🧡',
  '💜', '🤖', '👾', '🐱',
  '🐶', '🦊', '🐼', '🎭',
]

function memberSince(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'a while ago'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

/** "tv:1399" | "tv:1399:s1e1" | "movie:27205" -> link target + labels. */
function commentTarget(
  c: Comment,
  shows: Record<number, TrackedShow>,
  movies: Record<number, TrackedMovie>,
): { to: string; title: string; epLabel: string | null } {
  const [type, idStr, epPart] = c.mediaKey.split(':')
  const id = Number(idStr)
  const isMovie = type === 'movie'
  const to = isMovie ? `/movie/${idStr}` : `/show/${idStr}`
  const title = isMovie
    ? movies[id]?.snapshot.title ?? `Movie #${idStr}`
    : shows[id]?.snapshot.name ?? `Show #${idStr}`
  let epLabel: string | null = null
  if (epPart) {
    const m = /^s(\d+)e(\d+)$/i.exec(epPart)
    epLabel = m ? `S${m[1]} · E${m[2]}` : epPart
  }
  return { to, title, epLabel }
}

export default function Profile() {
  const profile = useLibrary((s) => s.profile)
  const shows = useLibrary((s) => s.shows)
  const movies = useLibrary((s) => s.movies)
  const comments = useLibrary((s) => s.comments)
  const updateProfile = useLibrary((s) => s.updateProfile)
  const deleteComment = useLibrary((s) => s.deleteComment)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const showList = Object.values(shows)
  const movieList = Object.values(movies)
  const episodesWatched = showList.reduce((n, s) => n + watchedCount(s), 0)
  const moviesWatched = movieList.filter((m) => m.watched).length
  const minutes = totalMinutesWatched(shows, movies)

  const favShows = showList.filter((s) => s.favorite)
  const favMovies = movieList.filter((m) => m.favorite)
  const myComments = comments.filter((c) => c.isMine)

  const startEditingName = () => {
    setNameDraft(profile.name)
    setEditingName(true)
  }

  const saveName = () => {
    const trimmed = nameDraft.trim()
    if (trimmed) updateProfile({ name: trimmed })
    setEditingName(false)
  }

  return (
    <div>
      <h1 className="page-title">Profile</h1>
      <p className="page-subtitle">Your identity, favorites and comments.</p>

      {/* ---------- header card ---------- */}
      <div className="card profile-header">
        <div className="profile-avatar-wrap">
          <button
            className="profile-avatar"
            title="Change avatar"
            onClick={() => setPickerOpen((o) => !o)}
          >
            {profile.avatar}
          </button>
          <span className="profile-avatar-hint">✏️</span>
          {pickerOpen && (
            <>
              <div className="profile-pop-backdrop" onClick={() => setPickerOpen(false)} />
              <div className="profile-emoji-pop">
                {AVATAR_CHOICES.map((emoji) => (
                  <button
                    key={emoji}
                    className={`profile-emoji-btn${emoji === profile.avatar ? ' selected' : ''}`}
                    onClick={() => {
                      updateProfile({ avatar: emoji })
                      setPickerOpen(false)
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="profile-name-row">
            {editingName ? (
              <>
                <input
                  className="profile-name-input"
                  value={nameDraft}
                  autoFocus
                  maxLength={40}
                  placeholder="Display name"
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName()
                    if (e.key === 'Escape') setEditingName(false)
                  }}
                />
                <button className="btn primary small" onClick={saveName}>
                  Save
                </button>
                <button className="btn small" onClick={() => setEditingName(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="profile-name">{profile.name}</span>
                <button className="profile-edit-link" onClick={startEditingName}>
                  ✏️ Edit
                </button>
              </>
            )}
          </div>
          <div className="profile-joined">Member since {memberSince(profile.joinedAt)}</div>

          <div className="profile-chips">
            <span className="chip">
              📺 <b>{episodesWatched}</b> episodes watched
            </span>
            <span className="chip">
              🎬 <b>{moviesWatched}</b> movies watched
            </span>
            <span className="chip">
              ⏱️ <b>{formatMinutes(minutes)}</b> total time
            </span>
          </div>
        </div>
      </div>

      {/* ---------- favorite shows ---------- */}
      <h2 className="section-title">Favorite shows</h2>
      {favShows.length === 0 ? (
        <div className="empty-state card">
          <div className="big">💜</div>
          No favorite shows yet — tap the heart on a show you love.
        </div>
      ) : (
        <div className="poster-grid">
          {favShows.map((s) => (
            <Link key={s.snapshot.id} className="poster-card" to={`/show/${s.snapshot.id}`}>
              <PosterImage path={s.snapshot.poster_path} title={s.snapshot.name} />
              <div className="poster-title">{s.snapshot.name}</div>
              <div className="poster-sub">
                {watchedCount(s)}/{s.snapshot.totalEpisodes} episodes
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* ---------- favorite movies ---------- */}
      <h2 className="section-title">Favorite movies</h2>
      {favMovies.length === 0 ? (
        <div className="empty-state card">
          <div className="big">🎞️</div>
          No favorite movies yet — mark some favorites from your movie library.
        </div>
      ) : (
        <div className="poster-grid">
          {favMovies.map((m) => (
            <Link key={m.snapshot.id} className="poster-card" to={`/movie/${m.snapshot.id}`}>
              <PosterImage path={m.snapshot.poster_path} title={m.snapshot.title} />
              <div className="poster-title">{m.snapshot.title}</div>
              <div className="poster-sub">{m.watched ? 'Watched' : 'Not watched yet'}</div>
            </Link>
          ))}
        </div>
      )}

      {/* ---------- your comments ---------- */}
      <h2 className="section-title">Your comments</h2>
      {myComments.length === 0 ? (
        <div className="empty-state card">
          <div className="big">💬</div>
          You haven’t commented yet — join the conversation on any show or movie page.
        </div>
      ) : (
        <div className="card" style={{ padding: '6px 16px' }}>
          {myComments.map((c) => {
            const { to, title, epLabel } = commentTarget(c, shows, movies)
            return (
              <div key={c.id} className="profile-comment">
                <span style={{ fontSize: 22, lineHeight: '28px' }}>{c.avatar}</span>
                <div className="profile-comment-body">
                  <div>
                    <Link className="profile-comment-target" to={to}>
                      {title}
                    </Link>
                    {epLabel && <span className="profile-comment-ep">{epLabel}</span>}
                  </div>
                  <div className="profile-comment-text">{c.text}</div>
                  <div className="profile-comment-time">
                    {timeAgo(c.createdAt)}
                    {c.likes > 0 && <> · ❤️ {c.likes}</>}
                  </div>
                </div>
                <button
                  className="btn danger small"
                  title="Delete comment"
                  onClick={() => deleteComment(c.id)}
                >
                  Delete
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
