// Account management: OTP sign-in, credentials, sessions, and cloud data.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { isSyncAvailable } from '../api/supabase'
import {
  changeEmail,
  changePassword,
  deleteCloudData,
  getAccountInfo,
  sendOtp,
  signOutEverywhere,
  verifyOtp,
  type AccountInfo,
} from '../store/auth'
import { getSyncStatus, onSyncStatus, signIn, signOut, syncNow, type SyncStatus } from '../store/sync'
import { showToast } from '../components/toast'
import { timeAgo } from '../components/shared'
import { BackBar } from '../components/BackBar'
import { usernameToEmail } from '../lib/admin'
import './account.css'

// ---------- signed-out: OTP-first sign in ----------

function SignInFlow() {
  const [method, setMethod] = useState<'otp' | 'password'>('otp')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [stage, setStage] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requestCode = async () => {
    setBusy(true)
    setError(null)
    const err = await sendOtp(email.trim())
    setBusy(false)
    if (err) setError(err)
    else {
      setStage('code')
      showToast(`Code sent to ${email.trim()}`, '📨')
    }
  }

  const confirmCode = async () => {
    setBusy(true)
    setError(null)
    const err = await verifyOtp(email.trim(), code)
    setBusy(false)
    if (err) setError(err)
    else showToast('Signed in — syncing your library', '☁️')
  }

  const passwordSubmit = async () => {
    setBusy(true)
    setError(null)
    // Members sign in with the username the admin gave them — usernames map
    // to their account's internal address. Sign-in ONLY: member accounts are
    // provisioned exclusively by the admin (admin-create-user edge function);
    // open self-signup would allow username squatting on the synthetic domain
    // and signing arbitrary real addresses up to confirmation emails.
    const identity = email.includes('@') ? email.trim() : usernameToEmail(email)
    const err = await signIn(identity, password)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <div className="card account-signin">
      <div className="account-card-title">🔐 Sign in</div>
      <p className="account-desc">
        One account keeps your library in sync on every device. Sign in with a one-time
        code — no password to remember.
      </p>

      {method === 'otp' ? (
        stage === 'email' ? (
          <div className="account-form">
            <input
              type="email"
              placeholder="Email"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && email.includes('@')) void requestCode()
              }}
            />
            {error && <div className="account-error">{error}</div>}
            <div className="account-actions">
              <button
                className="btn primary"
                disabled={busy || !email.includes('@')}
                onClick={() => void requestCode()}
              >
                {busy ? 'Sending…' : '📨 Email me a code'}
              </button>
              <button className="btn small" onClick={() => setMethod('password')}>
                Use a password instead
              </button>
            </div>
          </div>
        ) : (
          <div className="account-form">
            <p className="account-desc">
              Enter the 6-digit code sent to <b>{email.trim()}</b>. It expires after a few
              minutes.
            </p>
            <input
              className="account-otp-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.length === 6) void confirmCode()
              }}
            />
            {error && <div className="account-error">{error}</div>}
            <div className="account-actions">
              <button
                className="btn primary"
                disabled={busy || code.length !== 6}
                onClick={() => void confirmCode()}
              >
                {busy ? 'Verifying…' : 'Verify & sign in'}
              </button>
              <button className="btn small" disabled={busy} onClick={() => void requestCode()}>
                Resend code
              </button>
              <button
                className="btn small"
                onClick={() => {
                  setStage('email')
                  setCode('')
                  setError(null)
                }}
              >
                Change email
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="account-form">
          <input
            type="text"
            placeholder="Email or username"
            value={email}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password (min 6 characters)"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && email && password.length >= 6) void passwordSubmit()
            }}
          />
          <p className="account-hint">
            Got a username and password from the admin? Enter them here — your library is
            your own, separate from every other member.
          </p>
          {error && <div className="account-error">{error}</div>}
          <div className="account-actions">
            <button
              className="btn primary"
              disabled={busy || email.trim().length < 3 || password.length < 6}
              onClick={() => void passwordSubmit()}
            >
              {busy ? 'Working…' : 'Sign in'}
            </button>
            <button className="btn small" onClick={() => setMethod('otp')}>
              Use a code instead
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- signed-in: account management ----------

function ManageAccount({ info, status }: { info: AccountInfo; status: SyncStatus }) {
  const [newPassword, setNewPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (key: string, fn: () => Promise<string | null>, okMsg: string) => {
    setBusy(key)
    const err = await fn()
    setBusy(null)
    if (err) showToast(err, '⚠️')
    else showToast(okMsg, '✅')
  }

  return (
    <>
      <div className="card">
        <div className="account-card-title">👤 Your account</div>
        <div className="account-rows">
          <div className="account-row">
            <span className="account-row-label">Email</span>
            <span>{info.email}</span>
          </div>
          <div className="account-row">
            <span className="account-row-label">Member since</span>
            <span>{new Date(info.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="account-row">
            <span className="account-row-label">Last sign-in</span>
            <span>{info.lastSignInAt ? timeAgo(info.lastSignInAt) : '—'}</span>
          </div>
          <div className="account-row">
            <span className="account-row-label">Cloud library</span>
            <span>
              {status.state === 'synced' ? `Synced ${timeAgo(status.at)} ✓` : status.state}
            </span>
          </div>
        </div>
        <div className="account-actions" style={{ marginTop: 12 }}>
          <button className="btn small" onClick={() => void syncNow()}>
            ☁️ Sync now
          </button>
          <button className="btn small danger" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>

      <div className="card">
        <div className="account-card-title">🔑 Security</div>
        <div className="account-form-row">
          <input
            type="password"
            placeholder="New password (min 6 characters)"
            value={newPassword}
            autoComplete="new-password"
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <button
            className="btn"
            disabled={busy !== null || newPassword.length < 6}
            onClick={() =>
              void run('pw', () => changePassword(newPassword), 'Password updated').then(() =>
                setNewPassword(''),
              )
            }
          >
            {busy === 'pw' ? 'Saving…' : 'Set password'}
          </button>
        </div>
        <p className="account-hint">
          Setting a password lets you sign in without waiting for an email code.
        </p>
        <div className="account-form-row">
          <input
            type="email"
            placeholder="New email address"
            value={newEmail}
            autoComplete="email"
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <button
            className="btn"
            disabled={busy !== null || !newEmail.includes('@')}
            onClick={() =>
              void run(
                'email',
                () => changeEmail(newEmail.trim()),
                'Check both inboxes to confirm the change',
              ).then(() => setNewEmail(''))
            }
          >
            {busy === 'email' ? 'Saving…' : 'Change email'}
          </button>
        </div>
        <div className="account-actions" style={{ marginTop: 14 }}>
          <button
            className="btn small"
            disabled={busy !== null}
            onClick={() => {
              if (window.confirm('Sign out on every device, including this one?'))
                void run('all', signOutEverywhere, 'Signed out everywhere')
            }}
          >
            Sign out on all devices
          </button>
        </div>
      </div>

      <div className="card">
        <div className="account-card-title">🗄️ Cloud data</div>
        <p className="account-desc">
          Your library is stored under this account and merged across devices. Deleting the
          cloud copy keeps everything on this device but wipes the server — the next sync
          re-uploads this device's library.
        </p>
        <div className="account-actions">
          <button
            className="btn small danger"
            disabled={busy !== null}
            onClick={() => {
              if (window.confirm('Delete the cloud copy of your library?'))
                void run('cloud', deleteCloudData, 'Cloud copy deleted')
            }}
          >
            Delete cloud copy
          </button>
        </div>
        <p className="account-hint">
          To delete the account itself, an administrator can remove it in the Supabase
          dashboard (Authentication → Users).
        </p>
      </div>
    </>
  )
}

// ---------- page ----------

export default function Account() {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus())
  const [info, setInfo] = useState<AccountInfo | null>(null)

  useEffect(() => onSyncStatus(setStatus), [])

  const signedIn =
    status.state === 'synced' ||
    status.state === 'syncing' ||
    (status.state === 'error' && status.email !== undefined)

  useEffect(() => {
    if (signedIn) void getAccountInfo().then(setInfo)
    else setInfo(null)
  }, [signedIn])

  if (!isSyncAvailable()) {
    return (
      <div>
        <BackBar title="Account" />
        <h1 className="page-title">Account</h1>
        <div className="empty-state">
          <div className="big">🔌</div>
          Cloud accounts are not configured in this build.
          <div style={{ marginTop: 8 }}>
            <Link to="/settings" className="btn small">
              Settings
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <BackBar title="Account" />
      <h1 className="page-title">Account</h1>
      <p className="page-subtitle">Sign-in, security and your cloud library.</p>
      <div className="account-stack">
        {signedIn && info ? <ManageAccount info={info} status={status} /> : !signedIn ? <SignInFlow /> : null}
      </div>
    </div>
  )
}
