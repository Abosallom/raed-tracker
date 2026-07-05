/// <reference types="vite-plugin-pwa/client" />
// Service-worker registration + update flow. Fully self-contained: when a new
// version is waiting, we toast AND mount a slim bottom bar (vanilla DOM,
// appended to document.body) so App.tsx never has to know about it. A tiny
// module store also exposes the update so e.g. a Settings row can trigger it.

import { registerSW } from 'virtual:pwa-register'
import { showToast } from '../components/toast'

type Listener = () => void

let updateFn: ((reloadPage?: boolean) => Promise<void>) | null = null
let updateReady = false
const listeners = new Set<Listener>()

/** True once a new service worker is installed and waiting. */
export function isUpdateReady(): boolean {
  return updateReady
}

/** Subscribe to "an update became ready". Returns an unsubscribe fn. */
export function onUpdateReady(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Activate the waiting service worker and reload. No-op if none waiting. */
export function applyUpdate(): void {
  if (updateFn && updateReady) void updateFn(true)
}

const BAR_ID = 'pwa-update-bar'

function mountUpdateBar() {
  if (document.getElementById(BAR_ID)) return

  const style = document.createElement('style')
  style.textContent = `
#${BAR_ID} {
  position: fixed;
  left: 50%;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: calc(100vw - 24px);
  padding: 10px 12px 10px 16px;
  background: var(--bg-elev-2, #202020);
  color: var(--text, #f2f2f2);
  border: 1px solid var(--border, #2e2e2e);
  border-radius: var(--radius, 12px);
  box-shadow: var(--shadow, 0 8px 28px rgba(0, 0, 0, 0.45));
  font-family: var(--font, system-ui, sans-serif);
  font-size: 14px;
  animation: pwa-bar-in 0.25s ease-out;
}
#${BAR_ID} .pwa-update-msg {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${BAR_ID} button {
  flex-shrink: 0;
  padding: 8px 14px;
  border: none;
  border-radius: var(--radius-sm, 8px);
  background: var(--accent, #fbbf24);
  color: #000;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
#${BAR_ID} button:disabled {
  opacity: 0.6;
  cursor: default;
}
@keyframes pwa-bar-in {
  from { opacity: 0; transform: translateX(-50%) translateY(12px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  #${BAR_ID} { animation: none; }
}
`
  document.head.appendChild(style)

  const bar = document.createElement('div')
  bar.id = BAR_ID
  bar.setAttribute('role', 'status')

  const msg = document.createElement('span')
  msg.className = 'pwa-update-msg'
  msg.textContent = 'A new version is ready'

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = 'Refresh'
  btn.addEventListener('click', () => {
    btn.disabled = true
    btn.textContent = 'Refreshing…'
    applyUpdate()
  })

  bar.append(msg, btn)
  document.body.appendChild(bar)
}

/** Re-check sw.js at most this often (hourly timer + on app resume). */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
const UPDATE_CHECK_MIN_GAP_MS = 60 * 1000

/** Register the service worker. Call once at startup (PROD only). */
export function initPwa(): void {
  const updateSW = registerSW({
    // Installed standalone PWAs (especially iOS) never navigate after launch,
    // so without this the browser only checks sw.js at cold start and a
    // resident app could run a stale bundle for days. Poll hourly and on
    // resume (visibilitychange) so the 'prompt' update flow stays reachable.
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      let lastCheck = Date.now()
      const check = () => {
        lastCheck = Date.now()
        registration.update().catch(() => {
          // Offline or transient network error — next check will retry.
        })
      }
      setInterval(check, UPDATE_CHECK_INTERVAL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return
        if (Date.now() - lastCheck < UPDATE_CHECK_MIN_GAP_MS) return
        check()
      })
    },
    onNeedRefresh() {
      updateReady = true
      showToast('Update ready — tap to refresh', '⬆️')
      mountUpdateBar()
      for (const l of listeners) l()
    },
    onOfflineReady() {
      showToast('Ready to work offline', '📴')
    },
  })
  updateFn = updateSW
}
