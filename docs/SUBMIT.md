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

## You do (≈30–40 min + Apple's review)

### 1. Upload the binary
Pick one:
- **Transporter app** (easiest): download from the Mac App Store, sign in with
  your Apple ID, drag in `ios/App/build/export/App.ipa`, Deliver.
- **Command line**: create an App Store Connect API key at App Store Connect →
  Users and Access → Integrations → App Store Connect API → “+”. Download the
  `AuthKey_XXXX.p8` to `~/.appstoreconnect/private_keys/`, then:
  ```
  xcrun altool --upload-app -f ios/App/build/export/App.ipa -t ios \
    --apiKey XXXX --apiIssuer <issuer-uuid>
  ```
- **Xcode**: `open ios/App/App.xcodeproj` → Product → Archive → Distribute App
  → App Store Connect → Upload.

The build takes ~10 min to finish processing before it appears under the app.

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
