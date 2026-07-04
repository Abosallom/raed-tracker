// Upcoming page — air dates for followed shows + upcoming movies.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { EpisodeSummary, SearchResult } from '../types'
import { getShowDetail, isDemoMode, upcomingMovies } from '../api/tmdb'
import { MOCK_SHOWS } from '../api/mockData'
import { useLibrary } from '../store/library'
import { ErrorBox, LoadingSpinner, MediaRow, PosterImage } from '../components/shared'
import './upcoming.css'

interface UpcomingEntry {
  showId: number
  showName: string
  poster_path: string | null
  episode: EpisodeSummary
  airDate: string // ISO yyyy-mm-dd (non-null, validated)
  days: number // days from today (0 = today)
  sample: boolean
}

// ---------- date helpers ----------

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

function daysUntil(iso: string): number {
  const target = parseIsoDate(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

function formatAirDate(iso: string): string {
  const date = parseIsoDate(iso)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

function countdownLabel(days: number): string {
  if (days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `in ${days} days`
}

function epCode(ep: EpisodeSummary): string {
  const s = String(ep.season_number).padStart(2, '0')
  const e = String(ep.episode_number).padStart(2, '0')
  return `S${s}E${e}`
}

// ---------- row ----------

function EpisodeRow({ entry }: { entry: UpcomingEntry }) {
  return (
    <div className="upcoming-row">
      <Link className="upcoming-poster" to={`/show/${entry.showId}`}>
        <PosterImage path={entry.poster_path} title={entry.showName} />
      </Link>
      <div className="upcoming-info">
        <Link className="upcoming-show" to={`/show/${entry.showId}`}>
          {entry.showName}
        </Link>
        <div className="upcoming-ep">
          <span className="upcoming-code">{epCode(entry.episode)}</span>
          {' — '}
          {entry.episode.name}
        </div>
      </div>
      <div className="upcoming-when">
        {entry.sample && <span className="chip upcoming-sample">sample</span>}
        <span className="upcoming-date">{formatAirDate(entry.airDate)}</span>
        <span className={`chip upcoming-days${entry.days <= 0 ? ' today' : ''}`}>
          {countdownLabel(entry.days)}
        </span>
      </div>
    </div>
  )
}

// ---------- page ----------

export default function Upcoming() {
  const shows = useLibrary((s) => s.shows)
  const followedIds = useMemo(() => Object.keys(shows).map(Number), [shows])
  const demo = isDemoMode()

  const [entries, setEntries] = useState<UpcomingEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [movies, setMovies] = useState<SearchResult[] | null>(null)
  const [moviesError, setMoviesError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setEntries(null)
      setError(null)
      try {
        const results = await Promise.all(
          followedIds.map((id) => getShowDetail(id).catch(() => null)),
        )
        const collected: UpcomingEntry[] = []
        for (const detail of results) {
          if (!detail) continue
          const ep = detail.next_episode_to_air
          if (ep && ep.air_date) {
            collected.push({
              showId: detail.id,
              showName: detail.name,
              poster_path: detail.poster_path,
              episode: ep,
              airDate: ep.air_date,
              days: daysUntil(ep.air_date),
              sample: false,
            })
          }
        }
        // Demo mode: also surface sample shows so the page has life.
        if (isDemoMode()) {
          const followed = new Set(followedIds)
          for (const s of MOCK_SHOWS) {
            if (followed.has(s.id)) continue
            const ep = s.next_episode_to_air
            if (ep && ep.air_date) {
              collected.push({
                showId: s.id,
                showName: s.name,
                poster_path: s.poster_path,
                episode: ep,
                airDate: ep.air_date,
                days: daysUntil(ep.air_date),
                sample: true,
              })
            }
          }
        }
        collected.sort((a, b) => a.airDate.localeCompare(b.airDate))
        if (!cancelled) setEntries(collected)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load upcoming episodes.')
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [followedIds])

  useEffect(() => {
    let cancelled = false
    upcomingMovies()
      .then((m) => {
        if (!cancelled) setMovies(m)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setMoviesError(e instanceof Error ? e.message : 'Failed to load upcoming movies.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const groups = useMemo(() => {
    if (!entries) return []
    const today: UpcomingEntry[] = []
    const week: UpcomingEntry[] = []
    const later: UpcomingEntry[] = []
    for (const e of entries) {
      if (e.days <= 0) today.push(e)
      else if (e.days <= 7) week.push(e)
      else later.push(e)
    }
    return [
      { label: 'Today', icon: '🔴', items: today },
      { label: 'This week', icon: '📅', items: week },
      { label: 'Later', icon: '🗓️', items: later },
    ].filter((g) => g.items.length > 0)
  }, [entries])

  const showEmptyState = !demo && followedIds.length === 0

  return (
    <div>
      <h1 className="page-title">Upcoming</h1>
      <p className="page-subtitle">
        Air dates for the shows you follow{demo ? ' — plus sample shows in demo mode' : ''}.
      </p>

      {showEmptyState ? (
        <div className="empty-state card">
          <div className="big">📡</div>
          <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text)', marginBottom: 6 }}>
            Nothing on the calendar yet
          </div>
          <p style={{ maxWidth: 420, margin: '0 auto' }}>
            When you follow shows, their upcoming episodes appear here so you never miss an air
            date. Find something to track and hit follow.
          </p>
          <div style={{ marginTop: 18, display: 'flex', gap: 10, justifyContent: 'center' }}>
            <Link className="btn primary" to="/search">
              Search shows
            </Link>
            <Link className="btn" to="/">
              Browse trending
            </Link>
          </div>
        </div>
      ) : error ? (
        <ErrorBox message={error} />
      ) : entries === null ? (
        <LoadingSpinner />
      ) : entries.length === 0 ? (
        <div className="card upcoming-caughtup">
          <div style={{ fontSize: 28, marginBottom: 8 }}>🎉</div>
          You’re all caught up — none of your followed shows have a scheduled episode.
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.label}>
            <h2 className="upcoming-group-title">
              <span aria-hidden="true">{g.icon}</span>
              {g.label}
              <span className="upcoming-group-count">{g.items.length}</span>
            </h2>
            <div className="upcoming-list">
              {g.items.map((e) => (
                <EpisodeRow key={`${e.showId}:${e.episode.id}`} entry={e} />
              ))}
            </div>
          </section>
        ))
      )}

      <h2 className="section-title" style={{ marginTop: 36 }}>
        In theaters / upcoming movies
      </h2>
      {moviesError ? (
        <ErrorBox message={moviesError} />
      ) : movies === null ? (
        <LoadingSpinner />
      ) : movies.length === 0 ? (
        <p style={{ color: 'var(--text-dim)' }}>No upcoming movies found.</p>
      ) : (
        <MediaRow items={movies} />
      )}
    </div>
  )
}
