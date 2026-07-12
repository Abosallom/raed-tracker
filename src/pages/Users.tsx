// People (/users) — real members from Supabase (profiles table), with an
// inline follow toggle backed by the follows table. Falls back to the seeded
// SOCIAL_USERS only in demo mode or before any real members exist. A
// "Following (N)" chip filters to followed users.

import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { SocialUser } from '../types'
import { useLibrary } from '../store/library'
import { SOCIAL_USERS, compactNumber } from '../api/social'
import { fetchFollowingIds, fetchProfiles, setFollow, socialLiveEnabled } from '../api/social-live'
import { BackBar } from '../components/BackBar'
import { showToast } from '../components/toast'
import './users.css'

function UserRow({ user }: { user: SocialUser }) {
  const following = useLibrary((s) => s.following)
  const toggleFollow = useLibrary((s) => s.toggleFollow)
  const isFollowing = following.includes(user.id)
  const [popped, setPopped] = useState(0)

  const onToggle = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    toggleFollow(user.id) // local optimistic + persisted
    void setFollow(user.id, !isFollowing) // real follows table (no-op offline)
    setPopped((n) => n + 1)
    if (isFollowing) showToast(`Unfollowed ${user.name}`, '👋')
    else showToast(`Following ${user.name}`, '✨')
  }

  const followerDisplay = compactNumber(user.followerCount + (isFollowing ? 1 : 0))

  return (
    <Link className="card users-row" to={`/user/${user.id}`}>
      <div className="users-avatar" aria-hidden="true">
        {user.avatar}
      </div>
      <div className="users-body">
        <div className="users-name">{user.name}</div>
        {user.bio && <div className="users-bio">{user.bio}</div>}
        <div className="users-followers">👥 {followerDisplay} followers</div>
      </div>
      <button
        key={popped}
        className={`users-follow-btn${isFollowing ? ' following' : ''}`}
        aria-pressed={isFollowing}
        onClick={onToggle}
      >
        {isFollowing ? '✓ Following' : '+ Follow'}
      </button>
    </Link>
  )
}

export default function Users() {
  const following = useLibrary((s) => s.following)
  const setFollowingIds = useLibrary((s) => s.setFollowingIds)
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [liveUsers, setLiveUsers] = useState<SocialUser[] | null>(null)

  const onlyFollowing = params.get('filter') === 'following'

  // Load real members + reconcile the local follow set with the follows table.
  useEffect(() => {
    if (!socialLiveEnabled()) return
    let alive = true
    void (async () => {
      const [users, ids] = await Promise.all([fetchProfiles(), fetchFollowingIds()])
      if (!alive) return
      if (users.length > 0) setLiveUsers(users)
      if (ids.length > 0) setFollowingIds(ids)
    })()
    return () => {
      alive = false
    }
  }, [setFollowingIds])

  const setOnlyFollowing = (on: boolean) => {
    const next = new URLSearchParams(params)
    if (on) next.set('filter', 'following')
    else next.delete('filter')
    setParams(next, { replace: true })
  }

  // Real members when present; otherwise the seeded roster (demo / cold start).
  const source = liveUsers && liveUsers.length > 0 ? liveUsers : SOCIAL_USERS

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return source.filter((u) => {
      if (onlyFollowing && !following.includes(u.id)) return false
      if (!q) return true
      return u.name.toLowerCase().includes(q) || (u.bio ?? '').toLowerCase().includes(q)
    })
  }, [query, onlyFollowing, following, source])

  return (
    <div>
      <BackBar title="Profile" />

      <h1 className="page-title">People</h1>
      <p className="page-subtitle">Find other watchers and follow their activity.</p>

      <div className="users-controls">
        <input
          className="users-search"
          value={query}
          placeholder="Search people…"
          aria-label="Search people by name"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className={`chip users-filter-chip${onlyFollowing ? ' active' : ''}`}
          aria-pressed={onlyFollowing}
          onClick={() => setOnlyFollowing(!onlyFollowing)}
        >
          ✓ Following ({following.length})
        </button>
      </div>

      {results.length === 0 ? (
        <div className="empty-state card fade-in">
          <div className="big">{onlyFollowing ? '👥' : '🔍'}</div>
          {onlyFollowing ? (
            <>
              You’re not following anyone yet — tap <b>Follow</b> on a watcher to see them here.
            </>
          ) : (
            <>No one matches “{query.trim()}”.</>
          )}
        </div>
      ) : (
        <div className="users-list stagger">
          {results.map((u) => (
            <UserRow key={u.id} user={u} />
          ))}
        </div>
      )}
    </div>
  )
}
