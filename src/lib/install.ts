// Install / PWA UX plumbing.
//
// - Captures the `beforeinstallprompt` event (Chrome on Android + desktop)
//   into a tiny module store so any page can offer an Install button later.
// - Standalone + iOS-Safari detection for tailoring install instructions.
// - `initInstallUx()` wires the listeners once and mounts the global
//   <OfflineBanner /> into its own body-appended root (a global concern that
//   must not depend on any lazy route being loaded). Called from main.tsx.

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import OfflineBanner from '../components/OfflineBanner'

/** Chrome's non-standard install prompt event (not in lib.dom). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

// ---------- deferred-prompt module store ----------

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

/** Subscribe to deferred-prompt availability changes (useSyncExternalStore-shaped). */
export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Snapshot: the captured install prompt, or null if none is available. */
export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt
}

/** True when running as an installed app (home screen / desktop window). */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** iOS Safari (incl. iPadOS masquerading as macOS) — install goes via Share sheet. */
export function isIOSSafari(): boolean {
  const ua = navigator.userAgent
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as MacIntel but exposes multi-touch.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  // Other iOS browsers (CriOS/FxiOS/EdgiOS…) can't add to home screen.
  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome/i.test(ua)
  return isIOS && isSafari
}

/** Fire the captured install prompt. The event is single-use, so it is
    cleared afterwards regardless of the user's choice. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const evt = deferredPrompt
  if (!evt) return 'unavailable'
  deferredPrompt = null
  emit()
  try {
    await evt.prompt()
    const choice = await evt.userChoice
    return choice.outcome
  } catch {
    return 'dismissed'
  }
}

// ---------- init (called once from main.tsx) ----------

let initialized = false

export function initInstallUx(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // suppress Chrome's mini-infobar; we prompt on demand
    deferredPrompt = e as BeforeInstallPromptEvent
    emit()
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    emit()
  })

  // Global offline banner: mounted in its own root appended to <body> so it
  // exists on every route without touching the app tree.
  const host = document.createElement('div')
  host.id = 'offline-banner-root'
  document.body.appendChild(host)
  createRoot(host).render(createElement(OfflineBanner))
}
