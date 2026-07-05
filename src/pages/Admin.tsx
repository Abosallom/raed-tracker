// Admin console (/admin): add members (username + password), switch between
// admin and watcher modes. Only rendered usefully for admin accounts; the
// server-side gate lives in supabase/functions/admin-create-user.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BackBar } from '../components/BackBar'
import { showToast } from '../components/toast'
import {
  createMember,
  generatePassword,
  isValidUsername,
  setAdminMode,
  useAdminGate,
  usernameToEmail,
} from '../lib/admin'
import './admin.css'

const DASHBOARD_USERS_URL =
  'https://supabase.com/dashboard/project/cjmzwvazmjbsjtsvpiba/auth/users'

function ModeCard({ adminMode }: { adminMode: boolean }) {
  return (
    <section className="card">
      <div className="admin-card-title">🎛️ Mode</div>
      <p className="admin-desc">
        <b>Admin mode</b> shows the 🛡️ shortcuts and this console.{' '}
        <b>Watcher mode</b> hides every admin control so the app feels exactly like it
        does for members — flip back any time by visiting this page.
      </p>
      <div className="admin-mode-row">
        <button
          className={`btn${adminMode ? ' primary' : ''}`}
          onClick={() => {
            setAdminMode(true)
            showToast('Admin mode on', '🛡️')
          }}
        >
          🛡️ Admin mode
        </button>
        <button
          className={`btn${!adminMode ? ' primary' : ''}`}
          onClick={() => {
            setAdminMode(false)
            showToast('Watcher mode — admin controls hidden', '👀')
          }}
        >
          👀 Watcher mode
        </button>
      </div>
    </section>
  )
}

function AddMemberCard() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState(() => generatePassword())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsDeploy, setNeedsDeploy] = useState(false)
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    setNeedsDeploy(false)
    const res = await createMember(username, password)
    setBusy(false)
    if (res.ok) {
      setCreated({ username: username.trim().toLowerCase(), password })
      showToast(`Member "${username.trim()}" created`, '🎉')
      setUsername('')
      setPassword(generatePassword())
    } else if (res.kind === 'function-missing') {
      setNeedsDeploy(true)
    } else {
      setError(res.message)
    }
  }

  return (
    <section className="card">
      <div className="admin-card-title">➕ Add a member</div>
      <p className="admin-desc">
        Pick a username and password for them. Each member gets their own account with a{' '}
        <b>completely separate library</b> — their shows, episodes and stats never mix
        with yours or anyone else's.
      </p>
      <div className="admin-form">
        <input
          placeholder="Username (e.g. raed)"
          value={username}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => setUsername(e.target.value)}
        />
        <div className="admin-pass-row">
          <input
            placeholder="Password"
            value={password}
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            className="btn small"
            onClick={() => setPassword(generatePassword())}
            title="Generate a new password"
          >
            🎲 Generate
          </button>
        </div>
        {username && !isValidUsername(username) && (
          <div className="admin-error">
            3–20 characters: letters, numbers, dots, dashes, underscores.
          </div>
        )}
        {error && <div className="admin-error">{error}</div>}
        <button
          className="btn primary"
          disabled={busy || !isValidUsername(username) || password.length < 6}
          onClick={() => void submit()}
        >
          {busy ? 'Creating…' : 'Create member'}
        </button>
      </div>

      {created && (
        <div className="admin-credentials">
          <div className="admin-credentials-title">✅ Send these to your member</div>
          <code className="admin-credentials-block">
            Username: {created.username}
            {'\n'}Password: {created.password}
            {'\n'}Sign in: Account page → password sign-in
          </code>
          <button
            className="btn small"
            onClick={() => {
              void navigator.clipboard.writeText(
                `Raed Tracker\nUsername: ${created.username}\nPassword: ${created.password}\nSign in on the Account page (password method).`,
              )
              showToast('Credentials copied', '📋')
            }}
          >
            📋 Copy
          </button>
        </div>
      )}

      {needsDeploy && (
        <div className="admin-setup">
          <div className="admin-credentials-title">🔧 One-time setup needed</div>
          <p className="admin-desc">
            Member creation runs through a small server function that isn't deployed yet
            (browser apps can't safely create accounts on their own). Two options:
          </p>
          <ol className="admin-steps">
            <li>
              <b>Deploy the function (2 minutes, once):</b> Supabase Dashboard → Edge
              Functions → Deploy new function → name it <code>admin-create-user</code> →
              paste the file <code>supabase/functions/admin-create-user/index.ts</code>{' '}
              from this project → Deploy. Then retry here.
            </li>
            <li>
              <b>Or add members in the dashboard right now:</b> Authentication → Users →
              Add user → email <code>{isValidUsername(username) ? usernameToEmail(username) : 'username@member.raedtracker.app'}</code>{' '}
              + the password, with <b>Auto Confirm ON</b>.
            </li>
          </ol>
          <a className="btn" href={DASHBOARD_USERS_URL} target="_blank" rel="noreferrer">
            Open Supabase users ↗
          </a>
        </div>
      )}
    </section>
  )
}

export default function Admin() {
  const { email, isAdmin, adminMode } = useAdminGate()

  return (
    <div>
      <BackBar title="Admin" />
      <h1 className="page-title">Admin</h1>

      {!email ? (
        <div className="empty-state">
          <div className="big">🔐</div>
          Sign in first — the admin console unlocks for the admin account.
          <div style={{ marginTop: 10 }}>
            <Link className="btn primary" to="/account">
              Go to sign in
            </Link>
          </div>
        </div>
      ) : !isAdmin ? (
        <div className="empty-state">
          <div className="big">👀</div>
          This area is for the app admin. Enjoy the show!
        </div>
      ) : !adminMode ? (
        <section className="card">
          <div className="admin-card-title">👀 You're in watcher mode</div>
          <p className="admin-desc">
            Admin controls are hidden everywhere. Switch back whenever you want.
          </p>
          <button
            className="btn primary"
            onClick={() => {
              setAdminMode(true)
              showToast('Admin mode on', '🛡️')
            }}
          >
            🛡️ Back to admin mode
          </button>
        </section>
      ) : (
        <div className="admin-stack">
          <ModeCard adminMode={adminMode} />
          <AddMemberCard />
          <section className="card">
            <div className="admin-card-title">👥 Your members</div>
            <p className="admin-desc">
              Each member signs in with their username on the Account page and tracks
              their own shows — libraries are separated per account by the database's
              row-level security. Viewing, resetting passwords, or removing members
              happens in the Supabase dashboard (client apps can't safely hold that
              power).
            </p>
            <a className="btn" href={DASHBOARD_USERS_URL} target="_blank" rel="noreferrer">
              Manage members in Supabase ↗
            </a>
          </section>
        </div>
      )}
    </div>
  )
}
