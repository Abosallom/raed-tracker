// First-visit "Moving from TV Time?" prompt — points brand-new users at the
// /migrate guide. Store-guideline etiquette: non-blocking (a card, not a
// modal wall), dismissible in one tap, the "don't show again" choice is
// persisted, and it never appears once the user has a real library or a
// completed import (raedtracker_imported, set by the Migrate flow).

import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useLibrary } from '../store/library'
import './migrate-prompt.css'

const DISMISS_KEY = 'raedtracker_migrate_prompt' // 'off' = never show again
export const IMPORTED_KEY = 'raedtracker_imported' // '1' once an import completed

/** A library this size means they're already set up (imported or hand-built). */
const LIBRARY_THRESHOLD = 5

export default function MigratePrompt() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [dontShow, setDontShow] = useState(false)

  // Decide ONCE on mount, after a beat so the app paints first. Store reads
  // go through getState() — subscribing would yank the card away mid-read the
  // moment the user tracks something.
  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) === 'off') return
      if (localStorage.getItem(IMPORTED_KEY) === '1') return
    } catch {
      return // storage unavailable — never nag
    }
    const { shows, movies } = useLibrary.getState()
    if (Object.keys(shows).length + Object.keys(movies).length >= LIBRARY_THRESHOLD) return
    const t = window.setTimeout(() => setOpen(true), 1200)
    return () => window.clearTimeout(t)
  }, [])

  if (!open || pathname === '/migrate') return null

  const close = () => {
    if (dontShow) {
      try {
        localStorage.setItem(DISMISS_KEY, 'off')
      } catch {
        /* choice just won't persist */
      }
    }
    setClosing(true)
    window.setTimeout(() => setOpen(false), 220)
  }

  return (
    <div
      className={`migprompt${closing ? ' closing' : ''}`}
      role="dialog"
      aria-label="Transfer your TV Time history"
    >
      <button className="migprompt-close" onClick={close} aria-label="Close">
        ✕
      </button>
      <div className="migprompt-emoji" aria-hidden="true">
        🚚
      </div>
      <div className="migprompt-body">
        <div className="migprompt-title">Moving from TV Time?</div>
        <p className="migprompt-text">
          See how to transfer your whole watch history — shows, episodes and movies — into this
          app before TV Time shuts down on <b>July 15</b>.
        </p>
        <div className="migprompt-actions">
          <Link className="btn primary" to="/migrate" onClick={close}>
            Show me how
          </Link>
          <button className="btn" onClick={close}>
            Not now
          </button>
        </div>
        <label className="migprompt-check">
          <input
            type="checkbox"
            checked={dontShow}
            onChange={(e) => setDontShow(e.target.checked)}
          />
          Don&apos;t show this again
        </label>
      </div>
    </div>
  )
}
