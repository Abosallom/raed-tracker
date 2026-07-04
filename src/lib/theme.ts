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
}
