# Raed Tracker — Admin guide

## Who is the admin?

Accounts whose email is listed in `ADMIN_EMAILS` (`src/lib/admin.ts`, currently
`az.alsaloom@gmail.com`). Sign in with that account and a 🛡️ **Admin** entry
appears in the sidebar and on the Profile shortcuts. The same list is duplicated
in `supabase/functions/admin-members/index.ts` — that server-side copy is the
one that actually enforces security; keep both in sync.

## Managing members — fully in-app

The Admin page handles the entire member lifecycle:

- **Add a member**: pick a username, generate or type a password, create, then
  copy the credentials block and send it to them. Members sign in on the
  **Account** page (password method) by typing the **username** — internally it
  maps to `<username>@member.raedtracker.app`, an address that never receives
  mail (accounts are created pre-confirmed).
- **Members list**: every account with username, join date and last sign-in.
- **🔑 Reset password**: generates a fresh password (their old one stops
  working immediately) with a copyable credentials block.
- **🗑️ Remove member**: deletes the account AND its cloud library (the
  `libraries` row cascades away with the user).

All of it calls the `admin-members` Edge Function, which verifies the caller's
JWT is an admin before using the service-role key. **One-time setup:** deploy
it in the Supabase Dashboard (Edge Functions → Deploy new function → name
`admin-members` → paste `supabase/functions/admin-members/index.ts`) or via
CLI: `npx supabase functions deploy admin-members`.

Until it's deployed, the Admin page shows a fallback: add users directly in the
dashboard (Authentication → Users → Add user, **Auto Confirm ON**) with the
synthetic email shown on screen.

## Separate libraries per member

Every account has its own row in the `libraries` table, protected by row-level
security — each member's shows, watched episodes, stats and lists are fully
private to their account. On a shared device, signing into a different account
safely swaps the local library (the previous one is stashed to
`showtrackr_wiped_library_backup` in localStorage as a safety net).

## Watcher mode

Admin page → **Mode** → Watcher mode hides every admin affordance and makes the
app look exactly like a member's app. Visit `/#/admin` any time to switch back.
The preference is per-device (localStorage `raedtracker_admin_mode`).

## Dashboard fallback

The Supabase dashboard (Authentication → Users) remains available as a
fallback, but is no longer needed for day-to-day member management once the
`admin-members` function is deployed.
