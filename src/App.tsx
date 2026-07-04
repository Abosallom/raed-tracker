import { Link, NavLink, Route, Routes } from 'react-router-dom'
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
import Settings from './pages/Settings'

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
      {item('/', '🏠', 'Discover')}
      {item('/search', '🔍', 'Search')}
      <div className="nav-section">Library</div>
      {item('/shows', '📺', 'My Shows')}
      {item('/movies', '🎬', 'Movies')}
      {item('/watchlist', '🔖', 'Watchlist')}
      {item('/upcoming', '🗓️', 'Upcoming')}
      <div className="nav-section">You</div>
      {item('/stats', '📊', 'Stats')}
      {item('/profile', '👤', 'Profile')}
      {item('/settings', '⚙️', 'Settings')}
    </nav>
  )
}

export default function App() {
  return (
    <div className="app-layout">
      <Nav />
      <main className="main-content">
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
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}
