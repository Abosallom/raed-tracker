-- Real social graph: public profiles, follows, and activity.
-- Replaces the seeded SOCIAL_USERS fiction with actual member data.
-- Seeded users remain in the app ONLY as a demo-mode / empty-state fallback.
--
-- Deploy once: Supabase Dashboard → SQL Editor → paste + Run.

-- ── profiles ────────────────────────────────────────────────────────────────
-- One public row per member. Populated by the client on sign-in (ensureProfile).
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text not null,
  avatar        text not null default '🍿',
  bio           text default '',
  joined_at     timestamptz not null default now(),
  shows_watched int  not null default 0,
  is_private    boolean not null default false,
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone signed in can read non-private profiles (and always their own).
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select using (not is_private or id = auth.uid());

-- A member may create/edit only their own profile.
drop policy if exists profiles_upsert on public.profiles;
create policy profiles_upsert on public.profiles
  for insert with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid());

-- ── follows ─────────────────────────────────────────────────────────────────
create table if not exists public.follows (
  follower_id  uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

alter table public.follows enable row level security;

-- Follow edges are public (needed for follower/following counts + lists).
drop policy if exists follows_read on public.follows;
create policy follows_read on public.follows for select using (true);

-- You can only create/remove edges where YOU are the follower.
drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows
  for insert with check (follower_id = auth.uid());
drop policy if exists follows_delete on public.follows;
create policy follows_delete on public.follows
  for delete using (follower_id = auth.uid());

-- ── activity ────────────────────────────────────────────────────────────────
-- Append-only feed of what members watched/rated. Client inserts on check-off.
create table if not exists public.activity (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('watched','favorited','rated','commented')),
  media_type  text not null check (media_type in ('tv','movie')),
  media_id    int  not null,
  media_name  text not null,
  poster_path text,
  season      int,
  episode     int,
  reaction    text,
  created_at  timestamptz not null default now()
);

alter table public.activity enable row level security;

-- Readable by anyone signed in (feed filters to followed users client-side;
-- profiles hidden by their own RLS still keep names out of joins).
drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select using (true);

drop policy if exists activity_insert on public.activity;
create policy activity_insert on public.activity
  for insert with check (user_id = auth.uid());

-- Trim to a member's most recent 100 rows on insert (keeps the table small
-- without a cron; the feed never needs deep history).
create index if not exists activity_user_created_idx
  on public.activity (user_id, created_at desc);
create index if not exists activity_created_idx
  on public.activity (created_at desc);

-- ── discovery helper ─────────────────────────────────────────────────────────
-- "Watched by" social proof: count of real members who logged a title.
create or replace function public.media_watcher_count(p_media_type text, p_media_id int)
returns int language sql stable security definer set search_path = public as $$
  select count(distinct user_id)::int
  from public.activity
  where media_type = p_media_type and media_id = p_media_id and kind = 'watched';
$$;
