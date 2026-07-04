// My Shows — library page rendered purely from the store (no API calls).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { nextEpisode, showProgress, useLibrary, watchedCount } from '../store/library'
import type { TrackedShow } from '../types'
import { PosterImage, ProgressBar } from '../components/shared'
import { showToast } from '../components/toast'
import './myshows.css'

const TABS = [
  { key: 'watching', label: 'Watching' },
  { key: 'next', label: 'Watch Next' },
  { key: 'notstarted', label: 'Not Started' },
  { key: 'uptodate', label: 'Up to Date' },
  { key: 'all', label: 'All' },
] as const

type TabKey = (typeof TABS)[number]['key']

const EMPTY_HINTS: Record<TabKey, string> = {
  watching: 'Nothing in progress right now. Start an episode and shows will land here.',
  next: 'You are all caught up — nothing queued to watch next.',
  notstarted: 'No untouched shows. Everything here has at least one episode watched.',
  uptodate: 'No shows fully caught up yet. Keep watching!',
  all: 'Nothing matches this filter.',
}

function epCode(season: number, episode: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `S${pad(season)}E${pad(episode)}`
}

/** Most recent watch activity (falls back to when the show was added). */
function lastActivity(show: TrackedShow): number {
  let t = new Date(show.addedAt).getTime()
  for (const rec of Object.values(show.watched)) {
    const w = new Date(rec.watchedAt).getTime()
    if (w > t) t = w
  }
  return t
}

function inTab(show: TrackedShow, tab: TabKey): boolean {
  switch (tab) {
    case 'watching':
      return watchedCount(show) > 0 && nextEpisode(show) !== null
    case 'next':
      return nextEpisode(show) !== null
    case 'notstarted':
      return watchedCount(show) === 0
    case 'uptodate':
      return nextEpisode(show) === null
    case 'all':
      return true
  }
}

/**
 * Progress bar that animates its fill in on mount: first paint renders 0%,
 * then the real value is applied on the next frame so the CSS width
 * transition sweeps the bar to its actual position.
 */
function AnimatedProgressBar({ value }: { value: number }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShown(value))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [value])
  return <ProgressBar value={shown} />
}

function ShowCard({ show }: { show: TrackedShow }) {
  const toggleEpisode = useLibrary((s) => s.toggleEpisode)
  const toggleFavoriteShow = useLibrary((s) => s.toggleFavoriteShow)
  const snap = show.snapshot
  // Recomputed on every render, so the button advances after each click.
  const next = nextEpisode(show)
  const seen = watchedCount(show)
  const metaLine = [...snap.genres.slice(0, 3), snap.status].filter(Boolean).join(' · ')

  return (
    <div className="myshows-card">
      <Link to={`/show/${snap.id}`} className="myshows-poster" title={snap.name}>
        <PosterImage path={snap.poster_path} title={snap.name} />
      </Link>

      <div className="myshows-info">
        <Link to={`/show/${snap.id}`} className="myshows-name">
          {snap.name}
        </Link>
        <div className="myshows-genres">{metaLine}</div>
        <div className="myshows-progress-row">
          <AnimatedProgressBar value={showProgress(show)} />
          <span className="myshows-eps">
            {seen}/{snap.totalEpisodes} episodes
          </span>
        </div>
      </div>

      <div className="myshows-actions">
        <button
          className={`myshows-star${show.favorite ? ' on' : ''}`}
          title={show.favorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={() => toggleFavoriteShow(snap.id)}
        >
          {show.favorite ? '★' : '☆'}
        </button>
        {next ? (
          <button
            className="btn primary small myshows-watch"
            onClick={() => {
              toggleEpisode(snap.id, next.season, next.episode)
              showToast(`${epCode(next.season, next.episode)} watched ✓`, '📺')
              // Read fresh state: did that quick action fully catch us up?
              const updated = useLibrary.getState().shows[snap.id]
              if (updated && nextEpisode(updated) === null) {
                showToast(`All caught up on ${snap.name} 🎉`)
              }
            }}
          >
            ✓ Watch {epCode(next.season, next.episode)}
          </button>
        ) : (
          <span className="myshows-uptodate">✓ Up to date</span>
        )}
      </div>
    </div>
  )
}

export default function MyShows() {
  const shows = useLibrary((s) => s.shows)
  const [tab, setTab] = useState<TabKey>('next')
  const [favOnly, setFavOnly] = useState(false)

  const all = Object.values(shows)
  const pool = favOnly ? all.filter((s) => s.favorite) : all

  const counts: Record<TabKey, number> = { watching: 0, next: 0, notstarted: 0, uptodate: 0, all: 0 }
  for (const s of pool) for (const t of TABS) if (inTab(s, t.key)) counts[t.key]++

  const visible = pool
    .filter((s) => inTab(s, tab))
    .sort((a, b) =>
      tab === 'notstarted'
        ? new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
        : lastActivity(b) - lastActivity(a),
    )

  const totalEps = all.reduce((n, s) => n + watchedCount(s), 0)

  return (
    <div>
      <h1 className="page-title">My Shows</h1>
      <p className="page-subtitle">
        {all.length === 0
          ? 'Every show you track lives here.'
          : `${all.length} ${all.length === 1 ? 'show' : 'shows'} tracked · ${totalEps} ${
              totalEps === 1 ? 'episode' : 'episodes'
            } watched`}
      </p>

      <div className="myshows-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`myshows-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className="myshows-count">{counts[t.key]}</span>
          </button>
        ))}
        <span className="myshows-spacer" />
        <button
          className={`myshows-tab myshows-fav${favOnly ? ' active' : ''}`}
          onClick={() => setFavOnly((v) => !v)}
          title="Only show favorite shows"
        >
          ★ Favorites only
        </button>
      </div>

      {all.length === 0 ? (
        <div className="empty-state">
          <div className="big">📺</div>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
            You aren't tracking any shows yet
          </p>
          <p style={{ marginTop: 4 }}>Find something great and start checking off episodes.</p>
          <Link className="btn primary" to="/search" style={{ marginTop: 18 }}>
            🔍 Find shows to track
          </Link>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <div className="big">{favOnly && pool.length === 0 ? '☆' : '✨'}</div>
          <p>
            {favOnly && pool.length === 0
              ? 'No favorites yet — hit the ☆ star on any show card.'
              : EMPTY_HINTS[tab]}
          </p>
        </div>
      ) : (
        <div className="myshows-list stagger">
          {visible.map((s) => (
            <ShowCard key={s.snapshot.id} show={s} />
          ))}
        </div>
      )}
    </div>
  )
}
