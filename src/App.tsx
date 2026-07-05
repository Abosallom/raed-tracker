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
import './app-shell.css'

function Nav() {
  const item = (to: string, icon: string, label: string) => (
    <NavLink to={to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
      <span>{icon}</span> {label}
    </NavLink>
  )
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        Raed <span>Tracker</span>
      </div>
      {item('/', '🏠', 'Home')}
      <div className="nav-section">Library</div>
      {item('/shows', '📺', 'Shows')}
      {item('/movies', '🎬', 'Movies')}
      {item('/search', '🔍', 'Explore')}
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
function TabBar() {
  const tab = (to: string, icon: string, label: string) => (
    <NavLink to={to} className={({ isActive }) => `tabbar-item${isActive ? ' active' : ''}`}>
      <span className="tabbar-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="tabbar-label">{label}</span>
    </NavLink>
  )
  return (
    <nav className="tabbar" aria-label="Primary">
      {tab('/shows', '📺', 'Shows')}
      {tab('/movies', '🎬', 'Movies')}
      {tab('/search', '🔍', 'Explore')}
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
  return (
    <div className="app-layout">
      <Nav />
      <main className="main-content">
        <MobileBrand />
        {isDemoMode() && (
          <div className="demo-banner">
            🎭 <b>Demo mode</b> — showing sample data. Add your free TMDB API key in{' '}
            <Link to="/settings">Settings</Link> to browse real shows and movies.
          </div>
        )}
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
      </main>
      <TabBar />
      <Toaster />
    </div>
  )
}
