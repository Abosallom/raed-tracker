// EpisodeSheet — slide-up bottom sheet shown right after checking an episode.
// Lets the user react ("How did it feel?"), vote a favorite cast member,
// pause the show, or jump to the discussion on the show page.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { CastMember, ShowDetail } from '../types'
import { EMOTIONS, episodeKey } from '../types'
import { getShowDetail, profileUrl } from '../api/tmdb'
import { ReactionPicker } from './shared'
import { showToast } from './toast'
import { useLibrary } from '../store/library'
import './episodesheet.css'

// Module-level cache so repeated sheet opens never refetch show credits.
const detailCache = new Map<number, Promise<ShowDetail>>()

function fetchDetail(id: number): Promise<ShowDetail> {
  let p = detailCache.get(id)
  if (!p) {
    p = getShowDetail(id).catch((err) => {
      detailCache.delete(id) // don't cache failures
      throw err
    })
    detailCache.set(id, p)
  }
  return p
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export interface EpisodeSheetProps {
  showId: number
  showName: string
  season: number
  episode: number
  episodeTitle?: string
  onClose: () => void
}

export default function EpisodeSheet({
  showId,
  showName,
  season,
  episode,
  episodeTitle,
  onClose,
}: EpisodeSheetProps) {
  const show = useLibrary((s) => s.shows[showId])
  const setEpisodeEmotion = useLibrary((s) => s.setEpisodeEmotion)
  const setEpisodeFavoriteCast = useLibrary((s) => s.setEpisodeFavoriteCast)
  const togglePauseShow = useLibrary((s) => s.togglePauseShow)

  const [cast, setCast] = useState<CastMember[] | null>(null)
  const [castFailed, setCastFailed] = useState(false)
  const [closing, setClosing] = useState(false)

  const rec = show?.watched[episodeKey(season, episode)]

  useEffect(() => {
    let alive = true
    fetchDetail(showId)
      .then((d) => {
        if (alive) setCast(d.cast.slice(0, 8))
      })
      .catch(() => {
        if (alive) setCastFailed(true)
      })
    return () => {
      alive = false
    }
  }, [showId])

  // Animate out, then actually unmount.
  const close = useCallback(() => {
    setClosing(true)
    window.setTimeout(onClose, 200)
  }, [onClose])

  // ----- focus management (aria-modal without it strands screen readers on
  // the background — e.g. the queue check button, which now targets the NEXT
  // episode, so pressing Enter again would silently mark it watched) -----
  const sheetRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    sheetRef.current?.focus()
    return () => {
      const el = restoreFocusRef.current
      if (el && el.isConnected) {
        el.focus()
        return
      }
      // The originating element unmounted while the sheet was open (e.g. the
      // queue row left after "caught up" or "Pause this show"): focusing a
      // detached node no-ops and strands keyboard focus on <body>. Land on
      // the main content instead so Tab resumes from the page, not the top
      // of the document.
      const main = document.querySelector<HTMLElement>('main.main-content')
      if (main) {
        main.tabIndex = -1
        main.focus()
      }
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        return
      }
      // Trap Tab inside the sheet while it is open.
      if (e.key !== 'Tab') return
      const sheet = sheetRef.current
      if (!sheet) return
      const focusables = Array.from(
        sheet.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusables.length === 0) {
        e.preventDefault()
        sheet.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      const inside = active instanceof HTMLElement && sheet.contains(active)
      if (!inside) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  if (!show) return null

  return (
    <div className={`epsheet-backdrop${closing ? ' closing' : ''}`} onClick={close}>
      <div
        ref={sheetRef}
        tabIndex={-1}
        className={`epsheet${closing ? ' closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Episode checked: ${showName} S${pad2(season)}E${pad2(episode)}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="epsheet-grip" aria-hidden="true" />
        <div className="epsheet-skiphint">Tap outside to skip</div>

        <div className="epsheet-header">
          <div className="epsheet-check" aria-hidden="true">
            ✓
          </div>
          <div className="epsheet-header-text">
            <div className="epsheet-ep">
              S{pad2(season)} <span className="epsheet-sep">|</span> E{pad2(episode)}
              {episodeTitle ? ` — ${episodeTitle}` : ''}
            </div>
            <div className="epsheet-show">{showName}</div>
          </div>
          <button className="epsheet-close" onClick={close} aria-label="Close" title="Close">
            ✕
          </button>
        </div>

        <div className="epsheet-section">
          <div className="epsheet-label">How did it feel?</div>
          <ReactionPicker
            value={rec?.emotion}
            onChange={(e) => {
              setEpisodeEmotion(showId, season, episode, e)
              const emoji = e ? EMOTIONS.find((x) => x.key === e)?.emoji : undefined
              showToast(e ? 'Reaction saved' : 'Reaction cleared', emoji ?? '🎭')
            }}
          />
        </div>

        <div className="epsheet-section">
          <div className="epsheet-label">Who was your favorite?</div>
          {castFailed ? (
            <div className="epsheet-cast-note">Cast unavailable right now.</div>
          ) : cast === null ? (
            <div className="epsheet-cast" aria-hidden="true">
              {Array.from({ length: 4 }, (_, i) => (
                <span key={i} className="epsheet-cast-chip skeleton-chip">
                  <span className="epsheet-avatar epsheet-initials">…</span>
                  <span className="epsheet-cast-name">Loading</span>
                </span>
              ))}
            </div>
          ) : cast.length === 0 ? (
            <div className="epsheet-cast-note">No cast listed for this show.</div>
          ) : (
            <div className="epsheet-cast">
              {cast.map((c) => {
                const selected = rec?.favoriteCast?.id === c.id
                const img = profileUrl(c.profile_path)
                return (
                  <button
                    key={c.id}
                    className={`epsheet-cast-chip${selected ? ' selected' : ''}`}
                    aria-pressed={selected}
                    title={c.character ? `${c.name} as ${c.character}` : c.name}
                    onClick={() => {
                      setEpisodeFavoriteCast(
                        showId,
                        season,
                        episode,
                        selected ? undefined : { id: c.id, name: c.name },
                      )
                      showToast(
                        selected ? 'Favorite cleared' : `Favorite: ${c.name}`,
                        selected ? '↩️' : '🏆',
                      )
                    }}
                  >
                    {img ? (
                      <img className="epsheet-avatar" src={img} alt="" loading="lazy" />
                    ) : (
                      <span className="epsheet-avatar epsheet-initials">{initials(c.name)}</span>
                    )}
                    <span className="epsheet-cast-name">{c.name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="epsheet-actions">
          <button
            className="btn small"
            onClick={() => {
              togglePauseShow(showId)
              showToast(`Paused ${showName}`, '⏸️')
              close()
            }}
          >
            ⏸ Pause this show
          </button>
          <Link className="btn small" to={`/show/${showId}`} onClick={onClose}>
            💬 Discuss
          </Link>
          <span className="epsheet-flex" />
          <button className="btn primary small" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
