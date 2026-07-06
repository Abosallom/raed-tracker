// Watchlist page — titles saved for later, from the local library store.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { MediaType, WatchlistItem } from '../types'
import { useLibrary } from '../store/library'
import { PosterImage, timeAgo } from '../components/shared'
import { BackBar } from '../components/BackBar'
import { showToast } from '../components/toast'
import './watchlist.css'

type Filter = 'all' | MediaType

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'tv', label: 'Shows' },
  { key: 'movie', label: 'Movies' },
]

function WatchlistCard({ item }: { item: WatchlistItem }) {
  const removeFromWatchlist = useLibrary((st) => st.removeFromWatchlist)
  const to = item.type === 'tv' ? `/show/${item.id}` : `/movie/${item.id}`
  return (
    <div className="watchlist-card">
      <button
        className="watchlist-remove"
        title="Remove from watchlist"
        aria-label={`Remove ${item.name} from watchlist`}
        onClick={() => {
          removeFromWatchlist(item.type, item.id)
          showToast('Removed from watchlist', '🗑️')
        }}
      >
        ✕
      </button>
      <Link to={to} className="poster-card">
        <div style={{ position: 'relative' }}>
          <PosterImage path={item.poster_path} title={item.name} />
          <div className="watchlist-type-badge">{item.type === 'tv' ? 'Show' : 'Movie'}</div>
        </div>
        <div className="poster-title">{item.name}</div>
        <div className="poster-sub">
          {item.type === 'tv' ? 'Show' : 'Movie'} · added {timeAgo(item.addedAt)}
        </div>
      </Link>
    </div>
  )
}

export default function Watchlist() {
  const watchlist = useLibrary((st) => st.watchlist)
  const [filter, setFilter] = useState<Filter>('all')

  const counts: Record<Filter, number> = {
    all: watchlist.length,
    tv: watchlist.filter((w) => w.type === 'tv').length,
    movie: watchlist.filter((w) => w.type === 'movie').length,
  }
  const items = filter === 'all' ? watchlist : watchlist.filter((w) => w.type === filter)

  return (
    <div>
      <BackBar title="Watchlist" />
      <div className="toptabs" role="tablist" aria-label="My Shows sections">
        <Link className="toptab" to="/" role="tab" aria-selected="false">
          Keep Watching
        </Link>
        <Link className="toptab" to="/upcoming" role="tab" aria-selected="false">
          Upcoming
        </Link>
        <span className="toptab active" role="tab" aria-selected="true">
          Watch List
          {watchlist.length > 0 && <span className="toptab-count">{watchlist.length}</span>}
        </span>
      </div>
      <p className="page-subtitle">
        {watchlist.length === 0
          ? 'Nothing saved for later yet'
          : `${watchlist.length} ${watchlist.length === 1 ? 'title' : 'titles'} saved for later`}
      </p>

      {watchlist.length === 0 ? (
        <div className="empty-state">
          <div className="big">🔖</div>
          <p style={{ fontWeight: 600, fontSize: 17, color: 'var(--text)' }}>
            Your watchlist is empty
          </p>
          <p style={{ marginTop: 6 }}>
            Save shows and movies you want to watch later.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
            <Link className="btn primary" to="/search">
              🔍 Search titles
            </Link>
            <Link className="btn" to="/">
              📺 My Shows
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="watchlist-filters">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`watchlist-chip${filter === f.key ? ' active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="watchlist-chip-count">{counts[f.key]}</span>
              </button>
            ))}
          </div>

          {items.length === 0 ? (
            <div className="empty-state">
              <div className="big">{filter === 'tv' ? '📺' : '🎬'}</div>
              <p>No {filter === 'tv' ? 'shows' : 'movies'} on your watchlist.</p>
            </div>
          ) : (
            <div className="poster-grid stagger">
              {items.map((item) => (
                <WatchlistCard key={`${item.type}:${item.id}`} item={item} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
