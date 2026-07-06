// Tiny global toast system: call showToast('Marked S01E02 watched ✓') from
// anywhere; <Toaster /> (mounted once in App) renders the stack.

import { useEffect, useState } from 'react'
import './toast.css'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  message: string
  emoji?: string
  action?: ToastAction
}

type Listener = (toasts: Toast[]) => void

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l([...toasts])
}

export function showToast(message: string, emoji?: string, action?: ToastAction) {
  const id = nextId++
  toasts = [...toasts, { id, message, emoji, action }].slice(-3) // max 3 stacked
  emit()
  // Actionable toasts stay longer — the user needs time to tap Undo.
  setTimeout(
    () => {
      toasts = toasts.filter((t) => t.id !== id)
      emit()
    },
    action ? 5000 : 2600,
  )
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([])
  useEffect(() => {
    const l: Listener = (t) => setItems(t)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  // Toasts are the app's only confirmation channel, so they must be announced
  // to screen readers. The live region has to be MOUNTED PERSISTENTLY (not
  // conditionally rendered) — assistive tech only announces content inserted
  // into an existing live region. Container is pointer-events: none in CSS.
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          {t.emoji && <span className="toast-emoji">{t.emoji}</span>}
          {t.message}
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action?.onClick()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
