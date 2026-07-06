# Going commercial with Raed Tracker

What changes the moment money is involved (paid app, subscriptions, or ads).

## 1. TMDB licensing — THE blocker

Everything in the app (metadata, posters, stills) comes from TMDB. The free
API is licensed for **non-commercial use only**. Charging for the app, taking
subscriptions, or running ads requires a **TMDB commercial license**:
https://www.themoviedb.org/documentation/api — "For Business" / contact
licensing@themoviedb.org. Until that's signed, keep the app free.
Requirements that apply either way: show the TMDB attribution (already in
Settings and /privacy) and don't imply TMDB endorsement.

Alternative data sources if TMDB terms don't fit: TiVo/Rovi, Gracenote (both
enterprise-priced), or TVmaze (has a commercial tier, TV-only, no movies).

## 2. Accounts & stores

- Apple Developer Program — $99/yr (required for App Store / TestFlight).
- Google Play Console — $25 one-time (if Android).
- D-U-N-S number if publishing as a company rather than an individual.
- App Store "paid apps" contract + banking/tax forms in App Store Connect.

## 3. Legal minimum

- Privacy policy — exists (/privacy); host it at a stable URL and keep it true.
- Terms of service — needed once people pay (refunds, acceptable use,
  termination). One page is fine.
- GDPR/CCPA basics: self-serve deletion (built), data export (the library is
  the user's own data — an "export JSON" button would complete this), a
  contact address for data requests.
- The name "Raed Tracker" — do a quick trademark search before spending on
  branding. Never use TV Time's name/logo in store listings.

## 4. Infrastructure that must grow up

- Supabase free tier → Pro (~$25/mo): the free tier pauses inactive projects
  and rate-limits auth emails (already bitten by OTP limits — memory: custom
  SMTP was deferred). Custom SMTP (Resend/Postmark, ~$10/mo) for reliable
  sign-in emails.
- Open self-signup with email verification (today: admin-provisioned members
  only — fine for family, not for customers).
- Rate-limit the edge functions; they're deployed with public CORS.
- The TMDB key ships in the client bundle. For commercial scale, proxy TMDB
  through an edge function so the key stays server-side and you can cache +
  rate-limit centrally.
- Error monitoring (Sentry free tier) + uptime check on the Pages site.

## 5. Monetization shapes that fit this app

- **One-time purchase** (simplest; Apple takes 15% under $1M/yr via the Small
  Business Program).
- **Freemium**: free tracking, paid extras (stats deep-dives, multiple
  profiles, CSV export). Needs StoreKit/Play Billing via Capacitor plugins
  (e.g. RevenueCat — free tier covers small volume, handles receipts on both
  stores).
- Avoid ads: they'd require consent banners (GDPR), an ATT prompt on iOS, and
  they clash with the private-by-design privacy story.

## 6. Pre-launch checklist

- [ ] TMDB commercial license signed (or data source swapped)
- [ ] Apple Developer account + app record, bundle id `app.raedtracker`
- [ ] delete-account edge function deployed (App Store 5.1.1(v))
- [ ] Terms of service page + support email
- [ ] Supabase Pro + custom SMTP + open signup with verification
- [ ] TMDB proxied server-side, key out of the bundle
- [ ] Store assets: icon 1024, screenshots, description, keywords
- [ ] Demo/reviewer account credentials in App Store Connect notes
