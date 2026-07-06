// Privacy policy — required for App Store / Play Store listings, linked from
// Settings. Plain-language and truthful: keep in sync with what the app
// actually collects if features change.

import { BackBar } from '../components/BackBar'

const UPDATED = 'July 6, 2026'

export default function Privacy() {
  return (
    <div style={{ maxWidth: 680 }}>
      <BackBar title="Privacy" />
      <h1 className="page-title">Privacy policy</h1>
      <p className="page-subtitle">Last updated {UPDATED}</p>

      <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, lineHeight: 1.65 }}>
        <p>
          <b>What we store.</b> Your account is an email (or member username) and a password,
          handled by Supabase Auth. Your library — the shows, episodes, movies, reactions,
          ratings, lists and watch dates you track — is stored on this device and, when you sign
          in, synced to a private row in our database that only your account can read or write.
        </p>
        <p>
          <b>What we don&apos;t do.</b> No ads, no trackers, no analytics, no selling or sharing
          of data with third parties. Comments and the activity feed are generated locally; your
          library is never visible to other members.
        </p>
        <p>
          <b>Third-party services.</b> Show and movie information and artwork come from{' '}
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
            The Movie Database (TMDB)
          </a>
          . Requests to TMDB include the title being looked up but never your identity or
          library. This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
        <p>
          <b>Your controls.</b> You can export nothing-hidden data (it&apos;s all visible in the
          app), delete the cloud copy of your library, or permanently delete your account and
          all its data yourself from the Account page. Local data can be wiped from Settings →
          Data → Reset.
        </p>
        <p>
          <b>Contact.</b> Questions or requests: the app administrator listed on your invite.
        </p>
      </div>
    </div>
  )
}
