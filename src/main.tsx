import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './styles/global.css'
import App from './App'
import { initSync } from './store/sync'
import { initInstallUx } from './lib/install'
import { applyTheme } from './lib/theme'
import { initPwa } from './lib/pwa'

// First paint gets the right theme; re-apply if the OS scheme changes.
applyTheme()
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme)

initSync()

// Service worker only in production WEB builds — it would fight Vite's dev
// server, and inside the Capacitor native shell (which serves local files and
// injects window.Capacitor) it would only confuse the update flow.
const isNativeShell = Boolean(
  (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
)
if (import.meta.env.PROD && !isNativeShell) initPwa()
initInstallUx()

// HashRouter (#/shows) instead of BrowserRouter: GitHub Pages is static hosting
// with no URL rewriting, so deep links would otherwise 404 on refresh.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
