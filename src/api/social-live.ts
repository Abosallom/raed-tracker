// Real social graph backed by Supabase (profiles / follows / activity tables,
// migration 0002). When Supabase isn't configured, or a query fails, callers
// fall back to the seeded SOCIAL_USERS in social.ts — those exist ONLY for
// demo mode and the cold-start empty state, never for signed-in members.

import { supabase } from './supabase'
import type { ActivityItem, ActivityKind, Emotion, MediaType, SocialUser } from '../types'

interface ProfileRow {
  id: string
  username: string
  avatar: string
  bio: string | null
  joined_at: string
  shows_watched: number
}

function toSocialUser(r: ProfileRow, followerCount = 0): SocialUser {
  return {
    id: r.id,
    name: r.username,
    avatar: r.avatar,
    bio: r.bio ?? '',
    joinedAt: r.joined_at.slice(0, 10),
    showsWatched: r.shows_watched,
    followerCount,
  }
}

/** True when live social data is available (built with Supabase + signed in). */
export function socialLiveEnabled(): boolean {
  return supabase !== null
}

/** Upsert the signed-in member's public profile. Call after sign-in and when
 *  the local profile (name/avatar) changes. No-op when signed out. */
export async function ensureProfile(input: {
  username: string
  avatar: string
  showsWatched: number
}): Promise<void> {
  if (!supabase) return
  const { data } = await supabase.auth.getUser()
  const user = data.user
  if (!user) return
  await supabase
    .from('profiles')
    .upsert(
      {
        id: user.id,
        username: input.username,
        avatar: input.avatar,
        shows_watched: input.showsWatched,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    .then(undefined, () => {
      /* offline / RLS — the seeded fallback covers the UI */
    })
}

/** Follower counts for a set of user ids, in one grouped query. */
async function followerCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!supabase || ids.length === 0) return out
  const { data } = await supabase.from('follows').select('following_id').in('following_id', ids)
  for (const row of (data as { following_id: string }[] | null) ?? []) {
    out.set(row.following_id, (out.get(row.following_id) ?? 0) + 1)
  }
  return out
}

/** All members except the caller (optionally name-filtered). Empty ⇒ caller
 *  should fall back to seeded users. */
export async function fetchProfiles(query?: string): Promise<SocialUser[]> {
  if (!supabase) return []
  const { data: auth } = await supabase.auth.getUser()
  const me = auth.user?.id
  let q = supabase.from('profiles').select('id,username,avatar,bio,joined_at,shows_watched').limit(100)
  if (query && query.trim()) q = q.ilike('username', `%${query.trim()}%`)
  const { data, error } = await q
  if (error || !data) return []
  const rows = (data as ProfileRow[]).filter((r) => r.id !== me)
  const counts = await followerCounts(rows.map((r) => r.id))
  return rows.map((r) => toSocialUser(r, counts.get(r.id) ?? 0))
}

export async function fetchProfile(id: string): Promise<SocialUser | null> {
  if (!supabase) return null
  const { data } = await supabase
    .from('profiles')
    .select('id,username,avatar,bio,joined_at,shows_watched')
    .eq('id', id)
    .maybeSingle()
  if (!data) return null
  const counts = await followerCounts([id])
  return toSocialUser(data as ProfileRow, counts.get(id) ?? 0)
}

/** Ids the caller currently follows. */
export async function fetchFollowingIds(): Promise<string[]> {
  if (!supabase) return []
  const { data: auth } = await supabase.auth.getUser()
  const me = auth.user?.id
  if (!me) return []
  const { data } = await supabase.from('follows').select('following_id').eq('follower_id', me)
  return ((data as { following_id: string }[] | null) ?? []).map((r) => r.following_id)
}

export async function setFollow(userId: string, follow: boolean): Promise<void> {
  if (!supabase) return
  const { data: auth } = await supabase.auth.getUser()
  const me = auth.user?.id
  if (!me || me === userId) return
  if (follow) {
    await supabase.from('follows').upsert({ follower_id: me, following_id: userId })
  } else {
    await supabase.from('follows').delete().eq('follower_id', me).eq('following_id', userId)
  }
}

/** Log a member action to the shared feed. Fire-and-forget; failures are
 *  swallowed (the local library remains the source of truth). */
export async function logActivity(item: {
  kind: ActivityKind
  mediaType: MediaType
  mediaId: number
  mediaName: string
  poster_path: string | null
  season?: number
  episode?: number
  reaction?: string
}): Promise<void> {
  if (!supabase) return
  const { data: auth } = await supabase.auth.getUser()
  const me = auth.user?.id
  if (!me) return
  await supabase
    .from('activity')
    .insert({
      user_id: me,
      kind: item.kind,
      media_type: item.mediaType,
      media_id: item.mediaId,
      media_name: item.mediaName,
      poster_path: item.poster_path,
      season: item.season ?? null,
      episode: item.episode ?? null,
      reaction: item.reaction ?? null,
    })
    .then(undefined, () => {})
}

/** Recent activity from the people the caller follows, newest first. Empty ⇒
 *  caller falls back to the seeded feed. */
export async function fetchLiveFeed(limit = 40): Promise<ActivityItem[]> {
  if (!supabase) return []
  const followingIds = await fetchFollowingIds()
  if (followingIds.length === 0) return []
  const { data } = await supabase
    .from('activity')
    .select('id,user_id,kind,media_type,media_id,media_name,poster_path,season,episode,reaction,created_at')
    .in('user_id', followingIds)
    .order('created_at', { ascending: false })
    .limit(limit)
  const rows = (data as ActivityRow[] | null) ?? []
  if (rows.length === 0) return []
  // Attach author profiles in one query.
  const authorIds = [...new Set(rows.map((r) => r.user_id))]
  const { data: profs } = await supabase
    .from('profiles')
    .select('id,username,avatar,bio,joined_at,shows_watched')
    .in('id', authorIds)
  const byId = new Map<string, SocialUser>()
  for (const p of (profs as ProfileRow[] | null) ?? []) byId.set(p.id, toSocialUser(p))
  return rows
    .filter((r) => byId.has(r.user_id))
    .map((r) => ({
      id: String(r.id),
      user: byId.get(r.user_id)!,
      kind: r.kind,
      mediaType: r.media_type,
      mediaId: r.media_id,
      mediaName: r.media_name,
      poster_path: r.poster_path,
      season: r.season ?? undefined,
      episode: r.episode ?? undefined,
      reaction: (r.reaction as Emotion | null) ?? undefined,
      createdAt: r.created_at,
    }))
}

interface ActivityRow {
  id: number
  user_id: string
  kind: ActivityKind
  media_type: MediaType
  media_id: number
  media_name: string
  poster_path: string | null
  season: number | null
  episode: number | null
  reaction: string | null
  created_at: string
}

/** Real distinct-watcher count for a title (social proof). Null ⇒ fall back to
 *  the vote-count heuristic in social.ts. */
export async function fetchWatcherCount(
  mediaType: MediaType,
  mediaId: number,
): Promise<number | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('media_watcher_count', {
    p_media_type: mediaType,
    p_media_id: mediaId,
  })
  if (error || typeof data !== 'number') return null
  return data
}
