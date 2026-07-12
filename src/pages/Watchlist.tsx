// Watchlist page — titles saved for later, from the local library store.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { MediaType, WatchlistItem } from '../types'
import { useLibrary } from '../store/library'
import { PosterImage, timeAgo } from '../components/shared'
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
      {/* Type appears once, in the caption — the filter chips above already
          segment by type, so a poster badge said "Movie" a third time. */}
      <Link to={to} className="poster-card">
        <PosterImage path={item.poster_path} title={item.name} />
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
  // With a single media type the segments are all the same list ("All 1 /
  // Movies 1") — hide the row entirely and just show everything.
  const bothTypes = counts.tv > 0 && counts.movie > 0
  const effectiveFilter = bothTypes ? filter : 'all'
  const items =
    effectiveFilter === 'all' ? watchlist : watchlist.filter((w) => w.type === effectiveFilter)

  return (
    <div>
      {/* No BackBar: this is a peer top tab, not a pushed page — the tab row
          IS the navigation. */}
      <div className="toptabs" role="tablist" aria-label="My Shows sections">
        <Link className="toptab" to="/" role="tab" aria-selected="false">
          Keep Watching
        </Link>
        <Link className="toptab" to="/upcoming" role="tab" aria-selected="false">
          Upcoming
        </Link>
        {/* No count bubble here: the subtitle and the "All" chip below already
            carry this number — one count per concept per screen. */}
        <span className="toptab active" role="tab" aria-selected="true">
          Watchlist
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
              Search titles
            </Link>
            <Link className="btn" to="/">
              My Shows
            </Link>
          </div>
        </div>
      ) : (
        <>
          {bothTypes && (
            <div className="watchlist-filters">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={`watchlist-chip${effectiveFilter === f.key ? ' active' : ''}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <span className="watchlist-chip-count">{counts[f.key]}</span>
                </button>
              ))}
            </div>
          )}

          {items.length === 0 ? (
            <div className="empty-state">
              <div className="big">{effectiveFilter === 'tv' ? '📺' : '🎬'}</div>
              <p>No {effectiveFilter === 'tv' ? 'shows' : 'movies'} on your watchlist.</p>
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
