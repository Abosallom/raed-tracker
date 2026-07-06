# Shipping Raed Tracker as a native app (Capacitor)

The web app wraps cleanly with [Capacitor](https://capacitorjs.com) — the same
codebase runs inside a native iOS/Android shell with no rewrite. Everything
below runs on Aziz's Mac; nothing here is needed for the GitHub Pages PWA.

## One-time setup

```bash
npm i -D @capacitor/cli
npm i @capacitor/core @capacitor/ios @capacitor/android
npx cap init "Raed Tracker" app.raedtracker --web-dir dist
npm run build
npx cap add ios       # needs Xcode installed
npx cap add android   # needs Android Studio (optional)
```

Capacitor reads `capacitor.config.json` (already in the repo). After every web
build: `npx cap sync`.

## iOS build & TestFlight

1. `npx cap open ios` → opens Xcode.
2. Signing & Capabilities → set your Team (needs an
   [Apple Developer account](https://developer.apple.com/programs/), $99/yr).
3. App icons: drop the 1024px master into Assets.xcassets (Xcode generates the
   set). Reuse the PWA icon artwork.
4. Product → Archive → Distribute → App Store Connect → TestFlight first.

## App Store review checklist (state as of July 2026)

- [x] **Account deletion in-app** (guideline 5.1.1(v)) — Account page →
      "Delete my account" → `supabase/functions/delete-account` (DEPLOY IT
      first: Dashboard → Edge Functions → new function `delete-account` →
      paste the file).
- [x] **Privacy policy URL** — https://abosallom.github.io/raed-tracker/#/privacy
      (also fill App Store Connect's privacy "nutrition label": data collected =
      email + user content (library), linked to identity, not used for tracking).
- [x] No third-party login → **Sign in with Apple NOT required**.
- [x] No tracking/ads → App Tracking Transparency not needed.
- [ ] **Don't ship a bare web wrapper impression**: reviewers reject "just a
      website" (guideline 4.2). The app already feels native (offline, haptic-
      style motion, bottom tabs); mention offline tracking + episode logging in
      the review notes.
- [ ] Sign-ups are admin-provisioned. Reviewers need a way in: create a demo
      member account and put its credentials in App Store Connect review notes.
      The signed-out demo mode also works as a reviewer path.
- [ ] Screenshots for 6.7" and 5.5" iPhones (+ iPad if you enable iPad).
- [ ] Age rating questionnaire (content is TMDB metadata → 12+ typically).

## Gotchas

- The service worker is unnecessary inside Capacitor (native shell caches);
  it's harmless, but if update prompts get weird, gate `initPwa()` behind
  `!Capacitor.isNativePlatform()`.
- Deep links: HashRouter URLs work as-is inside the shell.
- TMDB key ships in the bundle either way — see docs/COMMERCIAL.md before
  charging money.
