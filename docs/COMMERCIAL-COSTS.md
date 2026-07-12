# Going commercial — what it costs you

Concrete numbers (USD, mid-2026). "Commercial" = charging money, running ads,
or otherwise operating as a business rather than a free family app.

## The one true blocker — TMDB license
Everything in the app (titles, posters, metadata) comes from **TMDB**, whose
free API is **non-commercial only**. Charging or running ads without a
commercial license breaks the terms the whole app depends on.
- **TMDB commercial license: negotiated, not published.** Indie/small tiers
  have historically landed around **$0–500/mo** depending on call volume and
  use; you email `licensing@themoviedb.org`. **Budget $0–200/mo to start;
  treat as the gating unknown.** Until signed, stay free.
- Alternatives if terms don't fit: **TVmaze** (has a commercial tier, ~$$/mo,
  TV-only, no movies), Gracenote/TiVo (enterprise-priced, overkill).

## Fixed / recurring costs

| Item | Cost | When |
|---|---|---|
| Apple Developer Program | **$99 / year** | Required now (you have it) |
| Google Play Console | **$25 one-time** | Only if you ship Android |
| Domain (raedtracker.app or similar) | **~$12–40 / year** | Optional but recommended for a brand |
| Supabase Pro | **$25 / month** | Needed past the free tier (pauses inactive projects, low limits) |
| Custom SMTP (Resend / Postmark) | **~$0–20 / month** | Reliable sign-in / OTP email at scale (free tiers cover early on) |
| Error monitoring (Sentry) | **$0** free tier | Optional |
| GitHub Pages hosting (web app) | **$0** | Already free |

**Baseline to operate commercially: ≈ `$99/yr Apple` + `$25/mo Supabase` +
`~$15/mo SMTP` + `~$25/yr domain` + `TMDB license (unknown, budget $0–200/mo)`
= roughly `$40–90/month` running, plus one-time setup.**

## Per-sale costs (the store's cut)
When you charge, Apple/Google take a commission on every transaction:
- **15%** under $1M/yr revenue (Apple Small Business Program — you qualify) and
  on year-2+ auto-renewing subscriptions. **30%** only above $1M/yr.
- Google Play: same **15% / 30%** structure.
- **RevenueCat** (handles receipts/subscriptions across both stores): **free**
  up to ~$2.5k/mo tracked revenue, then ~1% of revenue.

So on a **$20/yr** subscription you net **~$17** after Apple's 15%.

## One-time / your-time costs (not cash)
- Server-side TMDB proxy (move the key out of the client, add caching/rate
  limits) — a few hours.
- Terms of Service page, self-serve data export button (deletion already built).
- Store assets: icon (done), screenshots (done), copy (done).
- Founder time across launch: **~300–500 hours** (already largely spent).

## Break-even math
At the **$20/yr Premium** price (nets ~$17 after Apple):
- Running cost of **~$60/mo = $720/yr** → break-even at **~43 paying users**.
- With a TMDB license at **$200/mo**, cost **~$260/mo = $3,120/yr** →
  break-even at **~184 paying users**.

That's the whole picture: **your cash exposure is small (tens of dollars a
month) until the TMDB license and scale kick in; the store takes 15% of each
sale; and you break even in the low-hundreds of paying users.** Full market
plan and forecasts are in [BUSINESS-PLAN.md](BUSINESS-PLAN.md).
