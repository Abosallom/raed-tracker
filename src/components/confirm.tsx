// Promise-based confirm sheet replacing window.confirm — native-app feel,
// no browser chrome. Usage: if (await confirm({ title, message, danger })) …
// <ConfirmHost /> must be mounted once (App shell).

import { useEffect, useRef, useState } from 'react'
import './confirm.css'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

let listener: ((p: Pending | null) => void) | null = null

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!listener) {
      // Host not mounted (should not happen) — fail safe to native confirm.
      resolve(window.confirm(`${opts.title}${opts.message ? `\n\n${opts.message}` : ''}`))
      return
    }
    listener({ ...opts, resolve })
  })
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null)
  const confirmBtn = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  // Arming delay: the confirm button is auto-focused on open, so a held
  // (auto-repeating) or quickly double-pressed Enter on the trigger button
  // would otherwise land on it and fire the (possibly destructive) action
  // before the user even sees the sheet.
  const armedAt = useRef(0)
  const ARM_DELAY_MS = 350

  useEffect(() => {
    listener = (p) => {
      if (p) restoreFocus.current = document.activeElement as HTMLElement | null
      setPending(p)
    }
    return () => {
      listener = null
    }
  }, [])

  useEffect(() => {
    if (pending) {
      armedAt.current = performance.now()
      confirmBtn.current?.focus()
    } else {
      const el = restoreFocus.current
      if (el?.isConnected) el.focus()
    }
  }, [pending])

  if (!pending) return null

  const finish = (ok: boolean) => {
    pending.resolve(ok)
    setPending(null)
  }

  return (
    <div
      className="confirm-backdrop"
      onClick={() => finish(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') finish(false)
      }}
      role="presentation"
    >
      <div
        className="confirm-sheet"
        role="alertdialog"
        aria-modal="true"
        aria-label={pending.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-title">{pending.title}</div>
        {pending.message && <p className="confirm-message">{pending.message}</p>}
        <div className="confirm-actions">
          <button className="btn" onClick={() => finish(false)}>
            {pending.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={confirmBtn}
            className={`btn ${pending.danger ? 'confirm-danger' : 'primary'}`}
            // Swallow auto-repeated Enter/Space (held key from the trigger).
            onKeyDown={(e) => {
              if (e.repeat) e.preventDefault()
            }}
            onClick={() => {
              if (performance.now() - armedAt.current < ARM_DELAY_MS) return
              finish(true)
            }}
          >
            {pending.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
