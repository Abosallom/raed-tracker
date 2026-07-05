// Cloud sync engine: mirrors the zustand library store to a single jsonb row
// per user in Supabase (table `libraries`), merging across devices.
//
// Design:
// - Local-first: the store stays the source of truth; sync never blocks the UI.
// - Push: store changes are debounced (1.5s) and upserted as one JSON document.
// - Pull: on startup / sign-in / realtime event, remote is fetched and MERGED
//   (union of watch history, watchlist, comments) — never blindly overwritten,
//   so two devices that both watched episodes offline keep both histories.
// - Deletions: a plain union would resurrect anything removed on one device
//   (the copy still exists in the remote doc / on other devices). Every
//   destructive store change is therefore recorded as a tombstone in a small
//   sync-metadata map (persisted in localStorage and shipped inside the doc);
//   merging applies tombstones to both sides before taking the union.
// - LWW fields: emotions, comment likes and the profile carry "last set"
//   timestamps in the same metadata map so edits converge to the most recent
//   writer instead of each device keeping its own value forever.
// - Echo guard: every push carries this tab's deviceId; realtime events from
//   the same deviceId are ignored. The id is per-tab (in memory), NOT
//   per-browser: two tabs of one browser must see each other's pushes.

import type {
  Comment,
  ListItem,
  Profile,
  TrackedMovie,
  TrackedShow,
  UserList,
  WatchRecord,
  WatchlistItem,
} from '../types'
import { supabase } from '../api/supabase'
import { useLibrary } from './library'

/**
 * Sync metadata: tombstones for deletions and last-writer timestamps for
 * value fields. Keys are namespaced strings, e.g. `show:123`, `ep:123:s1e2`,
 * `emo:123:s1e2`, `emo:m:456`, `movie:456`, `movie-watched:456`,
 * `fav:123`, `fav:m:456`, `wl:tv:123`, `comment:c_1`, `like:c_1`, `profile`.
 */
export interface SyncMeta {
  /** key -> ISO time the item/field was deleted or cleared. */
  deleted: Record<string, string>
  /** key -> ISO time an LWW field (emotion, like, profile) was last set. */
  set: Record<string, string>
}

/** The persisted slice of the store that gets synced. */
export interface LibraryData {
  shows: Record<number, TrackedShow>
  movies: Record<number, TrackedMovie>
  watchlist: WatchlistItem[]
  comments: Comment[]
  profile: Profile
  /** Custom lists; absent on docs written by older versions. */
  lists?: UserList[]
  /** Sync metadata; absent on docs written by older versions. */
  sync?: SyncMeta
}

type LibrarySlices = Omit<LibraryData, 'sync'>

export type SyncStatus =
  | { state: 'off' } // no Supabase config in this build
  | { state: 'signed-out' }
  | { state: 'syncing' }
  | { state: 'synced'; at: string; email: string }
  // `email` present = the error happened while signed in (auth is still valid).
  | { state: 'error'; message: string; email?: string }

type Listener = (s: SyncStatus) => void

// Per-tab echo-guard id. Deliberately NOT persisted: localStorage would share
// one id across every tab of the browser, making tabs ignore each other's
// realtime pushes as "own echoes" and silently clobber one another.
const DEVICE_ID = `dev_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

function deviceId(): string {
  return DEVICE_ID
}

// ---------- sync metadata (tombstones + LWW timestamps) ----------

const META_KEY = 'showtrackr_sync_meta'
const LAST_USER_KEY = 'showtrackr_sync_user'
/** Where the pre-wipe library is stashed when switching accounts (recovery). */
const WIPED_BACKUP_KEY = 'showtrackr_wiped_library_backup'

// Captured ONCE at module load, before any auth event can rewrite it.
// connect()'s account-switch wipe must compare against the user this tab's
// data actually belongs to: reading localStorage at event time races the
// cross-tab SIGNED_IN broadcast — the signing-in tab writes the NEW user id
// first, so a background tab still holding the old user's library would skip
// the wipe and merge it into the new account's cloud data.
let lastSyncUser: string | null = null
try {
  lastSyncUser = localStorage.getItem(LAST_USER_KEY)
} catch {
  // storage unavailable — treated as no previous user
}

function emptyMeta(): SyncMeta {
  return { deleted: {}, set: {} }
}

function normMeta(m: Partial<SyncMeta> | null | undefined): SyncMeta {
  return { deleted: m?.deleted ?? {}, set: m?.set ?? {} }
}

function loadMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(META_KEY)
    return raw ? normMeta(JSON.parse(raw) as Partial<SyncMeta>) : emptyMeta()
  } catch {
    return emptyMeta()
  }
}

function saveMeta(meta: SyncMeta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    // best effort; sync still works within this session
  }
}

function clearMeta() {
  try {
    localStorage.removeItem(META_KEY)
  } catch {
    // ignore
  }
}

function mergeMeta(a: SyncMeta, b: SyncMeta): SyncMeta {
  const out = emptyMeta()
  for (const src of [a, b]) {
    for (const [k, v] of Object.entries(src.deleted)) {
      if (!out.deleted[k] || v > out.deleted[k]) out.deleted[k] = v
    }
    for (const [k, v] of Object.entries(src.set)) {
      if (!out.set[k] || v > out.set[k]) out.set[k] = v
    }
  }
  return out
}

/**
 * A tombstone applies unless the field was re-set after the deletion or the
 * surviving item itself is newer than the deletion (re-added/re-watched).
 */
function isDeleted(meta: SyncMeta, key: string, itemTime?: string): boolean {
  const d = meta.deleted[key]
  if (!d) return false
  const s = meta.set[key]
  if (s && s > d) return false
  if (itemTime && itemTime > d) return false
  return true
}

/**
 * Diff two store snapshots and record tombstones / set-times for everything
 * the transition deleted, cleared or (re)set. Runs synchronously on every
 * store change, so tombstones are already persisted even if the page reloads
 * before the debounced push fires (e.g. Settings "Reset everything").
 */
function recordChanges(prev: LibrarySlices, next: LibrarySlices) {
  const meta = loadMeta()
  const at = new Date().toISOString()
  let dirty = false
  const kill = (k: string) => {
    meta.deleted[k] = at
    dirty = true
  }
  const touch = (k: string) => {
    meta.set[k] = at
    dirty = true
  }
  // Re-added item with a stale tombstone: record a fresh set-time so
  // isDeleted()'s escape hatch rescues it. Restored backups and re-run
  // TV Time imports keep their ORIGINAL addedAt/watchedAt, which predates any
  // tombstone recorded since the export — without this the first pullAndMerge
  // after a restore silently wipes the restored data again and pushes the
  // wipe to the cloud. Only tombstoned keys are touched to keep meta small.
  const revive = (k: string) => {
    if (meta.deleted[k]) touch(k)
  }

  const pShows = prev.shows ?? {}
  const nShows = next.shows ?? {}
  for (const id of Object.keys(pShows)) {
    if (!nShows[Number(id)]) kill(`show:${id}`)
  }
  for (const [id, n] of Object.entries(nShows)) {
    const p = pShows[Number(id)]
    if (!p) {
      revive(`show:${id}`)
      for (const key of Object.keys(n.watched ?? {})) revive(`ep:${id}:${key}`)
      continue
    }
    if (p === n) continue
    if (p.snapshot !== n.snapshot) touch(`snap:${id}`)
    if ((p.paused ?? false) !== (n.paused ?? false)) touch(`pause:${id}`)
    if ((p.favorite ?? false) !== (n.favorite ?? false)) touch(`fav:${id}`)
    for (const [key, pr] of Object.entries(p.watched ?? {})) {
      const nr = n.watched?.[key]
      if (!nr) kill(`ep:${id}:${key}`)
      else {
        if (pr.emotion && !nr.emotion) kill(`emo:${id}:${key}`)
        if (pr.favoriteCast && !nr.favoriteCast) kill(`fc:${id}:${key}`)
      }
    }
    for (const [key, nr] of Object.entries(n.watched ?? {})) {
      if (!p.watched?.[key]) revive(`ep:${id}:${key}`)
      if (nr.emotion && nr.emotion !== p.watched?.[key]?.emotion) touch(`emo:${id}:${key}`)
      if (nr.favoriteCast && nr.favoriteCast.id !== p.watched?.[key]?.favoriteCast?.id)
        touch(`fc:${id}:${key}`)
    }
  }

  const pMovies = prev.movies ?? {}
  const nMovies = next.movies ?? {}
  for (const id of Object.keys(pMovies)) {
    if (!nMovies[Number(id)]) kill(`movie:${id}`)
  }
  for (const [id, n] of Object.entries(nMovies)) {
    const p = pMovies[Number(id)]
    if (!p) {
      revive(`movie:${id}`)
      if (n.watched) revive(`movie-watched:${id}`)
      continue
    }
    if (p === n) continue
    if ((p.favorite ?? false) !== (n.favorite ?? false)) touch(`fav:m:${id}`)
    if (p.watched && !n.watched) kill(`movie-watched:${id}`)
    if (!p.watched && n.watched) revive(`movie-watched:${id}`)
    if (p.watched?.emotion && n.watched && !n.watched.emotion) kill(`emo:m:${id}`)
    if (n.watched?.emotion && n.watched.emotion !== p.watched?.emotion) touch(`emo:m:${id}`)
  }

  const nWl = new Set((next.watchlist ?? []).map((w) => `${w.type}:${w.id}`))
  const pWl = new Set((prev.watchlist ?? []).map((w) => `${w.type}:${w.id}`))
  for (const w of prev.watchlist ?? []) {
    if (!nWl.has(`${w.type}:${w.id}`)) kill(`wl:${w.type}:${w.id}`)
  }
  for (const w of next.watchlist ?? []) {
    if (!pWl.has(`${w.type}:${w.id}`)) revive(`wl:${w.type}:${w.id}`)
  }

  const nComments = new Map((next.comments ?? []).map((c) => [c.id, c]))
  const pComments = new Set((prev.comments ?? []).map((c) => c.id))
  for (const c of prev.comments ?? []) {
    const n = nComments.get(c.id)
    if (!n) kill(`comment:${c.id}`)
    else if (c.likedByMe && !n.likedByMe) kill(`like:${c.id}`)
    else if (!c.likedByMe && n.likedByMe) touch(`like:${c.id}`)
  }
  for (const c of next.comments ?? []) {
    if (!pComments.has(c.id)) revive(`comment:${c.id}`)
  }

  const pLists = new Map((prev.lists ?? []).map((l) => [l.id, l]))
  const nLists = new Map((next.lists ?? []).map((l) => [l.id, l]))
  for (const [id] of pLists) {
    if (!nLists.has(id)) kill(`list:${id}`)
  }
  for (const [id, n] of nLists) {
    const p = pLists.get(id)
    if (!p) {
      touch(`list:${id}`)
      for (const it of n.items) revive(`li:${id}:${it.type}:${it.id}`)
      continue
    }
    if (p === n) continue
    if (p.name !== n.name) touch(`listname:${id}`)
    const nItems = new Set(n.items.map((it) => `${it.type}:${it.id}`))
    const pItems = new Set(p.items.map((it) => `${it.type}:${it.id}`))
    for (const k of pItems) {
      if (!nItems.has(k)) kill(`li:${id}:${k}`)
    }
    for (const k of nItems) {
      if (!pItems.has(k)) touch(`li:${id}:${k}`)
    }
  }

  if (prev.profile !== next.profile) touch('profile')

  if (dirty) saveMeta(meta)
}

/**
 * Record deletions implied by replacing the local library wholesale (backup
 * import): everything the replacement drops gets a tombstone, so the intent
 * survives the immediate page reload and propagates to the cloud instead of
 * being silently re-merged from the remote doc.
 */
export function noteLibraryReplaced(next: {
  shows?: Record<number, TrackedShow>
  movies?: Record<number, TrackedMovie>
  watchlist?: WatchlistItem[]
  comments?: Comment[]
  profile?: Profile
  lists?: UserList[]
}) {
  const prev = pickData()
  recordChanges(prev, {
    shows: next.shows ?? {},
    movies: next.movies ?? {},
    watchlist: next.watchlist ?? [],
    comments: next.comments ?? [],
    profile: next.profile ?? prev.profile,
    // Backups from older versions have no lists; keep the current ones rather
    // than tombstoning every list the backup predates.
    lists: next.lists ?? prev.lists,
  })
}

function pickData(): LibraryData {
  const s = useLibrary.getState()
  return {
    shows: s.shows,
    movies: s.movies,
    watchlist: s.watchlist,
    comments: s.comments,
    profile: s.profile,
    lists: s.lists,
    sync: loadMeta(),
  }
}

// ---------- merge ----------

function earlier(a: string, b: string): string {
  return a <= b ? a : b
}

/** Last-writer-wins pick between the local and remote value for one key. */
function pickLww<T>(
  key: string,
  local: T | undefined,
  remote: T | undefined,
  localMeta: SyncMeta,
  remoteMeta: SyncMeta,
): T | undefined {
  const lt = localMeta.set[key] ?? ''
  const rt = remoteMeta.set[key] ?? ''
  if (rt > lt) return remote ?? local
  if (lt > rt) return local ?? remote
  return local ?? remote
}

function mergeWatchRecord(
  local: WatchRecord,
  remote: WatchRecord,
  emoKey: string,
  fcKey: string,
  localMeta: SyncMeta,
  remoteMeta: SyncMeta,
): WatchRecord {
  return {
    watchedAt: earlier(local.watchedAt, remote.watchedAt),
    emotion: pickLww(emoKey, local.emotion, remote.emotion, localMeta, remoteMeta),
    favoriteCast: pickLww(fcKey, local.favoriteCast, remote.favoriteCast, localMeta, remoteMeta),
  }
}

function mergeShows(
  local: Record<number, TrackedShow>,
  remote: Record<number, TrackedShow>,
  localMeta: SyncMeta,
  remoteMeta: SyncMeta,
): Record<number, TrackedShow> {
  const out: Record<number, TrackedShow> = { ...remote }
  for (const [idStr, ls] of Object.entries(local)) {
    const id = Number(idStr)
    const rs = out[id]
    if (!rs) {
      out[id] = ls
      continue
    }
    const watched: Record<string, WatchRecord> = { ...rs.watched }
    for (const [key, rec] of Object.entries(ls.watched)) {
      watched[key] = watched[key]
        ? mergeWatchRecord(
            rec,
            watched[key],
            `emo:${id}:${key}`,
            `fc:${id}:${key}`,
            localMeta,
            remoteMeta,
          )
        : rec
    }
    // Paused is LWW on the pause:<id> touch-times; with no recorded flip on
    // either side (older docs) fall back to "paused anywhere wins".
    const pk = `pause:${id}`
    const plt = localMeta.set[pk] ?? ''
    const prt = remoteMeta.set[pk] ?? ''
    const paused = plt || prt ? (prt > plt ? rs.paused : ls.paused) : ls.paused || rs.paused
    // Favorite is LWW on the fav:<id> touch-times; with no recorded flip on
    // either side (older docs) fall back to "favorited anywhere wins".
    const fk = `fav:${id}`
    const flt = localMeta.set[fk] ?? ''
    const frt = remoteMeta.set[fk] ?? ''
    const favorite =
      flt || frt ? (frt > flt ? rs.favorite : ls.favorite) : ls.favorite || rs.favorite
    // Snapshot is LWW on the snap:<id> touch-times recorded by refreshShow —
    // "larger totalEpisodes wins" alone could never propagate a legitimate
    // TMDB episode-count correction (a stale larger copy always won). Older
    // docs without touch-times keep that heuristic as the fallback.
    const sk = `snap:${id}`
    const slt = localMeta.set[sk] ?? ''
    const srt = remoteMeta.set[sk] ?? ''
    const snapshot =
      slt || srt
        ? srt > slt
          ? rs.snapshot
          : ls.snapshot
        : ls.snapshot.totalEpisodes >= rs.snapshot.totalEpisodes
          ? ls.snapshot
          : rs.snapshot
    out[id] = {
      snapshot,
      addedAt: earlier(ls.addedAt, rs.addedAt),
      watched,
      favorite,
      paused,
    }
  }
  return out
}

function mergeMovies(
  local: Record<number, TrackedMovie>,
  remote: Record<number, TrackedMovie>,
  localMeta: SyncMeta,
  remoteMeta: SyncMeta,
): Record<number, TrackedMovie> {
  const out: Record<number, TrackedMovie> = { ...remote }
  for (const [idStr, lm] of Object.entries(local)) {
    const id = Number(idStr)
    const rm = out[id]
    if (!rm) {
      out[id] = lm
      continue
    }
    // Favorite is LWW on the fav:m:<id> touch-times; with no recorded flip on
    // either side (older docs) fall back to "favorited anywhere wins".
    const fk = `fav:m:${id}`
    const flt = localMeta.set[fk] ?? ''
    const frt = remoteMeta.set[fk] ?? ''
    const favorite =
      flt || frt ? (frt > flt ? rm.favorite : lm.favorite) : lm.favorite || rm.favorite
    out[id] = {
      snapshot: lm.snapshot,
      addedAt: earlier(lm.addedAt, rm.addedAt),
      watched:
        lm.watched && rm.watched
          ? mergeWatchRecord(lm.watched, rm.watched, `emo:m:${id}`, `fc:m:${id}`, localMeta, remoteMeta)
          : lm.watched ?? rm.watched,
      favorite,
    }
  }
  return out
}

function mergeWatchlist(local: WatchlistItem[], remote: WatchlistItem[]): WatchlistItem[] {
  const seen = new Map<string, WatchlistItem>()
  for (const item of [...remote, ...local]) {
    const key = `${item.type}:${item.id}`
    const prev = seen.get(key)
    if (!prev || item.addedAt < prev.addedAt) seen.set(key, item)
  }
  return [...seen.values()].sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1))
}

function mergeComments(
  local: Comment[],
  remote: Comment[],
  localMeta: SyncMeta,
  remoteMeta: SyncMeta,
): Comment[] {
  const seen = new Map<string, Comment>()
  for (const c of remote) seen.set(c.id, c)
  for (const c of local) {
    const r = seen.get(c.id)
    if (!r) {
      seen.set(c.id, c)
      continue
    }
    // Keep the copy from the side that changed the like state most recently;
    // with no recorded times fall back to "likedByMe true wins".
    const key = `like:${c.id}`
    const lt = localMeta.set[key] ?? localMeta.deleted[key] ?? ''
    const rt = remoteMeta.set[key] ?? remoteMeta.deleted[key] ?? ''
    if (lt > rt) seen.set(c.id, c)
    else if (rt > lt) seen.set(c.id, r)
    else if (c.likedByMe && !r.likedByMe) seen.set(c.id, c)
  }
  return [...seen.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

function mergeLists(
  local: UserList[],
  remote: UserList[],
  localMeta: SyncMeta,
  remoteMeta: SyncMeta,
): UserList[] {
  const remoteById = new Map(remote.map((l) => [l.id, l]))
  const out: UserList[] = []
  const seen = new Set<string>()
  for (const ll of local) {
    seen.add(ll.id)
    const rl = remoteById.get(ll.id)
    if (!rl) {
      out.push(ll)
      continue
    }
    // Name is LWW on listname:<id> touch-times; with no recorded rename on
    // either side (or a tie) keep the remote name.
    const nk = `listname:${ll.id}`
    const lt = localMeta.set[nk] ?? ''
    const rt = remoteMeta.set[nk] ?? ''
    const name = lt > rt ? ll.name : rl.name
    // Items: union per list, earliest addedAt wins for duplicates.
    const items = new Map<string, ListItem>()
    for (const it of [...rl.items, ...ll.items]) {
      const k = `${it.type}:${it.id}`
      const prev = items.get(k)
      if (!prev || it.addedAt < prev.addedAt) items.set(k, it)
    }
    out.push({
      id: ll.id,
      name,
      items: [...items.values()].sort((a, b) => (a.addedAt < b.addedAt ? -1 : 1)),
      createdAt: earlier(ll.createdAt, rl.createdAt),
    })
  }
  for (const rl of remote) {
    if (!seen.has(rl.id)) out.push(rl)
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
}

function mergeProfile(
  local: Profile,
  remote: Profile | undefined,
  localMeta: SyncMeta,
  remoteMeta: SyncMeta,
): Profile {
  // Docs from older schemas may lack a profile entirely.
  if (!remote) return local
  const lt = localMeta.set['profile'] ?? ''
  const rt = remoteMeta.set['profile'] ?? ''
  let base: Profile
  if (lt || rt) {
    // Last writer wins once either side has recorded a profile edit.
    base = rt > lt ? remote : local
  } else if (local.name === 'Watcher' && remote.name !== 'Watcher') {
    // Legacy heuristic: prefer a customized profile over the untouched default.
    base = remote
  } else {
    base = local
  }
  return { ...base, joinedAt: earlier(local.joinedAt, remote.joinedAt ?? local.joinedAt) }
}

/** Remove everything the (already merged) tombstone set says is deleted. */
function applyDeletions(data: LibraryData, meta: SyncMeta): LibraryData {
  const shows: Record<number, TrackedShow> = {}
  for (const [idStr, s] of Object.entries(data.shows ?? {})) {
    const id = Number(idStr)
    if (isDeleted(meta, `show:${id}`, s.addedAt)) continue
    const watched: Record<string, WatchRecord> = {}
    let changed = false
    for (const [key, rec] of Object.entries(s.watched ?? {})) {
      if (isDeleted(meta, `ep:${id}:${key}`, rec.watchedAt)) {
        changed = true
        continue
      }
      let out = rec
      if (out.emotion && isDeleted(meta, `emo:${id}:${key}`)) {
        const { emotion: _emo, ...rest } = out
        out = rest
        changed = true
      }
      if (out.favoriteCast && isDeleted(meta, `fc:${id}:${key}`)) {
        const { favoriteCast: _fc, ...rest } = out
        out = rest
        changed = true
      }
      watched[key] = out
    }
    shows[id] = changed ? { ...s, watched } : s
  }

  const movies: Record<number, TrackedMovie> = {}
  for (const [idStr, m] of Object.entries(data.movies ?? {})) {
    const id = Number(idStr)
    if (isDeleted(meta, `movie:${id}`, m.addedAt)) continue
    let out = m
    if (out.watched && isDeleted(meta, `movie-watched:${id}`, out.watched.watchedAt)) {
      out = { ...out, watched: null }
    }
    if (out.watched?.emotion && isDeleted(meta, `emo:m:${id}`)) {
      const { emotion: _emo, ...rest } = out.watched
      out = { ...out, watched: rest }
    }
    if (out.watched?.favoriteCast && isDeleted(meta, `fc:m:${id}`)) {
      const { favoriteCast: _fc, ...rest } = out.watched
      out = { ...out, watched: rest }
    }
    movies[id] = out
  }

  const watchlist = (data.watchlist ?? []).filter(
    (w) => !isDeleted(meta, `wl:${w.type}:${w.id}`, w.addedAt),
  )

  const comments = (data.comments ?? [])
    .filter((c) => !isDeleted(meta, `comment:${c.id}`, c.createdAt))
    .map((c) =>
      c.likedByMe && isDeleted(meta, `like:${c.id}`)
        ? { ...c, likedByMe: false, likes: Math.max(0, c.likes - 1) }
        : c,
    )

  const lists = (data.lists ?? [])
    .filter((l) => !isDeleted(meta, `list:${l.id}`, l.createdAt))
    .map((l) => {
      const items = l.items.filter(
        (it) => !isDeleted(meta, `li:${l.id}:${it.type}:${it.id}`, it.addedAt),
      )
      return items.length === l.items.length ? l : { ...l, items }
    })

  return { ...data, shows, movies, watchlist, comments, lists }
}

/**
 * Deterministic stringify with sorted object keys. The library doc round-trips
 * through a Postgres jsonb column, which does not preserve key order — a plain
 * JSON.stringify comparison therefore saw every pulled doc as "changed" and
 * re-uploaded the full library (and fanned realtime pulls out to every other
 * device) after every pull, even when nothing differed.
 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(',')}]`
  const rec = v as Record<string, unknown>
  const parts: string[] = []
  for (const k of Object.keys(rec).sort()) {
    if (rec[k] === undefined) continue
    parts.push(`${JSON.stringify(k)}:${stableStringify(rec[k])}`)
  }
  return `{${parts.join(',')}}`
}

export function mergeLibraries(local: LibraryData, remote: LibraryData): LibraryData {
  const localMeta = normMeta(local.sync)
  const remoteMeta = normMeta(remote.sync)
  const meta = mergeMeta(localMeta, remoteMeta)
  // Apply tombstones to each side BEFORE the union, so a deleted copy cannot
  // be resurrected and cannot leak stale fields (e.g. an old addedAt) into
  // an item that was legitimately re-added on the other side.
  const l = applyDeletions(local, meta)
  const r = applyDeletions(remote, meta)
  return {
    shows: mergeShows(l.shows ?? {}, r.shows ?? {}, localMeta, remoteMeta),
    movies: mergeMovies(l.movies ?? {}, r.movies ?? {}, localMeta, remoteMeta),
    watchlist: mergeWatchlist(l.watchlist ?? [], r.watchlist ?? []),
    comments: mergeComments(l.comments ?? [], r.comments ?? [], localMeta, remoteMeta),
    profile: mergeProfile(l.profile, r.profile, localMeta, remoteMeta),
    // Older docs have no lists; treat as empty so they merge cleanly.
    lists: mergeLists(l.lists ?? [], r.lists ?? [], localMeta, remoteMeta),
    sync: meta,
  }
}

// ---------- sync engine ----------

let status: SyncStatus = supabase ? { state: 'signed-out' } : { state: 'off' }
const listeners = new Set<Listener>()
let pushTimer: ReturnType<typeof setTimeout> | null = null
let applyingRemote = false
let lastPushed = ''
let initialized = false
let activeUserId: string | null = null
let realtimeUserId: string | null = null

function setStatus(s: SyncStatus) {
  status = s
  for (const l of listeners) l(s)
}

export function getSyncStatus(): SyncStatus {
  return status
}

export function onSyncStatus(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

async function currentUser() {
  if (!supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user ?? null
}

async function push() {
  if (!supabase) return
  const user = await currentUser()
  if (!user) return
  const data = pickData()
  const serialized = JSON.stringify(data)
  if (serialized === lastPushed) return
  setStatus({ state: 'syncing' })
  const { error } = await supabase.from('libraries').upsert({
    user_id: user.id,
    data,
    device_id: deviceId(),
    updated_at: new Date().toISOString(),
  })
  if (error) {
    setStatus({ state: 'error', message: error.message, email: user.email ?? '' })
    return
  }
  lastPushed = serialized
  setStatus({ state: 'synced', at: new Date().toISOString(), email: user.email ?? '' })
}

function schedulePush() {
  if (applyingRemote) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => void push(), 1500)
}

/** Fetch the remote library, merge with local, apply, and push back if needed. */
export async function pullAndMerge(): Promise<void> {
  if (!supabase) return
  const user = await currentUser()
  if (!user) return
  const email = user.email ?? ''
  setStatus({ state: 'syncing' })
  try {
    const { data: row, error } = await supabase
      .from('libraries')
      .select('data')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) {
      setStatus({ state: 'error', message: error.message, email })
      return
    }
    const local = pickData()
    const merged = row?.data ? mergeLibraries(local, row.data as LibraryData) : local
    const mergedStr = stableStringify(merged)
    // Only touch the store (new references for every object = full re-render
    // + localStorage rewrite) when the merge actually changed something.
    if (mergedStr !== stableStringify(local)) {
      if (merged.sync) saveMeta(merged.sync)
      const { sync: _sync, ...slices } = merged
      applyingRemote = true
      useLibrary.setState(slices)
      applyingRemote = false
    }
    setStatus({ state: 'synced', at: new Date().toISOString(), email })
    // If local had anything the remote lacked, push the merged doc back.
    // Key-order-insensitive compare: jsonb does not preserve key order.
    if (mergedStr !== stableStringify(row?.data ?? null)) await push()
  } catch (e) {
    applyingRemote = false
    setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e), email })
  }
}

function subscribeRealtime(userId: string) {
  // supabase-js emits SIGNED_IN repeatedly (tab focus, token refresh); only
  // ever hold one realtime subscription per signed-in user.
  if (!supabase || realtimeUserId === userId) return
  realtimeUserId = userId
  supabase
    .channel('library-sync')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'libraries', filter: `user_id=eq.${userId}` },
      (payload) => {
        const row = payload.new as { device_id?: string }
        if (row.device_id === deviceId()) return // our own push echoing back
        void pullAndMerge()
      },
    )
    .subscribe()
}

/** Idempotent per user: first pull + realtime subscription for a session. */
function connect(user: { id: string; email?: string }) {
  if (activeUserId === user.id) return
  activeUserId = user.id
  // Switching accounts in the same browser: wipe the previous account's local
  // library and tombstones so they are not unioned into (or delete items
  // from) the new account's cloud data.
  const prevUser = lastSyncUser
  if (prevUser && prevUser !== user.id) {
    // Stash what is about to be wiped so the data is recoverable (the local
    // library may include work done while signed out, not just the previous
    // account's copy).
    try {
      const wiped = localStorage.getItem('showtrackr_library')
      if (wiped) localStorage.setItem(WIPED_BACKUP_KEY, wiped)
    } catch {
      // best effort — the wipe below is still required for account isolation
    }
    applyingRemote = true
    useLibrary.getState().resetAll()
    applyingRemote = false
    clearMeta()
    lastPushed = ''
  }
  lastSyncUser = user.id
  try {
    localStorage.setItem(LAST_USER_KEY, user.id)
  } catch {
    // storage unavailable — next session just can't detect an account switch
  }
  void pullAndMerge()
  subscribeRealtime(user.id)
}

/** Wire everything up. Call once at app startup; safe no-op without config. */
export function initSync() {
  if (!supabase || initialized) return
  initialized = true

  useLibrary.subscribe((state, prev) => {
    if (!applyingRemote) recordChanges(prev, state)
    schedulePush()
  })

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      connect(session.user)
    }
    if (event === 'SIGNED_OUT') {
      supabase?.removeAllChannels()
      activeUserId = null
      realtimeUserId = null
      lastPushed = ''
      setStatus({ state: 'signed-out' })
    }
  })

  // Resume an existing session on load.
  void (async () => {
    const user = await currentUser()
    if (user) connect(user)
  })()

  // Re-pull when the tab regains focus (cheap freshness without polling).
  window.addEventListener('focus', () => {
    if (status.state === 'synced') void pullAndMerge()
  })
}

// ---------- auth helpers for the UI ----------

export async function signUp(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Sync is not configured in this build.'
  const { error } = await supabase.auth.signUp({ email, password })
  return error ? error.message : null
}

export async function signIn(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Sync is not configured in this build.'
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return error ? error.message : null
}

export async function signOut(): Promise<void> {
  if (!supabase) return
  await supabase.auth.signOut()
}

export async function syncNow(): Promise<void> {
  await pullAndMerge()
}

/**
 * Forget the last-pushed snapshot so the next push always upserts, even if
 * the local store is byte-identical to what was pushed before. Needed after
 * the cloud row is deleted out-of-band (Account > "Delete cloud copy"),
 * otherwise the dedupe guard in push() would skip the re-upload.
 */
export function invalidateLastPush(): void {
  lastPushed = ''
}
