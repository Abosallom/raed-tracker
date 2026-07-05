import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { isDemoMode } from './api/tmdb'
import Home from './pages/Home'
import Search from './pages/Search'
import ShowDetail from './pages/ShowDetail'
import MovieDetail from './pages/MovieDetail'
import MyShows from './pages/MyShows'
import Movies from './pages/Movies'
import Watchlist from './pages/Watchlist'
import Upcoming from './pages/Upcoming'
import Stats from './pages/Stats'
import Profile from './pages/Profile'
import Account from './pages/Account'
import Settings from './pages/Settings'
import ListDetail from './pages/ListDetail'
import Migrate from './pages/Migrate'
import { Toaster } from './components/toast'
import { nextEpisode, useLibrary } from './store/library'
import {
  checkTrendingPulse,
  getFreshnessSnapshot,
  markTrendingSeen,
  refreshFollowedShows,
  subscribeFreshness,
} from './lib/freshness'
import './app-shell.css'

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

function Nav({ showsBadge, exploreDot }: { showsBadge: number; exploreDot: boolean }) {
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
    </nav>
  )
}

/** Mobile-only (<=760px) fixed bottom tab bar — the four primary destinations. */
function TabBar({ showsBadge, exploreDot }: { showsBadge: number; exploreDot: boolean }) {
  const tab = (to: string, icon: string, label: string, extra?: ReactNode) => (
    <NavLink to={to} className={({ isActive }) => `tabbar-item${isActive ? ' active' : ''}`}>
      <span className="tabbar-icon" aria-hidden="true">
        {icon}
        {extra}
      </span>
      <span className="tabbar-label">{label}</span>
    </NavLink>
  )
  return (
    <nav className="tabbar" aria-label="Primary">
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

  // Kick off the background freshness engine once per app load.
  useEffect(() => {
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
      <Nav showsBadge={showsBadge} exploreDot={hasNewTrending} />
      <main className="main-content">
        <MobileBrand />
        {isDemoMode() && (
          <div className="demo-banner">
            🎭 <b>Demo mode</b> — showing sample data. Add your free TMDB API key in{' '}
            <Link to="/settings">Settings</Link> to browse real shows and movies.
          </div>
        )}
        <div key={location.pathname} className="page-enter">
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
          </Routes>
        </div>
      </main>
      <TabBar showsBadge={showsBadge} exploreDot={hasNewTrending} />
      <Toaster />
    </div>
  )
}
