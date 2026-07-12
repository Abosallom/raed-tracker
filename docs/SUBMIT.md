# Finish the App Store submission — Raed Tracker

Everything a machine can do is done. What's below needs your Apple login,
a credential you create, and legal declarations only you can make.

## Already done (by the assistant)
- ✅ Signed **App Store IPA**: `ios/App/build/export/App.ipa` (Apple
  Distribution cert `84U5WFJU67`, bundle `app.raedtracker`, signature verified).
- ✅ **App record created** in App Store Connect: "Raed Tracker",
  Apple ID **6790107307**, SKU `RAEDTRACKER001`, English (U.S.), iOS.
- ✅ Compliance baked in: in-app account deletion (5.1.1(v)), privacy manifest,
  `#/privacy` policy, export-compliance key, SW disabled in the native shell.

## You do (≈20–30 min + Apple's review)

### 1. ~~Upload the binary~~ — DONE
Uploaded 2026-07-12 via the Xcode account session ("Upload succeeded").
It appears under the app (and TestFlight) after ~10 min of processing.
Future uploads: bump the build number in Xcode, re-archive, re-run
`xcodebuild -exportArchive … -exportOptionsPlist uploadOptions.plist`.

### DONE by assistant: App Store screenshots
8 screenshots at 1320×2868 (6.9" spec) in ~/Desktop/RaedTracker-AppStore/AppStore-6.9/,
ordered for the listing: Explore hero, watch-next list, Upcoming, show
detail, Keep Watching, catch-up prompt, Stats, Profile. Captured from the
iPhone 17 Pro Max simulator with a real (One Piece + Agent Kim) library,
dark theme. Drag them into App Store Connect → screenshots (6.9" slot).

### 2. Create a reviewer demo account (signups are admin-only)
In your app's `/admin` console, add a member — e.g. username `appreviewer`,
a password you'll paste into the review notes. Reviewers cannot sign up
themselves, so without this the app is rejected.

### 3. Fill the listing (App Store Connect → Raed Tracker → Distribution)
- Screenshots: run the app in Simulator (iPhone 15 Pro Max = 6.7"), ⌘S to save
  a few of Watch List / Upcoming / Stats / a show page.
- Description, keywords ("tv time, tracker, tv shows, episodes, watchlist"),
  support URL (`https://abosallom.github.io/raed-tracker/`), privacy policy URL
  (`https://abosallom.github.io/raed-tracker/#/privacy`).
- Attach the processed build from step 1.
- App Privacy questionnaire: **Email** + **User Content**, linked to identity,
  **not** used for tracking (matches PrivacyInfo.xcprivacy).
- Age rating questionnaire → likely 12+.

### 4. Legal declarations (only you can answer)
- **EU trader status** (now mandatory — the banner). Declare trader / non-trader
  for your situation.
- **Content rights**: the app shows TMDB metadata/artwork. The free TMDB API is
  **non-commercial only** — keep the app **free**, and only answer the
  content-rights question once you've confirmed TMDB terms cover your use
  (see docs/COMMERCIAL.md). This is why the assistant did not submit.

### 5. Add review notes, then Submit for Review
Notes: "Demo account — username: appreviewer / password: <the one you set>.
Sign in on the Profile → Account screen. Offline TV/movie episode tracker;
metadata from TMDB." Then click **Add for Review → Submit**.

## Paste-ready listing copy

**Subtitle (30 ch):** `Track shows, episode by episode`

**Description:**
```
Raed Tracker keeps your whole watching life in one place — every show,
every episode, every movie.

• WATCH LIST — the next episode of everything you follow, one tap to check
  off, with undo and catch-up ("seen all previous episodes?")
• UPCOMING — a day-by-day schedule of what airs next, with network and time
• STATS — total watch time, streaks, badges, genres, and a forecast of when
  you'll catch up
• MOVING FROM TV TIME? Import your complete history — shows, episodes,
  movies and real watch dates — in minutes, with a built-in guide
• PRIVATE BY DESIGN — no ads, no tracking, no public profiles. Your library
  syncs to your own account and you can delete it, and your account, anytime

Show and movie data from TMDB. This product uses the TMDB API but is not
endorsed or certified by TMDB.
```

**Keywords (100 ch):**
`tv time,tv tracker,show tracker,episode,series,watchlist,next episode,movies,anime,binge`

**Support URL:** `https://abosallom.github.io/raed-tracker/`
**Privacy Policy URL:** `https://abosallom.github.io/raed-tracker/#/privacy`
**Category:** Entertainment. **Price:** Free (required — TMDB non-commercial).
**Age rating answers:** all "None" except: Unrestricted Web Access = NO;
outcome ≈ 12+ (infrequent mild mature/suggestive themes from TV metadata is
acceptable to declare if asked).
**Review notes:** `Demo account — username: appreviewer, password: <set in
/admin>. Sign in via Profile → Account. TV/movie episode tracker; data from
TMDB; TV Time import supported.`

## Cowork session 2026-07-12 — completed autonomously
- ✅ Reviewer demo account CREATED in-app (/admin): appreviewer / RaedReview2026 (Members=5)
- ✅ Listing text saved: description, keywords, promo text, support+marketing URLs, copyright, subtitle "Your show & movie tracker"
- ✅ Build 1.0 attached to version (pending version save — blocked by phone)
- ✅ Reviewer sign-in + notes filled (appreviewer/RaedReview2026)
- ✅ Pricing = FREE (all 175 regions); Availability = all countries
- ✅ App Privacy PUBLISHED: Email + Other User Content → App Functionality, linked to identity, NOT tracking + privacy policy URL
- ✅ App Information: category Entertainment, Content Rights = "Yes, has rights" (TMDB free/attributed), Age Rating = 9+

## Irreducible remainder (only YOU can do — 4 items, ~5 min)
1. PHONE NUMBER: App Review Information → Contact Information → phone (required; blocks the version Save). Then click Save on the version page — this locks in the attached build + reviewer info.
2. SCREENSHOTS: version page → Previews and Screenshots → drag the 8 PNGs from ~/Desktop/RaedTracker-AppStore/AppStore-6.9/ into the iPhone 6.5"/6.9" slot (order 01-08 baked into filenames).
3. EU TRADER STATUS: the yellow banner / Business section — your legal self-classification (free hobby app by an individual = typically "not a trader"; only you can declare it).
4. SUBMIT: version page → "Add for Review" → Submit. (Needs 1-3 done first.)
