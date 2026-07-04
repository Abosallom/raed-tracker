// Shared UI building blocks used across all pages.

import { Link } from 'react-router-dom'
import type { Emotion, SearchResult } from '../types'
import { EMOTIONS } from '../types'
import { posterUrl } from '../api/tmdb'

// ---------- Poster ----------

export function PosterImage({
  path,
  title,
}: {
  path: string | null
  title: string
}) {
  const url = posterUrl(path)
  if (url) return <img className="poster-img" src={url} alt={title} loading="lazy" />
  return <div className="poster-fallback">{title}</div>
}

export function PosterCard({
  item,
  subtitle,
}: {
  item: SearchResult
  subtitle?: string
}) {
  const year = (item.first_air_date ?? item.release_date ?? '').slice(0, 4)
  return (
    <Link
      className="poster-card"
      to={item.media_type === 'tv' ? `/show/${item.id}` : `/movie/${item.id}`}
    >
      <PosterImage path={item.poster_path} title={item.name} />
      {item.vote_average > 0 && (
        <div className="poster-badge">★ {item.vote_average.toFixed(1)}</div>
      )}
      <div className="poster-title">{item.name}</div>
      <div className="poster-sub">
        {subtitle ?? [year, item.media_type === 'tv' ? 'Show' : 'Movie'].filter(Boolean).join(' · ')}
      </div>
    </Link>
  )
}

export function MediaRow({ items }: { items: SearchResult[] }) {
  return (
    <div className="media-row">
      {items.map((it) => (
        <PosterCard key={`${it.media_type}:${it.id}`} item={it} />
      ))}
    </div>
  )
}

// ---------- Progress ----------

export function ProgressBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  return (
    <div className="progress-track">
      <div className={`progress-fill${pct >= 100 ? ' done' : ''}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// ---------- Emotion reactions (TV Time-style "how did it make you feel") ----------

export function ReactionPicker({
  value,
  onChange,
  compact,
}: {
  value: Emotion | undefined
  onChange: (e: Emotion | undefined) => void
  compact?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {EMOTIONS.map((e) => (
        <button
          key={e.key}
          title={e.label}
          onClick={(ev) => {
            ev.preventDefault()
            ev.stopPropagation()
            onChange(value === e.key ? undefined : e.key)
          }}
          style={{
            fontSize: compact ? 15 : 20,
            padding: compact ? '2px 4px' : '4px 6px',
            borderRadius: 8,
            background: value === e.key ? 'var(--accent-soft)' : 'transparent',
            border: value === e.key ? '1px solid var(--accent)' : '1px solid transparent',
            opacity: value && value !== e.key ? 0.45 : 1,
            transition: 'all .12s',
          }}
        >
          {e.emoji}
        </button>
      ))}
    </div>
  )
}

// ---------- Misc ----------

export function Rating({ value }: { value: number }) {
  if (!value) return null
  return (
    <span className="chip" style={{ color: 'var(--yellow)' }}>
      ★ {value.toFixed(1)}
    </span>
  )
}

export function LoadingSpinner() {
  return (
    <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>
      Loading…
    </div>
  )
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div
      className="card"
      style={{ borderColor: 'rgba(248,113,113,.4)', color: 'var(--red)', margin: '20px 0' }}
    >
      {message}
    </div>
  )
}

export function formatMinutes(min: number): string {
  const days = Math.floor(min / 1440)
  const hours = Math.floor((min % 1440) / 60)
  const mins = Math.round(min % 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
