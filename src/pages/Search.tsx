import { useEffect, useRef, useState } from 'react'
import type { MediaType, SearchResult } from '../types'
import { isDemoMode, searchMulti, trendingShows } from '../api/tmdb'
import { ErrorBox, PosterCard, SkeletonGrid } from '../components/shared'
import './search.css'

type Filter = 'all' | MediaType

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'tv', label: 'Shows' },
  { key: 'movie', label: 'Movies' },
]

// ---------- recent searches (localStorage, best-effort) ----------

const RECENT_KEY = 'showtrackr_recent_searches'
const RECENT_MAX = 6

function loadRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX)
      : []
  } catch {
    return []
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* storage is best-effort */
  }
}

export default function Search() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [trending, setTrending] = useState<SearchResult[]>([])
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = query.trim()

  /** Remember a successful search; newer entries first, prefixes collapsed. */
  const rememberSearch = (term: string) => {
    setRecent((prev) => {
      const lower = term.toLowerCase()
      // Drop exact duplicates and shorter prefixes typed on the way here
      // ("bre" → "break" keeps only "break").
      const kept = prev.filter((r) => {
        const rl = r.toLowerCase()
        return rl !== lower && !lower.startsWith(rl)
      })
      const next = [term, ...kept].slice(0, RECENT_MAX)
      saveRecent(next)
      return next
    })
  }

  const clearRecent = () => {
    setRecent([])
    saveRecent([])
  }

  // Idle-state suggestions ("Popular right now")
  useEffect(() => {
    let cancelled = false
    trendingShows()
      .then((r) => {
        if (!cancelled) setTrending(r.slice(0, 8))
      })
      .catch(() => {
        /* suggestions are best-effort */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Debounced search (300ms)
  useEffect(() => {
    if (!q) {
      setResults([])
      setSearching(false)
      setError(null)
      return
    }
    setSearching(true)
    setError(null)
    let cancelled = false
    const timer = setTimeout(() => {
      searchMulti(q)
        .then((r) => {
          if (cancelled) return
          setResults(r)
          setSearching(false)
          if (r.length > 0) rememberSearch(q)
        })
        .catch((e: unknown) => {
          if (cancelled) return
          setError(e instanceof Error ? e.message : 'Search failed — try again.')
          setSearching(false)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [q])

  const showCount = results.filter((r) => r.media_type === 'tv').length
  const movieCount = results.length - showCount
  const countFor = (f: Filter) =>
    f === 'all' ? results.length : f === 'tv' ? showCount : movieCount
  const filtered =
    filter === 'all' ? results : results.filter((r) => r.media_type === filter)

  return (
    <div>
      <h1 className="page-title">Search</h1>
      <p className="page-subtitle">Find shows and movies to track.</p>

      <div className="search-box">
        <span className="search-icon">🔍</span>
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search shows and movies…"
          autoFocus
          spellCheck={false}
        />
        {query && (
          <button
            className="search-clear"
            title="Clear search"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
          >
            ✕
          </button>
        )}
      </div>

      {!q ? (
        <>
          <p className="search-hint">
            Type a title above — results appear as you type. Try{' '}
            {isDemoMode() ? <>“ashfall” or “starlight”</> : <>“breaking” or “office”</>}.
          </p>
          {recent.length > 0 && (
            <div className="search-recent fade-in">
              <span className="search-recent-label">Recent</span>
              {recent.map((r) => (
                <button
                  key={r}
                  className="search-chip"
                  title={`Search “${r}” again`}
                  onClick={() => {
                    setQuery(r)
                    inputRef.current?.focus()
                  }}
                >
                  {r}
                </button>
              ))}
              <button
                className="search-recent-clear"
                title="Clear recent searches"
                onClick={clearRecent}
              >
                Clear
              </button>
            </div>
          )}
          {trending.length > 0 && (
            <>
              <h2 className="section-title">Popular right now</h2>
              <div className="poster-grid stagger">
                {trending.map((it) => (
                  <PosterCard key={`${it.media_type}:${it.id}`} item={it} />
                ))}
              </div>
            </>
          )}
        </>
      ) : searching ? (
        <SkeletonGrid />
      ) : error ? (
        <ErrorBox message={error} />
      ) : results.length === 0 ? (
        <div className="empty-state">
          <div className="big">🕵️</div>
          <p>
            No results for <b>“{q}”</b>.
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 6 }}>
            Check the spelling or try a shorter search.
          </p>
        </div>
      ) : (
        <>
          <div className="search-filters">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`search-chip${filter === f.key ? ' active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="search-chip-count">{countFor(f.key)}</span>
              </button>
            ))}
            <span className="search-count fade-in" key={`${filter}|${q}`}>
              <b>{filtered.length}</b> result{filtered.length === 1 ? '' : 's'} for
              “{q}”
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state">
              <div className="big">
                {filter === 'tv' ? '📺' : '🎬'}
              </div>
              <p>
                No {filter === 'tv' ? 'shows' : 'movies'} match “{q}” — try
                another filter.
              </p>
            </div>
          ) : (
            <div className="poster-grid stagger">
              {filtered.map((it) => (
                <PosterCard key={`${it.media_type}:${it.id}`} item={it} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
