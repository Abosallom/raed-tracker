// Thin cloud-sync status card for Settings. Full sign-in / account management
// lives on the Account page (src/pages/Account.tsx).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSyncStatus, onSyncStatus, syncNow, type SyncStatus } from '../store/sync'
import { timeAgo } from './shared'
// Defines the settings-* classes used below, so this card is styled even when
// rendered outside the Settings page.
import '../pages/settings.css'

export function AccountSyncCard() {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus())
  useEffect(() => onSyncStatus(setStatus), [])

  const signedIn =
    status.state === 'synced' ||
    status.state === 'syncing' ||
    (status.state === 'error' && status.email !== undefined)

  let line: string
  switch (status.state) {
    case 'off':
      line =
        'Cloud sync is not configured in this build — your library lives in this browser only.'
      break
    case 'signed-out':
      line = 'Not signed in. Sign in to back up your library and sync it across devices.'
      break
    case 'syncing':
      line = 'Syncing…'
      break
    case 'synced':
      line = `Signed in as ${status.email} — synced ${timeAgo(status.at)}.`
      break
    case 'error':
      line = `Sync error: ${status.message}`
      break
  }

  return (
    <section className="card">
      <div className="settings-card-head">
        <div className="settings-card-title">Account & sync</div>
        <span className="settings-status">
          <span
            className="settings-dot"
            style={{
              background:
                status.state === 'synced'
                  ? 'var(--green)'
                  : status.state === 'error'
                    ? 'var(--red)'
                    : 'var(--yellow)',
            }}
          />
          {status.state === 'synced' ? 'Synced ✓' : status.state}
        </span>
      </div>
      <p className="settings-card-desc">{line}</p>
      {status.state !== 'off' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn primary" to="/account">
            {signedIn ? 'Manage account' : 'Sign in / create account'}
          </Link>
          {signedIn && (
            <button className="btn" onClick={() => void syncNow()}>
              Sync now
            </button>
          )}
        </div>
      )}
    </section>
  )
}
