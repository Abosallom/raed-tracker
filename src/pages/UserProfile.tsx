// Public profile for a seeded SocialUser (/user/:id). No backend exists, so
// favorites are a stable hashed slice of the CURRENT user's library (falling
// back to trending shows) and activity is a synthetic feed filtered to this
// user. Follow state lives in the local library store.

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ActivityItem, SearchResult, SocialUser } from '../types'
import { EMOTIONS } from '../types'
import { useLibrary } from '../store/library'
import {
  compactNumber,
  generateActivityFeed,
  getSocialUser,
} from '../api/social'
import { trendingShows } from '../api/tmdb'
import { BackBar } from '../components/BackBar'
import { PosterImage, timeAgo } from '../components/shared'
import { showToast } from '../components/toast'
import './userprofile.css'

const EMOTION_EMOJI: Record<string, string> = Object.fromEntries(
  EMOTIONS.map((e) => [e.key, e.emoji]),
)

function joinedLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'a while ago'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
}

/** FNV-1a — mirrors api/social's private hash so slices stay plausible/stable. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

interface FavTile {
  key: string
  to: string
  name: string
  poster_path: string | null
}

/**
 * A stable per-user slice of the caller's tracked titles so each profile shows
 * a different, plausible set of "favorite" posters. Rotates the pool by a hash
 * of the profile id (watcherCluster-style) and takes up to `size`.
 */
function pickFavorites(pool: FavTile[], userId: string, size = 6): FavTile[] {
  if (pool.length === 0) return []
  const start = hash(`favs:${userId}`) % pool.length
  const n = Math.min(size, pool.length)
  return Array.from({ length: n }, (_, i) => pool[(start + i) % pool.length])
}

function ActivityLine({ item }: { item: ActivityItem }) {
  const to = item.mediaType === 'tv' ? `/show/${item.mediaId}` : `/movie/${item.mediaId}`
  const epLabel =
    item.mediaType === 'tv' && item.season != null && item.episode != null
      ? ` · S${item.season} · E${item.episode}`
      : ''
  const verb =
    item.kind === 'watched' ? 'Watched' : item.kind === 'favorited' ? 'Favorited' : 'Commented on'
  return (
    <li className="up-activity-item">
      <span className="up-activity-verb">{verb}</span>{' '}
      <Link className="up-activity-target" to={to}>
        {item.mediaName}
      </Link>
      <span className="up-activity-ep">{epLabel}</span>
      {item.reaction && (
        <span className="up-activity-reaction" aria-hidden="true">
          {EMOTION_EMOJI[item.reaction]}
        </span>
      )}
      <span className="up-activity-time">{timeAgo(item.createdAt)}</span>
    </li>
  )
}

export default function UserProfile() {
  const { id = '' } = useParams()
  const user: SocialUser | undefined = getSocialUser(id)

  const shows = useLibrary((s) => s.shows)
  const movies = useLibrary((s) => s.movies)
  const following = useLibrary((s) => s.following)
  const toggleFollow = useLibrary((s) => s.toggleFollow)

  const [trending, setTrending] = useState<SearchResult[]>([])
  const [popped, setPopped] = useState(0)

  const isFollowing = following.includes(id)

  // Favorites fall back to trending shows when the local library is thin.
  useEffect(() => {
    let alive = true
    const libraryCount = Object.keys(shows).length + Object.keys(movies).length
    if (libraryCount >= 6) return
    trendingShows()
      .then((r) => {
        if (alive) setTrending(r)
      })
      .catch(() => {
        /* demo/offline: favorites just render from whatever library exists */
      })
    return () => {
      alive = false
    }
  }, [shows, movies])

  const favorites = useMemo<FavTile[]>(() => {
    const pool: FavTile[] = [
      ...Object.values(shows).map((s) => ({
        key: `tv:${s.snapshot.id}`,
        to: `/show/${s.snapshot.id}`,
        name: s.snapshot.name,
        poster_path: s.snapshot.poster_path,
      })),
      ...Object.values(movies).map((m) => ({
        key: `movie:${m.snapshot.id}`,
        to: `/movie/${m.snapshot.id}`,
        name: m.snapshot.title,
        poster_path: m.snapshot.poster_path,
      })),
      ...trending.map((t) => ({
        key: `tv:${t.id}`,
        to: `/show/${t.id}`,
        name: t.name,
        poster_path: t.poster_path,
      })),
    ]
    // Dedupe by key so a tracked-and-trending title only appears once.
    const seen = new Set<string>()
    const uniq = pool.filter((p) => (seen.has(p.key) ? false : (seen.add(p.key), true)))
    return pickFavorites(uniq, id)
  }, [shows, movies, trending, id])

  const activity = useMemo<ActivityItem[]>(() => {
    if (!user) return []
    const fallback = trending.map((t) => ({
      mediaType: 'tv' as const,
      mediaId: t.id,
      mediaName: t.name,
      poster_path: t.poster_path,
    }))
    return generateActivityFeed(shows, movies, fallback, 48)
      .filter((a) => a.user.id === user.id)
      .slice(0, 6)
  }, [user, shows, movies, trending])

  if (!user) {
    return (
      <div>
        <BackBar title="People" />
        <div className="empty-state card fade-in">
          <div className="big">🔒</div>
          This watcher is private
          <div className="up-private-sub">
            We couldn’t find this profile.{' '}
            <Link className="up-inline-link" to="/users">
              Browse people
            </Link>{' '}
            instead.
          </div>
        </div>
      </div>
    )
  }

  const onToggleFollow = () => {
    toggleFollow(user.id)
    setPopped((n) => n + 1)
    if (isFollowing) showToast(`Unfollowed ${user.name}`, '👋')
    else showToast(`Following ${user.name}`, '✨')
  }

  // Live-seasoned follower count: +1 the instant the current user follows.
  const followerDisplay = compactNumber(user.followerCount + (isFollowing ? 1 : 0))

  return (
    <div>
      <BackBar title="People" />

      <div className="card up-header fade-in">
        <div className="up-banner" aria-hidden="true" />
        <div className="up-header-inner">
          <div className="up-avatar" aria-hidden="true">
            {user.avatar}
          </div>
          <div className="up-header-body">
            <h1 className="up-name">{user.name}</h1>
            {user.bio && <p className="up-bio">{user.bio}</p>}
            <div className="up-joined">Joined {joinedLabel(user.joinedAt)}</div>

            <div className="up-chips">
              <span className="chip">
                📺 <b>{user.showsWatched}</b> shows watched
              </span>
              <span className="chip">
                👥 <b>{followerDisplay}</b> followers
              </span>
            </div>
          </div>

          <button
            key={popped}
            className={`up-follow-btn${isFollowing ? ' following' : ''}`}
            aria-pressed={isFollowing}
            onClick={onToggleFollow}
          >
            {isFollowing ? '✓ Following' : '+ Follow'}
          </button>
        </div>
      </div>

      {/* ---------- favorites ---------- */}
      <h2 className="section-title">
        <span>⭐ Favorites</span>
      </h2>
      {favorites.length === 0 ? (
        <div className="empty-state card fade-in">
          <div className="big">🍿</div>
          Nothing to show here yet.
        </div>
      ) : (
        <div className="media-row stagger">
          {favorites.map((f) => (
            <Link key={f.key} className="poster-card" to={f.to}>
              <PosterImage path={f.poster_path} title={f.name} />
              <div className="poster-title">{f.name}</div>
            </Link>
          ))}
        </div>
      )}

      {/* ---------- recent activity ---------- */}
      <h2 className="section-title">
        <span>📣 Recent activity</span>
      </h2>
      {activity.length === 0 ? (
        <div className="empty-state card fade-in">
          <div className="big">🌙</div>
          {user.name} hasn’t been active lately.
        </div>
      ) : (
        <ul className="card up-activity fade-in">
          {activity.map((a) => (
            <ActivityLine key={a.id} item={a} />
          ))}
        </ul>
      )}
    </div>
  )
}
