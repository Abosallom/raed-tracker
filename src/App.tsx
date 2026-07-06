import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigationType,
} from 'react-router-dom'
import { isDemoMode } from './api/tmdb'
import { LoadingSpinner } from './components/shared'
import { ConfettiHost } from './components/Confetti'
import MigratePrompt from './components/MigratePrompt'
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
const UserProfile = lazy(() => import('./pages/UserProfile'))
const Users = lazy(() => import('./pages/Users'))

/* ---------- inline line icons ----------
   Monochrome 24px line icons: stroke=currentColor so active nav/tab tabs tint
   accent yellow automatically (parent .active sets color). strokeWidth ~1.8,
   round joins/caps. aria-hidden — the adjacent text label / badge carries the
   accessible name. */
type IconProps = { className?: string }
const svg = (paths: ReactNode) => (p: IconProps) =>
  (
    <svg
      className={p.className}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths}
    </svg>
  )

const IconTv = svg(
  <>
    <rect x="3" y="7" width="18" height="12" rx="2" />
    <path d="m8 3 4 4 4-4" />
  </>,
)
const IconFilm = svg(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M8 4v16M16 4v16M3 9h5M16 9h5M3 15h5M16 15h5" />
  </>,
)
const IconCompass = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2 5-5 2 2-5 5-2z" />
  </>,
)
const IconCalendar = svg(
  <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 9h18M8 3v4M16 3v4" />
  </>,
)
const IconBookmark = svg(<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z" />)
const IconChart = svg(
  <>
    <path d="M4 20V4M4 20h16" />
    <path d="M8 20v-6M13 20V9M18 20v-9" />
  </>,
)
const IconUser = svg(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </>,
)
const IconLock = svg(
  <>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    <circle cx="12" cy="15.5" r="1.2" />
  </>,
)
const IconShield = svg(
  <>
    <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3z" />
    <path d="m9 12 2 2 4-4" />
  </>,
)
const IconGear = svg(
  <>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 3v2.5M12 18.5V21M4.2 7.5l2.2 1.3M17.6 15.2l2.2 1.3M20 7.5l-2.2 1.3M6.4 15.2 4.2 16.5" />
  </>,
)

type IconComp = (p: IconProps) => ReactNode

/** Minimal centered fallback shown while a route chunk downloads. */
function RouteFallback() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
      <LoadingSpinner />
    </div>
  )
}

/** Catch-all for unknown routes — an animated empty state instead of a blank
    black screen. The 📡 drifts (reduced-motion pins it still) and two buttons
    route back to the primary destinations. */
function NotFound() {
  return (
    <div className="notfound">
      <div className="notfound-emoji" aria-hidden="true">
        📡
      </div>
      <h1 className="notfound-title">Lost in the static</h1>
      <p className="notfound-sub">That page is off the air. Let’s get you back on channel.</p>
      <div className="notfound-actions">
        <Link to="/" className="btn primary">
          My Shows
        </Link>
        <Link to="/search" className="btn">
          Explore
        </Link>
      </div>
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

function Nav({
  showsBadge,
  exploreDot,
  showAdmin,
}: {
  showsBadge: number
  exploreDot: boolean
  showAdmin: boolean
}) {
  const item = (to: string, Icon: IconComp, label: string, extra?: ReactNode) => (
    // end on "/": the root NavLink would otherwise be active on every route.
    <NavLink to={to} end={to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
      <span className="nav-icon">
        <Icon />
      </span>
      <span className="nav-label">{label}</span>
      {extra}
    </NavLink>
  )
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        Raed <span>Tracker</span>
      </div>
      <div className="nav-section">Library</div>
      {item(
        '/',
        IconTv,
        'Shows',
        showsBadge > 0 ? (
          <span className="nav-badge" aria-label={`${showsBadge} shows with unwatched episodes`}>
            {showsBadge > 99 ? '99+' : showsBadge}
          </span>
        ) : undefined,
      )}
      {item('/movies', IconFilm, 'Movies')}
      {item(
        '/search',
        IconCompass,
        'Explore',
        exploreDot ? <span className="nav-dot" aria-label="New trending shows" /> : undefined,
      )}
      {item('/upcoming', IconCalendar, 'Upcoming')}
      {item('/watchlist', IconBookmark, 'Watchlist')}
      <div className="nav-section">You</div>
      {item('/stats', IconChart, 'Stats')}
      {item('/profile', IconUser, 'Profile')}
      {item('/account', IconLock, 'Account')}
      {item('/settings', IconGear, 'Settings')}
      {showAdmin && item('/admin', IconShield, 'Admin')}
    </nav>
  )
}

/** Mobile-only (<=760px) fixed bottom tab bar — exactly four primary
    destinations: Shows / Movies / Explore / Profile. ('/' Home stays routable
    via the .mobile-brand logo link and the desktop sidebar.) */
function TabBar({ showsBadge, exploreDot }: { showsBadge: number; exploreDot: boolean }) {
  const tab = (to: string, Icon: IconComp, label: string, extra?: ReactNode) => (
    // end on "/": the root NavLink would otherwise be active on every route.
    <NavLink to={to} end={to === '/'} className={({ isActive }) => `tabbar-item${isActive ? ' active' : ''}`}>
      {/* Icon is aria-hidden — the badge/dot carry aria-labels and must stay in
          the a11y tree, and inside .tabbar-icon (their position:relative anchor). */}
      <span className="tabbar-icon">
        <Icon />
        {extra}
      </span>
      <span className="tabbar-label">{label}</span>
    </NavLink>
  )
  return (
    <nav className="tabbar" aria-label="Primary">
      {tab(
        '/',
        IconTv,
        'Shows',
        showsBadge > 0 ? (
          <span className="tab-badge" aria-label={`${showsBadge} shows with unwatched episodes`}>
            {showsBadge > 99 ? '99+' : showsBadge}
          </span>
        ) : undefined,
      )}
      {tab('/movies', IconFilm, 'Movies')}
      {tab(
        '/search',
        IconCompass,
        'Explore',
        exploreDot ? <span className="tab-dot" aria-label="New trending shows" /> : undefined,
      )}
      {tab('/profile', IconUser, 'Profile')}
    </nav>
  )
}

// Root tab pages that get the minimal mobile brand row.
const TAB_ROOTS = ['/', '/movies', '/search', '/profile']

/** Mobile-only minimal brand row, shown on the four root tab pages only
    (sub-pages get a BackBar instead; desktop keeps the sidebar logo). */
function MobileBrand() {
  const { pathname } = useLocation()
  if (!TAB_ROOTS.includes(pathname)) return null
  return (
    <Link to="/" className="mobile-brand" aria-label="Raed Tracker home">
      Raed <span>Tracker</span>
    </Link>
  )
}

// Detail routes we push INTO: entering these via a link/PUSH gets a slide-from-
// right. Any other forward navigation (tab-to-tab) gets a plain cross-fade;
// browser back (POP) gets no motion so it feels like returning, not advancing.
const DETAIL_RE = /^\/(show|movie|user|list)\//

/**
 * Which enter animation the incoming page should play. Compares the previous
 * pathname (kept in a ref) with the current one plus the router's navigation
 * type. Returns a value for the wrapper's data-transition attribute; the CSS
 * maps each to a keyframe (or none).
 */
function useTransitionKind(pathname: string): 'first' | 'push-detail' | 'back' | 'fade' {
  const navType = useNavigationType() // 'PUSH' | 'POP' | 'REPLACE'
  const prev = useRef<string | null>(null)
  const kind = useRef<'first' | 'push-detail' | 'back' | 'fade'>('first')

  // Recompute ONLY when the pathname actually changes (i.e. a navigation).
  // Store-driven re-renders at the same pathname must return the cached value:
  // recomputing would see from === pathname and flip the attribute to 'fade',
  // and the changed animation-name restarts the enter animation mid-use
  // (visible re-fade of the whole page). Caching also keeps the value stable
  // across StrictMode's dev double-render.
  if (prev.current !== pathname) {
    const from = prev.current
    if (from === null) kind.current = 'first'
    else if (navType === 'POP') kind.current = 'back'
    // Sliding in only when arriving AT a detail route from a non-detail one via
    // a forward push — deep-link-to-deep-link and back both stay calm.
    else if (navType === 'PUSH' && DETAIL_RE.test(pathname) && !DETAIL_RE.test(from))
      kind.current = 'push-detail'
    else kind.current = 'fade'
    prev.current = pathname
  }
  return kind.current
}

export default function App() {
  const location = useLocation()
  const transition = useTransitionKind(location.pathname)
  const showsBadge = useUnwatchedShowCount()
  const { hasNewTrending } = useFreshness()
  const { isAdmin, adminMode } = useAdminGate()
  const isMobile = useMediaQuery('(max-width: 760px)')

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
        <div key={location.pathname} className="page-enter" data-transition={transition}>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              {/* My Shows IS the landing page (TV Time opens on its watch
                  list); /shows stays as a redirect for old links. */}
              <Route path="/" element={<MyShows />} />
              <Route path="/shows" element={<Navigate to="/" replace />} />
              <Route path="/search" element={<Search />} />
              {/* Legacy/aliased path — Explore lives at /search. */}
              <Route path="/explore" element={<Navigate to="/search" replace />} />
              <Route path="/show/:id" element={<ShowDetail />} />
              <Route path="/movie/:id" element={<MovieDetail />} />
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
              <Route path="/user/:id" element={<UserProfile />} />
              <Route path="/users" element={<Users />} />
              {/* Catch-all: unknown hashes no longer dead-end on black. */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </div>
      </main>
      {isMobile && <TabBar showsBadge={showsBadge} exploreDot={hasNewTrending} />}
      {/* Mounted once at the app root so every check-off path across all pages
          can fire confetti (previously per-page mounts missed most paths). */}
      <ConfettiHost />
      <Toaster />
      <MigratePrompt />
      <ConfirmHost />
    </div>
  )
}
