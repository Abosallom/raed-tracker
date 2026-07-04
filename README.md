# Raed Tracker 📺

A TV Time–style web app for tracking TV shows and movies — episode-level progress,
watchlist, upcoming episodes, emotion reactions, comments, and watch stats.

Built with **React 19 + TypeScript + Vite**, `react-router-dom`, and `zustand`.

## Data source

Metadata (shows, seasons, episodes, movies, posters, air dates) comes from the
**TMDB API**, and every title links out to its **IMDb** page via the IMDb ID that
TMDB provides.

- **Demo mode** — with no API key configured the app runs on built-in sample data,
  so every feature is usable out of the box.
- **Real data** — create a free account at [themoviedb.org](https://www.themoviedb.org/),
  request an API key under *Settings → API*, and paste it into the app's
  **Settings** page (or set `VITE_TMDB_API_KEY` in a `.env` file).

> This product uses the TMDB API but is not endorsed or certified by TMDB.
> IMDb's own API is a paid commercial product; linking out with IMDb IDs is the
> standard free approach.

## Running

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Features

- **Discover** — hero carousel, trending / popular / top-rated rows, keep-watching strip
- **Search** — shows and movies with filters and recent searches
- **Show pages** — seasons & episodes with stills, watched toggles, mark season/show
  watched, progress bars, cast, IMDb link, per-episode emotion reactions, comments
- **Movie pages** — watched toggle, reactions, cast, IMDb link, comments
- **My Shows** — TV Time–style "watch next" queue with one-tap episode check-off
- **Movies / Watchlist** — libraries with quick actions
- **Upcoming** — calendar of next episodes for followed shows + upcoming movies
- **Stats** — watch time, genre breakdown, reactions, activity by month
- **Profile** — avatar, favorites, your comments
- **Account** — email OTP or password sign-in, security controls, cloud-data management
- **Cloud sync** — Supabase-backed cross-device library sync with conflict-safe merging
  (deletion tombstones, last-writer-wins fields, realtime updates)
- **Settings** — TMDB key, sync status, JSON export/import of your library, reset
- **Native feel** — mobile bottom tab bar, PWA install (Add to Home Screen), skeleton
  loaders, action toasts, micro-animations

## Cloud sync setup (optional)

Create a free [Supabase](https://supabase.com) project, run the SQL in the repo
history (creates the `libraries` table with row-level security), and set
`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (locally in `.env`, in CI as
Actions secrets). Without them the app runs local-only. For OTP codes, include
`{{ .Token }}` in the Supabase Magic Link email template.

## Storage & architecture notes

Your library (shows, watched episodes, watchlist, comments, profile) persists in
`localStorage` under the key `showtrackr_library` via a `zustand` persist store
([src/store/library.ts](src/store/library.ts)). The store is the single write
path for user data, so swapping `localStorage` for a real backend (Supabase,
Firebase, your own API) later only means replacing the persist layer — pages
don't change. Comments/social are local simulations for now for the same reason.
