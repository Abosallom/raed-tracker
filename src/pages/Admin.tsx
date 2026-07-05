// Admin console (/admin): manage members fully in-app (list, add, reset
// password, remove), switch between admin and watcher modes. Only rendered
// usefully for admin accounts; the server-side gate lives in
// supabase/functions/admin-members.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BackBar } from '../components/BackBar'
import { showToast } from '../components/toast'
import { confirm } from '../components/confirm'
import { timeAgo } from '../components/shared'
import {
  createMember,
  deleteMember,
  displayIdentity,
  generatePassword,
  isValidUsername,
  listMembers,
  resetMemberPassword,
  setAdminMode,
  useAdminGate,
  usernameToEmail,
  type Member,
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

function AddMemberCard({ onCreated }: { onCreated: () => void }) {
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
      onCreated()
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
              Functions → Deploy new function → name it <code>admin-members</code> →
              paste the file <code>supabase/functions/admin-members/index.ts</code>{' '}
              from this project → Deploy. Then retry here. It unlocks everything:
              adding, listing, resetting and removing members — all in-app.
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

/** In-app member manager: list, reset password, remove — no dashboard needed. */
function MembersCard({ refreshKey }: { refreshKey: number }) {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'function-missing' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [resetInfo, setResetInfo] = useState<{ username: string; password: string } | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    const res = await listMembers()
    if (res.ok) {
      setMembers(res.data)
      setState('ready')
    } else if (res.kind === 'function-missing') {
      setState('function-missing')
    } else {
      setErrorMsg(res.message)
      setState('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const handleReset = async (m: Member) => {
    const name = m.username ?? displayIdentity(m.email)
    if (
      !(await confirm({
        title: `Reset ${name}'s password?`,
        message: 'A new password is generated — their current one stops working immediately.',
        confirmLabel: 'Reset password',
      }))
    )
      return
    setBusyId(m.id)
    const password = generatePassword()
    const res = await resetMemberPassword(m.id, password)
    setBusyId(null)
    if (res.ok) {
      setResetInfo({ username: name, password })
      showToast(`Password reset for ${name}`, '🔑')
    } else {
      showToast(res.kind === 'error' ? res.message : 'Server function not deployed', '⚠️')
    }
  }

  const handleRemove = async (m: Member) => {
    const name = m.username ?? displayIdentity(m.email)
    if (
      !(await confirm({
        title: `Remove ${name}?`,
        message:
          'Their account and their cloud library are permanently deleted. Anything still on their device stays there but stops syncing.',
        confirmLabel: 'Remove member',
        danger: true,
      }))
    )
      return
    setBusyId(m.id)
    const res = await deleteMember(m.id)
    setBusyId(null)
    if (res.ok) {
      showToast(`${name} removed`, '🗑️')
      void load()
    } else {
      showToast(res.kind === 'error' ? res.message : 'Server function not deployed', '⚠️')
    }
  }

  return (
    <section className="card">
      <div className="admin-card-title admin-members-head">
        <span>👥 Members{members ? ` (${members.length})` : ''}</span>
        <button
          className="btn small"
          onClick={() => void load()}
          disabled={state === 'loading'}
          aria-label="Refresh members"
        >
          ↻ Refresh
        </button>
      </div>

      {state === 'loading' && (
        <div aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton admin-member-skel" />
          ))}
        </div>
      )}

      {state === 'function-missing' && (
        <p className="admin-desc">
          Deploy the <code>admin-members</code> server function (see the setup card above,
          it appears when adding a member) to list, reset and remove members right here.
          Until then the Supabase dashboard still works:{' '}
          <a href={DASHBOARD_USERS_URL} target="_blank" rel="noreferrer">
            open users ↗
          </a>
        </p>
      )}

      {state === 'error' && <div className="admin-error">{errorMsg}</div>}

      {state === 'ready' && members && (
        <>
          <div className="admin-members">
            {members.map((m) => {
              const name = m.username ?? displayIdentity(m.email)
              return (
                <div className="admin-member-row" key={m.id}>
                  <div className="admin-member-avatar" aria-hidden="true">
                    {name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="admin-member-main">
                    <div className="admin-member-name">
                      {name}
                      {m.isAdmin && <span className="admin-member-badge">admin</span>}
                    </div>
                    <div className="admin-member-sub">
                      joined {new Date(m.createdAt).toLocaleDateString()} · last sign-in{' '}
                      {m.lastSignInAt ? timeAgo(m.lastSignInAt) : 'never'}
                    </div>
                  </div>
                  {!m.isAdmin && (
                    <div className="admin-member-actions">
                      <button
                        className="btn small"
                        disabled={busyId === m.id}
                        onClick={() => void handleReset(m)}
                        title="Reset password"
                      >
                        🔑
                      </button>
                      <button
                        className="btn small danger"
                        disabled={busyId === m.id}
                        onClick={() => void handleRemove(m)}
                        title="Remove member"
                      >
                        🗑️
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
            {members.length === 0 && (
              <p className="admin-desc">No members yet — add the first one above.</p>
            )}
          </div>

          {resetInfo && (
            <div className="admin-credentials">
              <div className="admin-credentials-title">🔑 New password for {resetInfo.username}</div>
              <code className="admin-credentials-block">
                Username: {resetInfo.username}
                {'\n'}Password: {resetInfo.password}
              </code>
              <button
                className="btn small"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    `Raed Tracker\nUsername: ${resetInfo.username}\nNew password: ${resetInfo.password}`,
                  )
                  showToast('Credentials copied', '📋')
                }}
              >
                📋 Copy
              </button>
            </div>
          )}

          <p className="admin-hint">
            Every member's library is private to their account. Removing a member also
            deletes their cloud library.
          </p>
        </>
      )}
    </section>
  )
}

export default function Admin() {
  const { email, isAdmin, adminMode } = useAdminGate()
  const [membersRefresh, setMembersRefresh] = useState(0)

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
          <AddMemberCard onCreated={() => setMembersRefresh((n) => n + 1)} />
          <MembersCard refreshKey={membersRefresh} />
        </div>
      )}
    </div>
  )
}
