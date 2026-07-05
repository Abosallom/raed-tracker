// Shared UI building blocks used across all pages.

import { useState } from 'react'
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
  // Track which src has finished loading so the real image fades in
  // (and re-fades if the src ever changes for a reused component).
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const url = posterUrl(path)
  if (!url) return <div className="poster-fallback">{title}</div>
  const loaded = loadedSrc === url
  return (
    <img
      ref={(img) => {
        // Cached images can complete before onLoad is attached.
        if (img && img.complete && img.naturalWidth > 0) setLoadedSrc(url)
      }}
      className="poster-img"
      src={url}
      alt={title}
      loading="lazy"
      onLoad={() => setLoadedSrc(url)}
      style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.35s ease' }}
    />
  )
}

export function PosterCard({
  item,
  subtitle,
}: {
  item: SearchResult
  subtitle?: string
}) {
  const [hover, setHover] = useState(false)
  const year = (item.first_air_date ?? item.release_date ?? '').slice(0, 4)
  return (
    <Link
      className="poster-card"
      to={item.media_type === 'tv' ? `/show/${item.id}` : `/movie/${item.id}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        transform: hover ? 'translateY(-4px) scale(1.025)' : 'translateY(0) scale(1)',
        transition: 'transform 0.18s cubic-bezier(0.2, 0.7, 0.3, 1.05)',
        zIndex: hover ? 2 : 'auto',
      }}
    >
      <div
        style={{
          position: 'relative',
          borderRadius: 'var(--radius-sm)',
          boxShadow: hover
            ? '0 14px 28px rgba(0, 0, 0, 0.5)'
            : '0 0 0 rgba(0, 0, 0, 0)',
          transition: 'box-shadow 0.18s ease',
        }}
      >
        <PosterImage path={item.poster_path} title={item.name} />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 8,
            bottom: 8,
            padding: '3px 8px',
            borderRadius: 6,
            background: 'rgba(14, 15, 23, 0.85)',
            color: 'var(--accent)',
            fontSize: 11,
            fontWeight: 700,
            opacity: hover ? 1 : 0,
            transition: 'opacity 0.18s ease',
            pointerEvents: 'none',
          }}
        >
          View →
        </span>
      </div>
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

// ---------- Skeletons ----------

function SkeletonPosterBlock() {
  return (
    <div>
      <div className="skeleton skeleton-poster" />
      <div className="skeleton skeleton-line" style={{ width: '85%' }} />
      <div className="skeleton skeleton-line" style={{ width: '55%' }} />
    </div>
  )
}

export function SkeletonRow({ count = 6 }: { count?: number }) {
  return (
    <div className="media-row" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonPosterBlock key={i} />
      ))}
    </div>
  )
}

export function SkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="poster-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonPosterBlock key={i} />
      ))}
    </div>
  )
}

export function SkeletonDetail() {
  return (
    <div aria-hidden="true">
      {/* Backdrop bar */}
      <div
        className="skeleton"
        style={{ height: 200, borderRadius: 'var(--radius)' }}
      />
      {/* Poster + text lines */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          alignItems: 'flex-start',
          marginTop: -48,
          padding: '0 24px',
        }}
      >
        <div
          className="skeleton skeleton-poster"
          style={{ width: 150, flex: '0 0 150px' }}
        />
        <div style={{ flex: 1, paddingTop: 64 }}>
          <div
            className="skeleton skeleton-line"
            style={{ height: 24, width: '45%', marginTop: 0 }}
          />
          <div
            className="skeleton skeleton-line"
            style={{ width: '30%', marginTop: 14 }}
          />
          <div className="skeleton skeleton-line" style={{ width: '90%', marginTop: 22 }} />
          <div className="skeleton skeleton-line" style={{ width: '85%' }} />
          <div className="skeleton skeleton-line" style={{ width: '60%' }} />
        </div>
      </div>
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
    <div
      className={`reaction-picker${compact ? ' reaction-picker-compact' : ''}`}
      style={{ display: 'flex', gap: 4 }}
    >
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
    <div
      role="status"
      aria-label="Loading"
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 7,
        padding: 60,
      }}
    >
      <style>{`
        @keyframes rt-dot-pulse {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        .rt-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--text-dim);
          animation: rt-dot-pulse 1.2s ease-in-out infinite;
        }
        .rt-dot:nth-of-type(2) { animation-delay: 0.18s; }
        .rt-dot:nth-of-type(3) { animation-delay: 0.36s; }
        @media (prefers-reduced-motion: reduce) {
          .rt-dot { animation: none; opacity: 0.5; }
        }
      `}</style>
      <span className="rt-dot" />
      <span className="rt-dot" />
      <span className="rt-dot" />
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
