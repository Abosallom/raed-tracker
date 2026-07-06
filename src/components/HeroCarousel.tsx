// Trending spotlight carousel — lives at the top of Explore's Discover tab
// (moved off Home, which is tracker-only). Auto-advances, pauses on
// hover/focus, and falls back to rich gradients in demo mode where
// backdrop paths are null.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { SearchResult } from '../types'
import { backdropUrl } from '../api/tmdb'
import { useLibrary } from '../store/library'
import { showToast } from './toast'
import './hero.css'

const HERO_GRADIENTS = [
  'radial-gradient(90% 130% at 85% -10%, rgba(251, 191, 36, 0.16), transparent 55%), linear-gradient(115deg, #3b2f1a 0%, #241d10 55%, #171717 100%)',
  'radial-gradient(90% 130% at 85% -10%, rgba(96, 165, 250, 0.14), transparent 55%), linear-gradient(115deg, #1c2c3d 0%, #141d28 55%, #171717 100%)',
  'radial-gradient(90% 130% at 85% -10%, rgba(192, 132, 252, 0.14), transparent 55%), linear-gradient(115deg, #2e1f3a 0%, #1e1526 55%, #171717 100%)',
  'radial-gradient(90% 130% at 85% -10%, rgba(52, 211, 153, 0.14), transparent 55%), linear-gradient(115deg, #16332a 0%, #10221c 55%, #171717 100%)',
  'radial-gradient(90% 130% at 85% -10%, rgba(248, 113, 113, 0.14), transparent 55%), linear-gradient(115deg, #3a211c 0%, #241512 55%, #171717 100%)',
]

const HERO_INTERVAL_MS = 6000

export default function HeroCarousel({ items }: { items: SearchResult[] }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const watchlist = useLibrary((st) => st.watchlist)
  const addToWatchlist = useLibrary((st) => st.addToWatchlist)

  // Auto-advance; the timer restarts whenever the slide changes (incl. dot clicks).
  useEffect(() => {
    if (paused || items.length < 2) return
    const timer = window.setTimeout(
      () => setIndex((i) => (i + 1) % items.length),
      HERO_INTERVAL_MS,
    )
    return () => window.clearTimeout(timer)
  }, [index, paused, items.length])

  if (items.length === 0) return null

  const addItem = (item: SearchResult) => {
    addToWatchlist({
      type: 'tv',
      id: item.id,
      name: item.name,
      poster_path: item.poster_path,
    })
    showToast(`${item.name} added to watchlist`, '🔖')
  }

  return (
    <section
      className="home-hero fade-in"
      aria-roledescription="carousel"
      aria-label="Trending this week"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {items.map((item, i) => {
        const active = i === index
        const backdrop = backdropUrl(item.backdrop_path, 'w1280')
        const year = (item.first_air_date ?? item.release_date ?? '').slice(0, 4)
        const onList = watchlist.some((w) => w.type === 'tv' && w.id === item.id)
        return (
          <article
            key={item.id}
            className={`home-hero-slide${active ? ' active' : ''}`}
            aria-hidden={!active}
          >
            {backdrop ? (
              <img className="home-hero-backdrop" src={backdrop} alt="" />
            ) : (
              <div
                className="home-hero-backdrop home-hero-fallback"
                style={{ background: HERO_GRADIENTS[i % HERO_GRADIENTS.length] }}
              />
            )}
            <div className="home-hero-scrim" />
            <div className="home-hero-content">
              <h2 className="home-hero-title">{item.name}</h2>
              <div className="home-hero-meta">
                {year && <span className="home-hero-chip">{year}</span>}
                {item.vote_average > 0 && (
                  <span className="home-hero-chip home-hero-rating">
                    ★ {item.vote_average.toFixed(1)}
                  </span>
                )}
              </div>
              {item.overview && <p className="home-hero-overview">{item.overview}</p>}
              <div className="home-hero-actions">
                <Link
                  className="btn primary"
                  to={`/show/${item.id}`}
                  tabIndex={active ? 0 : -1}
                >
                  View show
                </Link>
                <button
                  className="btn"
                  onClick={() => addItem(item)}
                  disabled={onList}
                  tabIndex={active ? 0 : -1}
                >
                  {onList ? '✓ On watchlist' : '＋ Watchlist'}
                </button>
              </div>
            </div>
          </article>
        )
      })}
      <div className="home-hero-dots">
        {items.map((item, i) => (
          <button
            key={item.id}
            className={`home-hero-dot${i === index ? ' active' : ''}`}
            aria-label={`Go to ${item.name}`}
            aria-current={i === index}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </section>
  )
}
