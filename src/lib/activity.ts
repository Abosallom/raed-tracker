// Show-level "recent activity" ordering, shared by Home's Keep watching row
// and the MyShows queue so both agree on what "recently watched" means.
//
// lastWatchedAt is the authoritative signal: stamped by the store on every
// user check (never by bulk imports, which keep their original historical
// dates) and merged later-wins across devices — the per-record earliest-wins
// merge in sync.ts exists to preserve import provenance and must not be able
// to demote a show the user just watched. Scanning watch records covers
// libraries from before the field existed, and addedAt covers shows that
// have never been watched at all.

import type { TrackedShow } from '../types'

export function lastActivity(show: TrackedShow): number {
  const hasHistory = show.lastWatchedAt !== undefined || Object.keys(show.watched).length > 0
  // addedAt is ONLY the fallback for shows with no watch history: imported
  // libraries "add" every show at the import moment, so including addedAt in
  // the max ties the whole library at that instant and buries real (older)
  // watch dates — long-stopped shows then outrank genuinely recent watches.
  if (!hasHistory) return new Date(show.addedAt).getTime()
  let latest = 0
  if (show.lastWatchedAt) {
    const t = new Date(show.lastWatchedAt).getTime()
    if (t > latest) latest = t
  }
  for (const rec of Object.values(show.watched)) {
    const t = new Date(rec.watchedAt).getTime()
    if (t > latest) latest = t
  }
  return latest
}

// Shows the user actually STARTED rank above never-started ones: a bulk
// import stamps addedAt at the import instant, which otherwise outranks a
// show genuinely watched a week earlier — the #1 reason the row read as
// "random". Within each half, most recent activity first; bulk-imported
// shows tie at the exact import instant (raw timestamp ordering would
// degenerate to object insertion order), so break ties by how invested the
// user is (episodes watched), then A→Z.
export function byRecentActivity(a: TrackedShow, b: TrackedShow): number {
  const aEps = Object.keys(a.watched).length
  const bEps = Object.keys(b.watched).length
  return (
    Number(bEps > 0) - Number(aEps > 0) ||
    lastActivity(b) - lastActivity(a) ||
    bEps - aEps ||
    a.snapshot.name.localeCompare(b.snapshot.name)
  )
}
