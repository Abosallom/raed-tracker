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

- **Discover** — trending / popular / top-rated shows and movies, keep-watching strip
- **Search** — shows and movies with filters
- **Show pages** — seasons & episodes, watched toggles, mark season/show watched,
  progress bars, cast, IMDb link, per-episode emotion reactions, comments
- **Movie pages** — watched toggle, reactions, cast, IMDb link, comments
- **My Shows** — TV Time–style "watch next" queue with one-tap episode check-off
- **Movies / Watchlist** — libraries with quick actions
- **Upcoming** — calendar of next episodes for followed shows + upcoming movies
- **Stats** — watch time, genre breakdown, reactions, activity by month
- **Profile** — avatar, favorites, your comments
- **Settings** — TMDB key, JSON export/import of your library, reset

## Storage & architecture notes

Your library (shows, watched episodes, watchlist, comments, profile) persists in
`localStorage` under the key `showtrackr_library` via a `zustand` persist store
([src/store/library.ts](src/store/library.ts)). The store is the single write
path for user data, so swapping `localStorage` for a real backend (Supabase,
Firebase, your own API) later only means replacing the persist layer — pages
don't change. Comments/social are local simulations for now for the same reason.
