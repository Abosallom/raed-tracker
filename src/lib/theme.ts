// Theme preference: 'auto' follows the OS, otherwise force dark/light.

export type ThemePref = 'auto' | 'dark' | 'light'

const KEY = 'raedtracker_theme'

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY)
  return v === 'dark' || v === 'light' ? v : 'auto'
}

export function setThemePref(pref: ThemePref) {
  localStorage.setItem(KEY, pref)
  applyTheme()
}

export function applyTheme() {
  const pref = getThemePref()
  const light =
    pref === 'light' ||
    (pref === 'auto' && window.matchMedia('(prefers-color-scheme: light)').matches)
  document.documentElement.dataset.theme = light ? 'light' : 'dark'

  // Keep the browser/status-bar chrome in sync with the app theme so the
  // installed PWA reads as native (values match --bg in global.css).
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = light ? '#f6f6f4' : '#000000'
}
