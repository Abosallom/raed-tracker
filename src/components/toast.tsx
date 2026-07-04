// Tiny global toast system: call showToast('Marked S01E02 watched ✓') from
// anywhere; <Toaster /> (mounted once in App) renders the stack.

import { useEffect, useState } from 'react'
import './toast.css'

export interface Toast {
  id: number
  message: string
  emoji?: string
}

type Listener = (toasts: Toast[]) => void

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l([...toasts])
}

export function showToast(message: string, emoji?: string) {
  const id = nextId++
  toasts = [...toasts, { id, message, emoji }].slice(-3) // max 3 stacked
  emit()
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    emit()
  }, 2600)
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
  if (items.length === 0) return null
  return (
    <div className="toaster">
      {items.map((t) => (
        <div key={t.id} className="toast">
          {t.emoji && <span className="toast-emoji">{t.emoji}</span>}
          {t.message}
        </div>
      ))}
    </div>
  )
}
