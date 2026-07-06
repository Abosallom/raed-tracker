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

/** How long to wait for the new service worker to take control. */
const APPLY_TIMEOUT_MS = 8000

/**
 * Activate the waiting service worker and reload once it takes control.
 * Resolves 'reloading' when the reload has been scheduled, 'timeout' when the
 * worker didn't take over in time (caller should ask for a manual reload),
 * 'noop' when no update is waiting.
 *
 * The reload cannot be left to the plugin: vite-plugin-pwa's prompt-mode
 * helper ignores its reloadPage argument and only reloads from its own
 * 'controlling' listener when the event has isUpdate=true — workers found by
 * our registration.update() polling can surface as external updates, which
 * never reload and left the bar stuck on "Refreshing…".
 */
export function applyUpdate(): Promise<'reloading' | 'timeout' | 'noop'> {
  const update = updateFn
  if (!update || !updateReady) return Promise.resolve('noop')
  return new Promise((resolve) => {
    let settled = false
    // Reload even on a takeover AFTER the timeout: SKIP_WAITING was already
    // sent, so a late activation leaves this page running old hashed chunks
    // the new worker's precache no longer serves — reloading is always the
    // right outcome once the new worker controls the page. `settled` only
    // guards the promise, never the reload; {once} guards re-entry.
    const onTakeover = () => {
      if (!settled) {
        settled = true
        resolve('reloading')
      }
      window.location.reload()
    }
    navigator.serviceWorker?.addEventListener('controllerchange', onTakeover, { once: true })
    void update(true)
    window.setTimeout(() => {
      if (settled) return
      settled = true
      resolve('timeout')
    }, APPLY_TIMEOUT_MS)
  })
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
    void applyUpdate().then((result) => {
      if (result === 'reloading') return
      // 'timeout' or 'noop': never leave the button dead at "Refreshing…".
      btn.disabled = false
      btn.textContent = 'Refresh'
      msg.textContent = 'Update didn’t apply — reload the page'
      showToast('Could not auto-refresh — please reload the page', '⚠️')
    })
  })

  bar.append(msg, btn)
  document.body.appendChild(bar)
}

/** Re-check sw.js at most this often (hourly timer + on app resume). */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
const UPDATE_CHECK_MIN_GAP_MS = 60 * 1000

/** Updates found within this window of module load auto-apply (launch feel). */
const AUTO_APPLY_WINDOW_MS = 4000
const LAUNCH_AT = Date.now()

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
      for (const l of listeners) l()
      // An update discovered AT LAUNCH (a worker left waiting from a previous
      // visit, or found by the initial check) applies itself silently — it
      // just reads as a slightly longer app start. Users were living on
      // stale bundles for days because the bar's Refresh never got tapped.
      // Mid-session discoveries keep the polite prompt; if the silent apply
      // times out, fall back to the prompt too.
      if (Date.now() - LAUNCH_AT < AUTO_APPLY_WINDOW_MS) {
        void applyUpdate().then((result) => {
          if (result === 'reloading') return
          showToast('Update ready — tap to refresh', '⬆️')
          mountUpdateBar()
        })
        return
      }
      showToast('Update ready — tap to refresh', '⬆️')
      mountUpdateBar()
    },
    onOfflineReady() {
      showToast('Ready to work offline', '📴')
    },
  })
  updateFn = updateSW
}
