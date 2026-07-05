import { Suspense, lazy, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { isDemoMode } from './api/tmdb'
import { LoadingSpinner } from './components/shared'
import { ConfettiHost } from './components/Confetti'
import { ConfirmHost } from './components/confirm'
import { Toaster } from './components/toast'
import { nextEpisode, useLibrary } from './store/library'
import {
  checkTrendingPulse,
  getFreshnessSnapshot,
  markTrendingSeen,
  refreshFollowedShows,
  subscribeFreshness,
} from './lib/freshness'
import { initAdmin, useAdminGate } from './lib/admin'
import './app-shell.css'

// Route-level code splitting: each page loads on demand so the initial
// bundle stays small. All pages ship default exports.
const Home = lazy(() => import('./pages/Home'))
const Search = lazy(() => import('./pages/Search'))
const ShowDetail = lazy(() => import('./pages/ShowDetail'))
const MovieDetail = lazy(() => import('./pages/MovieDetail'))
const MyShows = lazy(() => import('./pages/MyShows'))
const Movies = lazy(() => import('./pages/Movies'))
const Watchlist = lazy(() => import('./pages/Watchlist'))
const Upcoming = lazy(() => import('./pages/Upcoming'))
const Stats = lazy(() => import('./pages/Stats'))
const Profile = lazy(() => import('./pages/Profile'))
const Account = lazy(() => import('./pages/Account'))
const Settings = lazy(() => import('./pages/Settings'))
const ListDetail = lazy(() => import('./pages/ListDetail'))
const Migrate = lazy(() => import('./pages/Migrate'))
const Admin = lazy(() => import('./pages/Admin'))

/** Minimal centered fallback shown while a route chunk downloads. */
function RouteFallback() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
      <LoadingSpinner />
    </div>
  )
}

/** Followed, non-paused shows with at least one aired unwatched episode. */
function useUnwatchedShowCount(): number {
  const shows = useLibrary((st) => st.shows)
  return useMemo(
    () => Object.values(shows).filter((s) => !s.paused && nextEpisode(s) !== null).length,
    [shows],
  )
}

function useFreshness() {
  return useSyncExternalStore(subscribeFreshness, getFreshnessSnapshot)
}

/**
 * Reactive matchMedia hook (matchMedia + useSyncExternalStore, same external-
 * store pattern as useFreshness). Renders exactly one nav per viewport so no
 * invisible duplicate link can steal a tap.
 */
function useMediaQuery(query: string): boolean {
  const [mql] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query) : null,
  )
  return useSyncExternalStore(
    (cb) => {
      mql?.addEventListener('change', cb)
      return () => mql?.removeEventListener('change', cb)
    },
    () => mql?.matches ?? false,
    () => false,
  )
}

// Module-level: true only until the first route has painted. The full opacity
// fade plays on the initial app mount; in-app navigations get a near-instant
// variant (see .page-enter[data-first] in app-shell.css).
let firstLoad = true

function Nav({
  showsBadge,
  exploreDot,
  showAdmin,
}: {
  showsBadge: number
  exploreDot: boolean
  showAdmin: boolean
}) {
  const item = (to: string, icon: string, label: string, extra?: ReactNode) => (
    <NavLink to={to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
      <span>{icon}</span> {label}
      {extra}
    </NavLink>
  )
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        Raed <span>Tracker</span>
      </div>
      {item('/', '🏠', 'Home')}
      <div className="nav-section">Library</div>
      {item(
        '/shows',
        '📺',
        'Shows',
        showsBadge > 0 ? (
          <span className="nav-badge" aria-label={`${showsBadge} shows with unwatched episodes`}>
            {showsBadge > 99 ? '99+' : showsBadge}
          </span>
        ) : undefined,
      )}
      {item('/movies', '🎬', 'Movies')}
      {item(
        '/search',
        '🔍',
        'Explore',
        exploreDot ? <span className="nav-dot" aria-label="New trending shows" /> : undefined,
      )}
      {item('/upcoming', '🗓️', 'Upcoming')}
      {item('/watchlist', '🔖', 'Watchlist')}
      <div className="nav-section">You</div>
      {item('/stats', '📊', 'Stats')}
      {item('/profile', '👤', 'Profile')}
      {item('/account', '🔐', 'Account')}
      {item('/settings', '⚙️', 'Settings')}
      {showAdmin && item('/admin', '🛡️', 'Admin')}
    </nav>
  )
}

/** Mobile-only (<=760px) fixed bottom tab bar — the five primary destinations. */
function TabBar({ showsBadge, exploreDot }: { showsBadge: number; exploreDot: boolean }) {
  const tab = (to: string, icon: string, label: string, extra?: ReactNode, end?: boolean) => (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `tabbar-item${isActive ? ' active' : ''}`}
    >
      {/* Only the decorative emoji is aria-hidden — the badge/dot carry
          aria-labels and must stay in the a11y tree, but they also have to
          remain inside .tabbar-icon, their position:relative anchor. */}
      <span className="tabbar-icon">
        <span aria-hidden="true">{icon}</span>
        {extra}
      </span>
      <span className="tabbar-label">{label}</span>
    </NavLink>
  )
  return (
    <nav className="tabbar" aria-label="Primary">
      {/* `end` so "/" only matches Home exactly, not every route. */}
      {tab('/', '🏠', 'Home', undefined, true)}
      {tab(
        '/shows',
        '📺',
        'Shows',
        showsBadge > 0 ? (
          <span className="tab-badge" aria-label={`${showsBadge} shows with unwatched episodes`}>
            {showsBadge > 99 ? '99+' : showsBadge}
          </span>
        ) : undefined,
      )}
      {tab('/movies', '🎬', 'Movies')}
      {tab(
        '/search',
        '🔍',
        'Explore',
        exploreDot ? <span className="tab-dot" aria-label="New trending shows" /> : undefined,
      )}
      {tab('/profile', '👤', 'Profile')}
    </nav>
  )
}

// Root tab pages that get the minimal mobile brand row. Home is excluded — it
// has its own greeting page-title, so a brand row above it would double up.
const TAB_ROOTS = ['/shows', '/movies', '/search', '/profile']

/** Mobile-only minimal brand row, shown on the four root tab pages only
    (sub-pages get a BackBar instead; desktop keeps the sidebar logo). */
function MobileBrand() {
  const { pathname } = useLocation()
  if (!TAB_ROOTS.includes(pathname)) return null
  return (
    <div className="mobile-brand">
      Raed <span>Tracker</span>
    </div>
  )
}

export default function App() {
  const location = useLocation()
  const showsBadge = useUnwatchedShowCount()
  const { hasNewTrending } = useFreshness()
  const { isAdmin, adminMode } = useAdminGate()
  const isMobile = useMediaQuery('(max-width: 760px)')

  // Only the very first painted route plays the fuller fade; every in-app
  // navigation after it gets the near-instant variant. Reading + flipping the
  // module flag during render is safe: it's a monotonic one-way latch.
  const initialLoad = firstLoad
  useEffect(() => {
    firstLoad = false
  }, [])

  // Kick off the background freshness engine once per app load.
  useEffect(() => {
    initAdmin()
    void refreshFollowedShows()
    void checkTrendingPulse()
  }, [])

  // Landing on Explore counts as "seeing" the current trending set.
  // `hasNewTrending` is a dependency so that when the async trending pulse
  // resolves while the user is already on Explore (e.g. the app was opened
  // directly on /search), the dot is cleared and the seen-hash stored.
  useEffect(() => {
    if (location.pathname === '/search') markTrendingSeen()
  }, [location.pathname, hasNewTrending])

  // Route changes start at the top of the new page instead of inheriting the
  // previous page's scroll position.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <div className="app-layout">
      {/* Exactly one nav is in the DOM per viewport, so an invisible duplicate
          link can never intercept a tap on the primary nav. */}
      {!isMobile && (
        <Nav showsBadge={showsBadge} exploreDot={hasNewTrending} showAdmin={isAdmin && adminMode} />
      )}
      <main className="main-content">
        <MobileBrand />
        {isDemoMode() && (
          <div className="demo-banner">
            🎭 <b>Demo mode</b> — showing sample data. Add your free TMDB API key in{' '}
            <Link to="/settings">Settings</Link> to browse real shows and movies.
          </div>
        )}
        <div
          key={location.pathname}
          className="page-enter"
          data-first={initialLoad ? '' : undefined}
        >
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/search" element={<Search />} />
              <Route path="/show/:id" element={<ShowDetail />} />
              <Route path="/movie/:id" element={<MovieDetail />} />
              <Route path="/shows" element={<MyShows />} />
              <Route path="/movies" element={<Movies />} />
              <Route path="/watchlist" element={<Watchlist />} />
              <Route path="/upcoming" element={<Upcoming />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/account" element={<Account />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/list/:id" element={<ListDetail />} />
              <Route path="/migrate" element={<Migrate />} />
              <Route path="/admin" element={<Admin />} />
            </Routes>
          </Suspense>
        </div>
      </main>
      {isMobile && <TabBar showsBadge={showsBadge} exploreDot={hasNewTrending} />}
      {/* Mounted once at the app root so every check-off path across all pages
          can fire confetti (previously per-page mounts missed most paths). */}
      <ConfettiHost />
      <Toaster />
      <ConfirmHost />
    </div>
  )
}
