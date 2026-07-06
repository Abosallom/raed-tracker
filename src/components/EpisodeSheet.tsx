// EpisodeSheet — slide-up bottom sheet shown right after checking an episode.
// Walks the user through sequential steps: pick a favorite cast face, react to
// the episode ("how did it feel?"), then the actions row (pause / discuss /
// done). A 'pause-this' variant opens on a "PAUSE THIS?" hero instead, for
// shows that have gone stale.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { CastMember, Emotion, ShowDetail } from '../types'
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

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// A short-lived "+😍" clone that rises and fades where a chip/emoji was tapped.
interface FloatSpec {
  id: number
  emoji: string
  x: number
  y: number
}

export interface EpisodeSheetProps {
  showId: number
  showName: string
  season: number
  episode: number
  episodeTitle?: string
  variant?: 'default' | 'pause-this'
  onClose: () => void
}

// The default sheet advances cast -> react (the react step also renders the
// actions row); the 'pause-this' variant opens on 'pause' first.
type Step = 'pause' | 'cast' | 'react'

export default function EpisodeSheet({
  showId,
  showName,
  season,
  episode,
  episodeTitle,
  variant = 'default',
  onClose,
}: EpisodeSheetProps) {
  const show = useLibrary((s) => s.shows[showId])
  const setEpisodeEmotion = useLibrary((s) => s.setEpisodeEmotion)
  const setEpisodeFavoriteCast = useLibrary((s) => s.setEpisodeFavoriteCast)
  const togglePauseShow = useLibrary((s) => s.togglePauseShow)
  const reactionPrompt = useLibrary((s) => s.reactionPrompt)

  const [cast, setCast] = useState<CastMember[] | null>(null)
  const [castFailed, setCastFailed] = useState(false)
  const [closing, setClosing] = useState(false)
  const [step, setStep] = useState<Step>(variant === 'pause-this' ? 'pause' : 'cast')
  const [floats, setFloats] = useState<FloatSpec[]>([])
  const floatId = useRef(0)

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

  // Spawn a floating "+<emoji>" that rises ~40px and fades, then self-removes.
  const spawnFloat = useCallback((emoji: string, target: HTMLElement) => {
    if (prefersReducedMotion()) return
    const sheet = target.closest('.epsheet') as HTMLElement | null
    if (!sheet) return
    const tRect = target.getBoundingClientRect()
    const sRect = sheet.getBoundingClientRect()
    const x = tRect.left - sRect.left + tRect.width / 2
    const y = tRect.top - sRect.top
    const id = ++floatId.current
    setFloats((f) => [...f, { id, emoji, x, y }])
  }, [])

  const removeFloat = useCallback((id: number) => {
    setFloats((f) => f.filter((fl) => fl.id !== id))
  }, [])

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

  const pickCast = useCallback(
    (c: CastMember, selected: boolean, el: HTMLElement) => {
      setEpisodeFavoriteCast(
        showId,
        season,
        episode,
        selected ? undefined : { id: c.id, name: c.name },
      )
      showToast(selected ? 'Favorite cleared' : `Favorite: ${c.name}`, selected ? '↩️' : '🏆')
      if (!selected) {
        spawnFloat('🏆', el)
        // Auto-advance to the reaction step after a pick.
        window.setTimeout(() => setStep('react'), prefersReducedMotion() ? 0 : 260)
      }
    },
    [episode, season, setEpisodeFavoriteCast, showId, spawnFloat],
  )

  const reactRowRef = useRef<HTMLDivElement>(null)
  const onReact = useCallback(
    (e: Emotion | undefined) => {
      setEpisodeEmotion(showId, season, episode, e)
      const emoji = e ? EMOTIONS.find((x) => x.key === e)?.emoji : undefined
      showToast(e ? 'Reaction saved' : 'Reaction cleared', emoji ?? '🎭')
      // The ReactionPicker owns the tapped-emoji pop-scale spring; anchor the
      // rising "+emoji" clone on the matching emoji button. We match by title
      // (the picker sets title={label}) rather than aria-pressed, because
      // aria-pressed reflects the *previous* render at this synchronous point.
      if (e && emoji) {
        const row = reactRowRef.current
        const label = EMOTIONS.find((x) => x.key === e)?.label
        const btn =
          (label &&
            row?.querySelector<HTMLElement>(`button[title="${CSS.escape(label)}"]`)) ||
          row
        if (btn) spawnFloat(emoji, btn)
      }
    },
    [episode, season, setEpisodeEmotion, showId, spawnFloat],
  )

  if (!show) return null

  const isPauseHero = step === 'pause'

  return (
    <div className={`epsheet-backdrop${closing ? ' closing' : ''}`} onClick={close}>
      <div
        ref={sheetRef}
        tabIndex={-1}
        className={`epsheet${closing ? ' closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={
          isPauseHero
            ? `Pause ${showName}?`
            : `Episode checked: ${showName} S${pad2(season)}E${pad2(episode)}`
        }
        onClick={(e) => e.stopPropagation()}
      >
        {/* Floating reaction clones (rise + fade), overlaid on the whole sheet. */}
        {floats.map((f) => (
          <span
            key={f.id}
            className="epsheet-float"
            aria-hidden="true"
            style={{ left: f.x, top: f.y }}
            onAnimationEnd={() => removeFloat(f.id)}
          >
            +{f.emoji}
          </span>
        ))}

        <div className="epsheet-grip" aria-hidden="true" />

        {isPauseHero ? (
          <PauseHero
            showName={showName}
            onPause={() => {
              togglePauseShow(showId)
              showToast(`Paused ${showName}`, '⏸️')
              close()
            }}
            onKeep={() => {
              // "Keep watching" continues into the default steps only if the
              // user's reaction-prompt preference allows the deep-react sheet;
              // otherwise it just closes.
              if (reactionPrompt === 'never') {
                close()
                return
              }
              setStep('cast')
            }}
            onClose={close}
          />
        ) : (
          <>
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
              <button
                className="epsheet-close"
                onClick={close}
                aria-label="Close"
                title="Close"
              >
                ✕
              </button>
            </div>

            {step === 'cast' ? (
              <CastStep
                cast={cast}
                castFailed={castFailed}
                selectedId={rec?.favoriteCast?.id}
                onPick={pickCast}
                onSkip={() => setStep('react')}
              />
            ) : (
              <>
                <div className="epsheet-section epsheet-step-in">
                  <div className="epsheet-label">How did it feel?</div>
                  <div ref={reactRowRef}>
                    <ReactionPicker value={rec?.emotion} onChange={onReact} />
                  </div>
                </div>

                <div className="epsheet-actions epsheet-step-in">
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
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ---------- Pause-this hero ----------

function PauseHero({
  showName,
  onPause,
  onKeep,
  onClose,
}: {
  showName: string
  onPause: () => void
  onKeep: () => void
  onClose: () => void
}) {
  return (
    <div className="epsheet-pause">
      <button
        className="epsheet-close epsheet-pause-close"
        onClick={onClose}
        aria-label="Close"
        title="Close"
      >
        ✕
      </button>
      <div className="epsheet-eq" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className="epsheet-eq-bar" style={{ animationDelay: `${i * 0.12}s` }} />
        ))}
      </div>
      <div className="epsheet-pause-headline">PAUSE THIS?</div>
      <div className="epsheet-pause-copy">
        You haven't touched {showName} in a while
      </div>
      <div className="epsheet-pause-actions">
        <button className="btn primary" onClick={onPause}>
          ⏸ Pause it
        </button>
        <button className="btn" onClick={onKeep}>
          Keep watching
        </button>
      </div>
    </div>
  )
}

// ---------- Step 1: favorite cast grid ----------

function CastStep({
  cast,
  castFailed,
  selectedId,
  onPick,
  onSkip,
}: {
  cast: CastMember[] | null
  castFailed: boolean
  selectedId: number | undefined
  onPick: (c: CastMember, selected: boolean, el: HTMLElement) => void
  onSkip: () => void
}) {
  return (
    <div className="epsheet-section epsheet-step-in">
      <div className="epsheet-step-head">
        <div className="epsheet-label">Who was your favorite?</div>
        <button className="epsheet-skip" onClick={onSkip}>
          Skip
        </button>
      </div>

      {castFailed ? (
        <div className="epsheet-cast-note">Cast unavailable right now.</div>
      ) : cast === null ? (
        <div className="epsheet-face-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="epsheet-face" style={{ animationDelay: `${i * 0.04}s` }}>
              <span className="epsheet-face-img epsheet-face-skel" />
              <span className="epsheet-face-name skeleton-line-name" />
            </div>
          ))}
        </div>
      ) : cast.length === 0 ? (
        <div className="epsheet-cast-note">No cast listed for this show.</div>
      ) : (
        <div className="epsheet-face-grid">
          {cast.map((c, i) => {
            const selected = selectedId === c.id
            const img = profileUrl(c.profile_path)
            return (
              <button
                key={c.id}
                className={`epsheet-face epsheet-face-in${selected ? ' selected' : ''}`}
                style={{ animationDelay: `${i * 0.04}s` }}
                aria-pressed={selected}
                title={c.character ? `${c.name} as ${c.character}` : c.name}
                onClick={(e) => onPick(c, selected, e.currentTarget)}
              >
                {img ? (
                  <img className="epsheet-face-img" src={img} alt="" loading="lazy" />
                ) : (
                  <span className="epsheet-face-img epsheet-face-initials">
                    {initials(c.name)}
                  </span>
                )}
                <span className="epsheet-face-name">{c.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
