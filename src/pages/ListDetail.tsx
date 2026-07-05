// List detail page — rename/delete a custom list, browse its items and add
// new shows/movies via a debounced search (works in demo mode too).

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ListItem, SearchResult } from '../types'
import { useLibrary } from '../store/library'
import { posterUrl, searchMulti } from '../api/tmdb'
import { ErrorBox, LoadingSpinner, PosterImage, timeAgo } from '../components/shared'
import { BackBar } from '../components/BackBar'
import { showToast } from '../components/toast'
import './list-detail.css'

const RESULT_CAP = 8
const CACHE_CAP = 100

/** Module-level search cache so retyping the same query never refetches. */
const searchCache = new Map<string, SearchResult[]>()

/** Tiny poster thumbnail for search result rows; letter tile in demo mode. */
function ResultThumb({ path, title }: { path: string | null; title: string }) {
  const url = posterUrl(path, 'w185')
  if (!url) {
    return (
      <div className="listd-result-thumb fallback" aria-hidden="true">
        {title.slice(0, 1).toUpperCase()}
      </div>
    )
  }
  return <img className="listd-result-thumb" src={url} alt="" loading="lazy" />
}

export default function ListDetail() {
  const { id } = useParams<{ id: string }>()
  const lists = useLibrary((s) => s.lists)
  const renameList = useLibrary((s) => s.renameList)
  const deleteList = useLibrary((s) => s.deleteList)
  const toggleListItem = useLibrary((s) => s.toggleListItem)
  const navigate = useNavigate()

  const list = lists.find((l) => l.id === id)

  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Debounced, cached, capped search.
  useEffect(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      setResults([])
      setSearching(false)
      setSearchError(null)
      return
    }
    const cached = searchCache.get(q)
    if (cached) {
      setResults(cached)
      setSearching(false)
      setSearchError(null)
      return
    }
    setSearching(true)
    setSearchError(null)
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = (await searchMulti(query.trim())).slice(0, RESULT_CAP)
        if (searchCache.size >= CACHE_CAP) searchCache.clear()
        searchCache.set(q, res)
        if (!cancelled) setResults(res)
      } catch (e) {
        if (!cancelled) setSearchError(e instanceof Error ? e.message : 'Search failed')
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  if (!list) {
    return (
      <div className="fade-in">
        <BackBar />
        <ErrorBox message="List not found — it may have been deleted." />
        <Link className="btn" to="/profile">
          ← Back to profile
        </Link>
      </div>
    )
  }

  const startEditingName = () => {
    setNameDraft(list.name)
    setEditingName(true)
  }

  const saveName = () => {
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== list.name) {
      renameList(list.id, trimmed)
      showToast(`List renamed to “${trimmed}”`, '✏️')
    }
    setEditingName(false)
  }

  const onDelete = () => {
    if (!window.confirm(`Delete the list “${list.name}”? This cannot be undone.`)) return
    deleteList(list.id)
    showToast(`List “${list.name}” deleted`, '🗑️')
    navigate('/profile')
  }

  const inList = (r: SearchResult) =>
    list.items.some((i) => i.type === r.media_type && i.id === r.id)

  const toggleResult = (r: SearchResult) => {
    const wasIn = inList(r)
    toggleListItem(list.id, {
      type: r.media_type,
      id: r.id,
      name: r.name,
      poster_path: r.poster_path,
    })
    showToast(
      wasIn ? `Removed “${r.name}” from ${list.name}` : `Added “${r.name}” to ${list.name}`,
      wasIn ? '➖' : '➕',
    )
  }

  const removeItem = (it: ListItem) => {
    toggleListItem(list.id, {
      type: it.type,
      id: it.id,
      name: it.name,
      poster_path: it.poster_path,
    })
    showToast(`Removed “${it.name}” from ${list.name}`, '🗑️')
  }

  const trimmedQuery = query.trim()

  return (
    <div>
      <BackBar />
      {/* ---------- header ---------- */}
      <div className="fade-in">
        <div className="listd-title-row">
          {editingName ? (
            <div className="listd-title-edit">
              <input
                className="listd-title-input"
                value={nameDraft}
                autoFocus
                maxLength={48}
                placeholder="List name"
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
            </div>
          ) : (
            <button className="listd-title" title="Rename list" onClick={startEditingName}>
              <span className="page-title listd-title-text">📃 {list.name}</span>
              <span className="listd-edit-hint" aria-hidden="true">
                ✏️
              </span>
            </button>
          )}
          <button className="btn danger small" onClick={onDelete}>
            🗑️ Delete list
          </button>
        </div>
        <p className="page-subtitle">
          {list.items.length} {list.items.length === 1 ? 'item' : 'items'} · created{' '}
          {timeAgo(list.createdAt)}
        </p>
      </div>

      {/* ---------- items ---------- */}
      {list.items.length === 0 ? (
        <div className="empty-state card fade-in">
          <div className="big">🍿</div>
          This list is empty — search below to add shows and movies.
        </div>
      ) : (
        <div className="poster-grid stagger">
          {list.items.map((it) => (
            <div key={`${it.type}:${it.id}`} className="listd-item">
              <Link
                className="poster-card"
                to={it.type === 'tv' ? `/show/${it.id}` : `/movie/${it.id}`}
              >
                <PosterImage path={it.poster_path} title={it.name} />
                <div className="poster-title">{it.name}</div>
                <div className="poster-sub">
                  {it.type === 'tv' ? 'Show' : 'Movie'} · added {timeAgo(it.addedAt)}
                </div>
              </Link>
              <button
                className="listd-remove"
                title={`Remove ${it.name} from list`}
                onClick={() => removeItem(it)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ---------- add to list ---------- */}
      <h2 className="section-title">
        <span>➕ Add to this list</span>
      </h2>
      <div className="card listd-add fade-in">
        <input
          className="listd-search"
          value={query}
          placeholder="Search shows & movies…"
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && <LoadingSpinner />}
        {!searching && searchError && <ErrorBox message={searchError} />}
        {!searching && !searchError && trimmedQuery && results.length === 0 && (
          <div className="listd-noresults">No results for “{trimmedQuery}”.</div>
        )}
        {!searching && !searchError && results.length > 0 && (
          <div className="listd-results">
            {results.map((r) => {
              const added = inList(r)
              const year = (r.first_air_date ?? r.release_date ?? '').slice(0, 4)
              return (
                <div key={`${r.media_type}:${r.id}`} className="listd-result">
                  <ResultThumb path={r.poster_path} title={r.name} />
                  <Link
                    className="listd-result-info"
                    to={r.media_type === 'tv' ? `/show/${r.id}` : `/movie/${r.id}`}
                  >
                    <span className="listd-result-name">{r.name}</span>
                    <span className="listd-result-sub">
                      {[year, r.media_type === 'tv' ? 'Show' : 'Movie']
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </Link>
                  <button
                    className={`btn small${added ? '' : ' primary'}`}
                    onClick={() => toggleResult(r)}
                  >
                    {added ? '✓ Added' : '+ Add'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
