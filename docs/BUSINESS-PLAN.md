# Raed Tracker — All-In Plan
*July 7, 2026 — from source code to market to money*

## 0. Executive summary

TV Time shuts down **July 15, 2026**, orphaning **25M+ users** (26.4M lifetime
installs). Raed Tracker is, today, an 80%-parity clone with a working TV Time
importer, faster than the incumbents' migration paths, private by design, and
already deployed. That is a genuine once-in-a-category window — and it is
**8 days wide**, against competitors (Trakt, Simkl, Showly, Moviebase, TVmaze)
who are already publishing "TV Time alternative" landing pages and importers.

The sobering anchor for every number below: **TV Time itself died because a
free tracker wasn't sustainable and users declined to pay.** Whoever wins the
migration inherits that same economics problem. The plan therefore targets a
**profitable niche**, not the whole 25M: paying households who want private,
family-scale tracking — plus an underserved regional angle (Arabic/MENA
content) no major alternative touches.

Verdict up front: **credible as a profitable indie/side business
($5–40k/yr); not credible as a venture-scale company without social-network
ambitions that history says don't pay here.**

---

## 1. Source code & technical readiness

### Have (shipped)
- 80/100 TV Time parity; the core loop (queue, check-off w/ undo + catch-up,
  upcoming, stats, lists, import) scores 8.5–9/10 across independent audits.
- TV Time importer: dual-source (GDPR zip + TV Time Out JSON), 100%-dated
  records, pre-flight report, idempotent re-runs, per-member.
- PWA with offline, auto-updating SW, install UX; Capacitor scaffold + App
  Store checklist (docs/NATIVE.md); privacy policy; self-serve account
  deletion (edge function).
- Supabase auth + per-user RLS sync with tombstones/LWW merge.

### Blockers before charging money (ordered)
| # | Item | Effort | Notes |
|---|------|--------|-------|
| 1 | **TMDB commercial license** | contract, weeks | Free tier is non-commercial ONLY. Without it there is no legal business. Fallback: TVmaze commercial tier (TV-only) — weaker. |
| 2 | **Open self-signup** | ~1 wk | Today: admin-provisioned members. Need email-verified signup, rate limits, custom SMTP (Resend ~$10/mo). |
| 3 | **TMDB key server-side proxy** | ~1 wk | Key currently ships in the bundle; proxy via edge function + cache = cost control + license compliance. |
| 4 | Payments (RevenueCat + StoreKit/Play) | 1–2 wk | Only after 1–3. |
| 5 | iOS/Android builds via Capacitor | days + review cycles | Mac/Xcode work; checklist done. |
| 6 | Real social layer (optional, phase 3) | 4–8 wk | Follows/activity tables in Supabase. The score's last 20 points — but TV Time proves social ≠ revenue. |

Ongoing infra at small scale: Supabase Pro $25 + SMTP $10 + domain ≈
**$40/mo**; Apple $99/yr; Play $25 once. TMDB commercial license is the
unknown (typically negotiated; budget assumption $0–200/mo at indie scale).

---

## 2. Market

### The moment
- 25M+ displaced users, hard deadline, permanent data deletion — maximum
  urgency, zero acquisition cost for anyone who can catch the exodus.
- Reality check: **Trakt owns the migration narrative** (its importer feeds
  Showly/SeriesGuide/Moviebase/etc.), TVmaze shipped a dedicated importer
  July 2, Simkl is buckling under load. The mass-market land grab is already
  decided; fighting it head-on is lost.

### Competitor map
| Competitor | Model | Weakness to exploit |
|---|---|---|
| Trakt | $30/yr VIP, API hub | Web-first UX, data lives on their servers, nerd-flavored |
| Simkl | freemium | overloaded, dated UX |
| Showly / SeriesGuide | free/donation, Android-lean | depend on Trakt |
| Moviebase / Sofa Time | freemium apps | thin social, generic |
| Serializd / Letterboxd | reviews-social | not episode tracking |

### Positioning (the gap nobody covers)
1. **Private, family-scale tracking** — "your household's tracker": member
   accounts under one owner, no public profiles, no ads, no data resale.
   Post-TV-Time users are freshly burned by "free app dies, data deleted."
   Pitch: *your history, yours, forever — export any time.*
2. **Arabic/MENA first-class** — RTL, Arabic UI, MBC Shahid-era content that
   Western trackers ignore (the founder's own library proves the gap). No
   serious competitor localizes for this. A durable niche of tens of millions
   of viewers, reachable via Arabic tech Twitter/TikTok.
3. **The best TV Time feel** — of all alternatives, this one is the actual
   UX clone (queue, sheets, confetti). Migrating users want *home*, not a new
   paradigm.

### Target audiences (in priority order)
- **A. Displaced TV Time households (global)** — organizes around the July 15
  deadline; values import fidelity + familiar UX. Reachable in r/tvtime,
  the shutdown press comment sections, App Store search "tv time".
- **B. Arabic-speaking trackers (MENA + diaspora)** — underserved; higher
  willingness to pay for something made for them; word-of-mouth dense.
- **C. Privacy-conscious self-hosters/families** — smaller; loud advocates;
  convert via "no ads, no tracking, delete = deleted" story.

---

## 3. Go-to-market

### Phase 0 — the 8-day window (NOW, free tier only; TMDB license pending)
- Ship open signup ASAP (even waitlist-gated), or lean into "request an
  invite" scarcity while provisioning is manual.
- Publish "Import your TV Time history in 5 minutes" (the in-app guide as a
  public landing page + the artifact) targeted at the shutdown searches;
  comment helpfully on the AlternativeTo/TechTimes/Moviebase roundups; post
  the importer demo GIF to r/television, r/tvtime, Arabic tech Twitter.
- The pre-flight report is the demo: "we show you your data is exact
  BEFORE you commit." Nobody else does that.
- Goal: capture emails/accounts, not money. Every import = locked-in user
  (their history lives here now).

### Phase 1 — monetize (weeks 2–8)
- TMDB commercial license signed → turn on payments.
- **Pricing:** free = track up to N shows w/ import intact (never hold data
  hostage — that's the brand); **Premium $19.99/yr or $2.49/mo** (undercut
  Trakt's $30): unlimited household members, deep stats, CSV/JSON export,
  themes, priority requests. **Household $29.99/yr** for 5 members — the
  differentiator nobody sells.
- App Store + Play launch (Capacitor) for search traffic on "tv time".

### Phase 2 — the moat (months 2–6)
- Arabic localization + RTL → own the MENA niche completely.
- Episode notifications (top requested tracker feature).
- Optional: real household social (shared watchlists, "watch together"
  nudges) — social *inside the family*, not a public network. Cheap to build
  on existing Supabase, aligned with the privacy story, and it's the one
  social layer TV Time's failure doesn't indict.

---

## 4. Financial forecast

Assumptions grounded in category history: trackers convert **1–4%** of
active free users to paid; TV Time's 25M couldn't sustain a team — an indie
cost base (~$1k/yr infra + fees) changes the math entirely. Apple/Google take
15% (small-business tier); RevenueCat free tier to start.

| Scenario | Users captured (yr 1) | Paying (conv.) | ARPU | Gross/yr | Net/yr* |
|---|---|---|---|---|---|
| **Floor** (organic only, no license rush) | 2,000 | 40 (2%) | $18 | $720 | ≈ –$500 |
| **Base** (window executed, MENA niche lands) | 25,000 | 625 (2.5%) | $20 | $12,500 | ≈ **$9,500** |
| **Upside** (a roundup features you, household plan works) | 100,000 | 3,500 (3.5%) | $22 | $77,000 | ≈ **$60,000** |

*Net after store fees (15%), infra scaling ($40→$300/mo), TMDB license
assumption, zero salaries. Founder time is the real investment: ~300–500
hours across phases 0–2.*

Sensitivity truths:
- Capturing even 0.1% of 25M = 25k users — the base case needs only that.
- The conversion rate is the killer variable; the **household plan** is the
  bet that moves it (families pay for utilities; individuals don't pay for
  trackers — TV Time proved it).
- If the TMDB license stalls, everything shifts right but the window doesn't
  wait: capture free users NOW, monetize later. Users are the asset.

---

## 5. Risks (ranked)
1. **TMDB refuses/overprices commercial use** → TVmaze fallback (TV-only) or
   stay donation-ware. Mitigate: contact licensing@themoviedb.org TODAY.
2. **Window missed** → Trakt absorbs everyone; you're selling to stragglers.
   Mitigate: phase 0 this week, license paperwork in parallel.
3. **One-founder bus factor / support load** at 25k users → keep scope
   single-player+household; social network scope creep is the death spiral.
4. **Copycat suits**: never use TV Time marks; the UX-pattern similarity is
   fine, branding must stay distinct.
5. App Store rejection (4.2 web-wrapper) → mitigations in docs/NATIVE.md.

## 6. Decision framework
- **Hobby (default today):** do nothing on this list; the app already serves
  the family perfectly. Cost ≈ $0.
- **Side business (recommended if going in):** phases 0–1 only. ~6 weeks of
  evenings, breakeven at ~60 paying users, realistic path to ~$10k/yr.
- **Venture:** requires beating Trakt at social scale — the graveyard TV
  Time is being buried in. Not recommended.

The single action that preserves every option and costs nothing:
**email TMDB licensing today, and publish the import landing page before
July 15.**
