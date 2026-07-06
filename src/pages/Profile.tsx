// Profile page — identity hub: avatar + name, stats summary, custom lists,
// favorites, full library grids and the user's own comments.

import { useMemo, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Comment, TrackedMovie, TrackedShow } from '../types'
import { useLibrary, watchedCount } from '../store/library'
import { computeStreaks } from '../lib/streaks'
import { useAdminGate } from '../lib/admin'
import {
  getDeferredPrompt,
  isIOSSafari,
  isStandalone,
  promptInstall,
  subscribeInstall,
} from '../lib/install'
import { posterUrl } from '../api/tmdb'
import { compactNumber } from '../api/social'
import { PosterImage, formatMinutes, timeAgo } from '../components/shared'
import { showToast } from '../components/toast'
import './profile.css'

const AVATAR_CHOICES = [
  '🍿', '📺', '🎬', '🦉',
  '🌙', '🔥', '⭐', '🧡',
  '💜', '🤖', '👾', '🐱',
  '🐶', '🦊', '🐼', '🎭',
]

const GRID_CAP = 12

function memberSince(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'a while ago'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

/** Tiny poster thumbnail for list cards; letter tile when no image (demo mode). */
function MiniThumb({ path, title }: { path: string | null; title: string }) {
  const url = posterUrl(path, 'w185')
  if (!url) {
    return (
      <div className="profile-list-thumb fallback" aria-hidden="true">
        {title.slice(0, 1).toUpperCase()}
      </div>
    )
  }
  return <img className="profile-list-thumb" src={url} alt="" loading="lazy" />
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

/** "Get the app" install card — hidden once running as an installed app.
    Chrome (Android/desktop) gets a real Install button via the captured
    beforeinstallprompt; iOS Safari gets Share-sheet instructions; everything
    else gets a generic browser-menu pointer. */
function InstallCard() {
  const deferred = useSyncExternalStore(subscribeInstall, getDeferredPrompt)
  if (isStandalone()) return null

  const handleInstall = async () => {
    const outcome = await promptInstall()
    if (outcome === 'accepted') showToast('Installing Raed Tracker…', '📲')
    else if (outcome === 'dismissed') showToast('Install dismissed — it’ll be here later', '🙂')
  }

  return (
    <div className="card profile-install fade-in">
      <span className="profile-install-icon" aria-hidden="true">
        📲
      </span>
      <div className="profile-install-body">
        <div className="profile-install-title">Get the app</div>
        <div className="profile-install-text">
          {deferred ? (
            <>Install Raed Tracker for a faster, full-screen experience on your home screen.</>
          ) : isIOSSafari() ? (
            <>
              Tap <b>Share</b> <span aria-hidden="true">⬆︎</span> in Safari, then{' '}
              <b>Add to Home Screen</b>.
            </>
          ) : (
            <>Installs right from your browser menu — look for “Install app”.</>
          )}
        </div>
      </div>
      {deferred && (
        <button className="btn primary small profile-install-btn" onClick={() => void handleInstall()}>
          Install
        </button>
      )}
    </div>
  )
}

export default function Profile() {
  const adminGate = useAdminGate()
  const profile = useLibrary((s) => s.profile)
  const shows = useLibrary((s) => s.shows)
  const movies = useLibrary((s) => s.movies)
  const watchlist = useLibrary((s) => s.watchlist)
  const comments = useLibrary((s) => s.comments)
  const lists = useLibrary((s) => s.lists)
  const following = useLibrary((s) => s.following)
  const updateProfile = useLibrary((s) => s.updateProfile)
  const deleteComment = useLibrary((s) => s.deleteComment)
  const createList = useLibrary((s) => s.createList)
  const navigate = useNavigate()

  const [pickerOpen, setPickerOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [newListName, setNewListName] = useState('')

  const showList = Object.values(shows).sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  const movieList = Object.values(movies).sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  const episodesWatched = showList.reduce((n, s) => n + watchedCount(s), 0)
  const moviesWatched = movieList.filter((m) => m.watched).length
  const tvMinutes = showList.reduce((n, s) => n + watchedCount(s) * s.snapshot.runtime, 0)
  const movieMinutes = movieList.reduce((n, m) => n + (m.watched ? m.snapshot.runtime : 0), 0)

  const streaks = useMemo(() => computeStreaks(shows, movies), [shows, movies])
  // Synthetic-but-stable follower base seeded off the join date, seasoned with
  // the real number of people the user follows back (no backend social graph).
  const followerCount = useMemo(() => {
    let h = 2166136261
    const seed = profile.joinedAt
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return (Math.abs(h) % 480) + 12 + following.length * 3
  }, [profile.joinedAt, following.length])
  const favShows = showList.filter((s) => s.favorite)
  const favMovies = movieList.filter((m) => m.favorite)
  const myComments = comments.filter((c) => c.isMine)

  const startEditingName = () => {
    setNameDraft(profile.name)
    setEditingName(true)
  }

  const saveName = () => {
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== profile.name) {
      updateProfile({ name: trimmed })
      showToast(`Name updated to ${trimmed}`, '✏️')
    }
    setEditingName(false)
  }

  const pickAvatar = (emoji: string) => {
    updateProfile({ avatar: emoji })
    setPickerOpen(false)
    if (emoji !== profile.avatar) showToast('Avatar updated', emoji)
  }

  const submitNewList = (e: React.FormEvent) => {
    e.preventDefault()
    const name = newListName.trim()
    if (!name) return
    const id = createList(name)
    setNewListName('')
    showToast(`List “${name}” created`, '📃')
    navigate(`/list/${id}`)
  }

  const removeComment = (c: Comment) => {
    deleteComment(c.id)
    showToast('Comment deleted', '🗑️')
  }

  return (
    <div>
      <div className="profile-top">
        <div className="profile-top-titles">
          <h1 className="page-title">Profile</h1>
          <p className="page-subtitle">Your identity, stats, lists, favorites and comments.</p>
        </div>
        <div className="profile-shortcuts" aria-label="Profile shortcuts">
          <Link className="profile-shortcut" to="/settings" aria-label="Settings" title="Settings">
            ⚙️
          </Link>
          <Link className="profile-shortcut" to="/account" aria-label="Account" title="Account">
            🔐
          </Link>
          <Link
            className="profile-shortcut"
            to="/watchlist"
            aria-label="Watchlist"
            title="Watchlist"
          >
            🔖
          </Link>
          {adminGate.isAdmin && adminGate.adminMode && (
            <Link className="profile-shortcut" to="/admin" aria-label="Admin" title="Admin">
              🛡️
            </Link>
          )}
        </div>
      </div>

      {/* ---------- header card ---------- */}
      <div className="card profile-header fade-in">
        <div className="profile-banner" aria-hidden="true" />
        <div className="profile-header-inner">
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
                      onClick={() => pickAvatar(emoji)}
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
              <Link className="chip profile-social-chip" to="/users?filter=following">
                🤝 <b>{following.length}</b> following
              </Link>
              <Link className="chip profile-social-chip" to="/users">
                👥 <b>{compactNumber(followerCount)}</b> followers
              </Link>
              <span className="chip">
                📺 <b>{showList.length}</b> shows followed
              </span>
              <span className="chip">
                ✅ <b>{episodesWatched}</b> episodes watched
              </span>
              <span className="chip">
                💬 <b>{myComments.length}</b> comments
              </span>
              {streaks.current >= 2 && (
                <span
                  className="chip"
                  title={`Longest streak: ${streaks.longest} days`}
                  style={{
                    borderColor: 'var(--accent)',
                    background: 'var(--accent-soft)',
                    color: 'var(--accent)',
                  }}
                >
                  🔥 <b style={{ color: 'var(--accent)' }}>{streaks.current}</b>-day streak
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- install nudge (browser tab only) ---------- */}
      <InstallCard />

      {/* ---------- stats summary ---------- */}
      <h2 className="section-title">
        <span>📊 Stats</span>
        <Link className="profile-viewall" to="/stats">
          Full stats →
        </Link>
      </h2>
      <div className="profile-stat-cards stagger">
        <Link className="card profile-stat-card" to="/stats">
          <span className="profile-stat-emoji" aria-hidden="true">
            📺
          </span>
          <span className="profile-stat-cell">
            <span className="profile-stat-value">{formatMinutes(tvMinutes)}</span>
            <span className="profile-stat-label">TV time</span>
          </span>
          <span className="profile-stat-cell">
            <span className="profile-stat-value">{episodesWatched}</span>
            <span className="profile-stat-label">Episodes watched</span>
          </span>
          <span className="profile-stat-arrow" aria-hidden="true">
            →
          </span>
        </Link>
        <Link className="card profile-stat-card" to="/stats">
          <span className="profile-stat-emoji" aria-hidden="true">
            🎬
          </span>
          <span className="profile-stat-cell">
            <span className="profile-stat-value">{formatMinutes(movieMinutes)}</span>
            <span className="profile-stat-label">Movie time</span>
          </span>
          <span className="profile-stat-cell">
            <span className="profile-stat-value">{moviesWatched}</span>
            <span className="profile-stat-label">Movies watched</span>
          </span>
          <span className="profile-stat-arrow" aria-hidden="true">
            →
          </span>
        </Link>
        {/* Watchlist is otherwise orphaned on mobile — give it a visible card. */}
        <Link className="card profile-stat-card" to="/watchlist">
          <span className="profile-stat-emoji" aria-hidden="true">
            🔖
          </span>
          <span className="profile-stat-cell">
            <span className="profile-stat-value">{watchlist.length}</span>
            <span className="profile-stat-label">On your watchlist</span>
          </span>
          <span className="profile-stat-cell">
            <span className="profile-stat-value">{streaks.current}</span>
            <span className="profile-stat-label">Day streak</span>
          </span>
          <span className="profile-stat-arrow" aria-hidden="true">
            →
          </span>
        </Link>
      </div>

      {/* ---------- custom lists ---------- */}
      <h2 className="section-title">
        <span>📃 Lists</span>
      </h2>
      <div className="profile-lists stagger">
        <form className="card profile-list-create" onSubmit={submitNewList}>
          <div className="profile-list-create-title">➕ New list</div>
          <input
            className="profile-list-create-input"
            value={newListName}
            maxLength={48}
            placeholder="e.g. Cozy weekend picks"
            onChange={(e) => setNewListName(e.target.value)}
          />
          <button className="btn primary small" type="submit" disabled={!newListName.trim()}>
            Create list
          </button>
        </form>
        {lists.map((l) => (
          <Link key={l.id} className="card profile-list-card" to={`/list/${l.id}`}>
            <div className="profile-list-thumbs" aria-hidden="true">
              {l.items.length === 0 ? (
                <div className="profile-list-thumb empty">🍿</div>
              ) : (
                l.items
                  .slice(0, 4)
                  .map((it) => <MiniThumb key={`${it.type}:${it.id}`} path={it.poster_path} title={it.name} />)
              )}
            </div>
            <div className="profile-list-meta">
              <div className="profile-list-name">{l.name}</div>
              <div className="profile-list-count">
                {l.items.length} {l.items.length === 1 ? 'item' : 'items'}
              </div>
            </div>
            <span className="profile-list-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </div>

      {/* ---------- favorite shows ---------- */}
      <h2 className="section-title">
        <span>
          <span className="profile-fav-heart" aria-hidden="true">
            ♥
          </span>{' '}
          Favorite shows
        </span>
      </h2>
      {favShows.length === 0 ? (
        <div className="card profile-fav-empty fade-in">
          <span>No favorite shows yet — tap the heart on a show you love.</span>
          <Link className="btn small" to="/shows">
            Add favorites
          </Link>
        </div>
      ) : (
        <div className="media-row stagger">
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
      <h2 className="section-title">
        <span>
          <span className="profile-fav-heart" aria-hidden="true">
            ♥
          </span>{' '}
          Favorite movies
        </span>
      </h2>
      {favMovies.length === 0 ? (
        <div className="card profile-fav-empty fade-in">
          <span>No favorite movies yet — mark some favorites from your movie library.</span>
          <Link className="btn small" to="/movies">
            Add favorites
          </Link>
        </div>
      ) : (
        <div className="media-row stagger">
          {favMovies.map((m) => (
            <Link key={m.snapshot.id} className="poster-card" to={`/movie/${m.snapshot.id}`}>
              <PosterImage path={m.snapshot.poster_path} title={m.snapshot.title} />
              <div className="poster-title">{m.snapshot.title}</div>
              <div className="poster-sub">{m.watched ? 'Watched' : 'Not watched yet'}</div>
            </Link>
          ))}
        </div>
      )}

      {/* ---------- all shows ---------- */}
      <h2 className="section-title">
        <span>📺 Shows</span>
        {showList.length > 0 && (
          <Link className="profile-viewall" to="/shows">
            View all ({showList.length}) →
          </Link>
        )}
      </h2>
      {showList.length === 0 ? (
        <div className="empty-state card fade-in">
          <div className="big">📺</div>
          You aren’t following any shows yet — find some in{' '}
          <Link className="profile-inline-link" to="/search">
            Explore
          </Link>
          .
        </div>
      ) : (
        <div className="poster-grid stagger">
          {showList.slice(0, GRID_CAP).map((s) => (
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

      {/* ---------- all movies ---------- */}
      <h2 className="section-title">
        <span>🎬 Movies</span>
        {movieList.length > 0 && (
          <Link className="profile-viewall" to="/movies">
            View all ({movieList.length}) →
          </Link>
        )}
      </h2>
      {movieList.length === 0 ? (
        <div className="empty-state card fade-in">
          <div className="big">🎬</div>
          No movies tracked yet — find some in{' '}
          <Link className="profile-inline-link" to="/search">
            Explore
          </Link>
          .
        </div>
      ) : (
        <div className="poster-grid stagger">
          {movieList.slice(0, GRID_CAP).map((m) => (
            <Link key={m.snapshot.id} className="poster-card" to={`/movie/${m.snapshot.id}`}>
              <PosterImage path={m.snapshot.poster_path} title={m.snapshot.title} />
              <div className="poster-title">{m.snapshot.title}</div>
              <div className="poster-sub">{m.watched ? 'Watched' : 'Not watched yet'}</div>
            </Link>
          ))}
        </div>
      )}

      {/* ---------- your comments ---------- */}
      <h2 className="section-title">
        <span>💬 Your comments</span>
      </h2>
      {myComments.length === 0 ? (
        <div className="empty-state card fade-in">
          <div className="big">💬</div>
          You haven’t commented yet — join the conversation on any show or movie page.
        </div>
      ) : (
        <div className="card fade-in" style={{ padding: '6px 16px' }}>
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
                  onClick={() => removeComment(c)}
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
