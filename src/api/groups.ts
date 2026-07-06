// Seeded local communities — no backend exists, so groups, their member and
// discussion counts, and their tiles are synthetic and generated deterministically.
// Membership is the only mutable state and lives in localStorage.

export interface Group {
  id: string
  name: string
  emoji: string
  /** Short blurb for the tile. */
  blurb: string
  /** Two-stop accent gradient (CSS color values) for the tile background. */
  gradient: [string, string]
  members: number
  discussions: number
}

/**
 * Seeded communities: genre hubs + franchise-style fan hubs with ORIGINAL
 * names (no trademarked franchise names beyond generic genre words). Counts are
 * hand-tuned so the sort controls have something meaningful to order.
 */
export const GROUPS: Group[] = [
  // --- genre hubs ---
  { id: 'g-anime', name: 'Anime', emoji: '⚡', blurb: 'Subs, dubs, and everything shonen.', gradient: ['#7c3aed', '#db2777'], members: 128400, discussions: 9820 },
  { id: 'g-kdrama', name: 'K-Drama', emoji: '🌸', blurb: '16 episodes of pure heartbreak.', gradient: ['#ec4899', '#f472b6'], members: 96700, discussions: 7410 },
  { id: 'g-horror', name: 'Horror', emoji: '🎃', blurb: 'Lights off. Volume up. Regret later.', gradient: ['#dc2626', '#7c2d12'], members: 74300, discussions: 6120 },
  { id: 'g-sitcoms', name: 'Sitcoms', emoji: '😂', blurb: '22 minutes of joy on repeat.', gradient: ['#f59e0b', '#eab308'], members: 61200, discussions: 4380 },
  { id: 'g-romcom', name: 'Rom-Com', emoji: '💘', blurb: 'They meet cute. We stay up late.', gradient: ['#f472b6', '#fb7185'], members: 52800, discussions: 3910 },
  { id: 'g-scifi', name: 'Sci-Fi', emoji: '🛸', blurb: 'Spaceships, timelines, and big questions.', gradient: ['#0ea5e9', '#6366f1'], members: 89100, discussions: 8240 },
  { id: 'g-truecrime', name: 'True Crime', emoji: '🔍', blurb: 'We solved it before the detectives.', gradient: ['#475569', '#0f172a'], members: 68900, discussions: 7030 },
  { id: 'g-animation', name: 'Animation', emoji: '🎨', blurb: 'Hand-drawn, CG, and stop-motion alike.', gradient: ['#22c55e', '#0ea5e9'], members: 57600, discussions: 4020 },

  // --- franchise-style fan hubs (original names only) ---
  { id: 'g-wizard-world', name: 'Wizard World Fans', emoji: '🪄', blurb: 'Spells, houses, and endless rewatches.', gradient: ['#a16207', '#78350f'], members: 143200, discussions: 12480 },
  { id: 'g-galaxy-far', name: 'Galaxy Far Away', emoji: '🌌', blurb: 'Laser swords and space opera lore.', gradient: ['#1d4ed8', '#312e81'], members: 156800, discussions: 15900 },
  { id: 'g-mouse-house', name: 'Mouse House Classics', emoji: '🏰', blurb: 'Animated classics and modern fairy tales.', gradient: ['#0891b2', '#7c3aed'], members: 112500, discussions: 8760 },
  { id: 'g-hero-league', name: 'Hero League Assemble', emoji: '🦸', blurb: 'Capes, crossovers, and post-credit scenes.', gradient: ['#dc2626', '#1d4ed8'], members: 198400, discussions: 21300 },
  { id: 'g-middle-realm', name: 'Middle Realm Travelers', emoji: '🗺️', blurb: 'Epic quests across a fantasy map.', gradient: ['#166534', '#78350f'], members: 87400, discussions: 9110 },
  { id: 'g-warp-drive', name: 'Warp Drive Crew', emoji: '🖖', blurb: 'Boldly rewatching, one voyage at a time.', gradient: ['#0369a1', '#1e293b'], members: 71600, discussions: 6540 },
  { id: 'g-monster-isle', name: 'Monster Isle Watchers', emoji: '🦖', blurb: 'Giant beasts and even bigger set pieces.', gradient: ['#065f46', '#052e16'], members: 49300, discussions: 3620 },
  { id: 'g-street-racers', name: 'Full Throttle Family', emoji: '🏎️', blurb: 'Fast cars, faster reunions.', gradient: ['#ea580c', '#7c2d12'], members: 64800, discussions: 4870 },
]

export type GroupSort = 'popular' | 'az' | 'members'

// ---------- joined membership (localStorage, best-effort) ----------

const JOINED_KEY = 'raedtracker_groups_joined'

export function loadJoined(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(JOINED_KEY) ?? '[]')
    return new Set(
      Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [],
    )
  } catch {
    return new Set()
  }
}

export function saveJoined(ids: Set<string>): void {
  try {
    localStorage.setItem(JOINED_KEY, JSON.stringify([...ids]))
  } catch {
    /* storage is best-effort */
  }
}

/**
 * Order groups by the chosen sort, then float joined groups to the top while
 * preserving that order within each partition.
 */
export function sortGroups(groups: Group[], sort: GroupSort, joined: Set<string>): Group[] {
  const base = [...groups]
  if (sort === 'az') base.sort((a, b) => a.name.localeCompare(b.name))
  else if (sort === 'members') base.sort((a, b) => b.members - a.members)
  else base.sort((a, b) => b.members + b.discussions - (a.members + a.discussions))

  const inGroup = base.filter((g) => joined.has(g.id))
  const rest = base.filter((g) => !joined.has(g.id))
  return [...inGroup, ...rest]
}
