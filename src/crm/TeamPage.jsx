import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Copy, KeyRound, UserPlus, Users } from 'lucide-react'
import { useMemberAction, useMembers } from './session.js'

// The admin's member list. Everyone here has their own private board; being on this list (and
// active) is what lets someone use the CRM - in the app, and from WhatsApp if they're also a
// workspace employee with their phone connected in the workspace portal.
export default function TeamPage({ me, accountMenu }) {
  const members = useMembers()
  const action = useMemberAction()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [handover, setHandover] = useState(null) // { email, password }
  const [notice, setNotice] = useState(null)

  const run = (body, onDone) =>
    action.mutate(body, {
      onSuccess: (result) => onDone?.(result),
      onError: () => setNotice(null),
    })

  const add = (e) => {
    e.preventDefault()
    run({ action: 'add', email, name }, (result) => {
      if (result.temporary_password) setHandover({ email: result.member.email, password: result.temporary_password })
      else setNotice(`${result.member.email} already has a workspace login - they sign in with their own password.`)
      setEmail('')
      setName('')
    })
  }

  const copy = (text) => navigator.clipboard?.writeText(text)

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar-left">
          <Link to="/" className="icon-btn" aria-label="Back to deals"><ArrowLeft size={18} /></Link>
          <div className="brand-icon"><Users size={20} strokeWidth={2.2} /></div>
          <h1 className="page-title">Team</h1>
        </div>
        <div className="topbar-right">{accountMenu}</div>
      </header>

      <section className="team">
        <p className="team-intro">
          People you add here can sign in to FluidCRM. Each person gets their own private board with the sample deals.
          Workspace employees who are on this list can also use FluidCRM from WhatsApp, once they connect their phone in the workspace portal.
        </p>

        {handover && (
          <div className="team-card team-handover">
            <KeyRound size={18} />
            <div>
              <div className="team-card-title">Temporary password for {handover.email}</div>
              <p className="team-card-text">Give it to them directly - it’s shown only now. They can change it from their account menu.</p>
              <div className="team-handover-row">
                <code>{handover.password}</code>
                <button type="button" className="btn-secondary" onClick={() => copy(handover.password)}><Copy size={14} /> Copy</button>
                <button type="button" className="btn-secondary" onClick={() => setHandover(null)}>Done</button>
              </div>
            </div>
          </div>
        )}
        {notice && <div className="team-card team-notice">{notice}</div>}
        {action.error && <div className="team-card team-error">{action.error.message}</div>}

        <form className="team-card team-add" onSubmit={add}>
          <div className="team-card-title"><UserPlus size={16} /> Add a person</div>
          <div className="team-add-row">
            <label className="field">
              <span className="field-label">Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
            </label>
            <label className="field">
              <span className="field-label">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
            </label>
            <button type="submit" className="btn-primary" disabled={action.isPending}>{action.isPending ? 'Adding…' : 'Add'}</button>
          </div>
        </form>

        <div className="team-card">
          <div className="team-card-title">Members {members.data && <span className="count-pill">{members.data.length}</span>}</div>
          {members.isLoading && <p className="field-empty">Loading…</p>}
          {members.error && <p className="field-empty">Couldn’t load members: {members.error.message}</p>}
          {members.data?.length === 0 && <p className="field-empty">No members yet.</p>}
          <ul className="member-list">
            {members.data?.map((m) => {
              const self = m.user_id === me.user_id
              return (
                <li key={m.user_id} className={m.status === 'disabled' ? 'is-disabled' : ''}>
                  <span className="account-avatar">{(m.name || m.email)[0].toUpperCase()}</span>
                  <div className="member-text">
                    <span className="member-name">{m.name}{self && ' (you)'}</span>
                    <span className="member-sub">
                      {m.email} · {m.role === 'admin' ? 'Admin' : 'User'}
                      {m.status === 'disabled' ? ' · Access paused' : ''}
                      {!m.created_login && ' · Workspace login'}
                    </span>
                  </div>
                  {!self && (
                    <div className="member-actions">
                      <button type="button" className="btn-secondary" disabled={action.isPending} onClick={() => run({ action: 'set_role', user_id: m.user_id, role: m.role === 'admin' ? 'user' : 'admin' })}>
                        {m.role === 'admin' ? 'Make user' : 'Make admin'}
                      </button>
                      {m.created_login && (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={action.isPending}
                          onClick={() => window.confirm(`Reset ${m.email}'s password? Their current password stops working.`)
                            && run({ action: 'reset_password', user_id: m.user_id }, (r) => setHandover({ email: m.email, password: r.temporary_password }))}
                        >
                          Reset password
                        </button>
                      )}
                      <button type="button" className="btn-secondary" disabled={action.isPending} onClick={() => run({ action: 'set_status', user_id: m.user_id, status: m.status === 'active' ? 'disabled' : 'active' })}>
                        {m.status === 'active' ? 'Pause access' : 'Restore access'}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost-danger"
                        disabled={action.isPending}
                        onClick={() => window.confirm(`Remove ${m.email}? They lose access; their board is kept if you add them again.`) && run({ action: 'remove', user_id: m.user_id })}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </section>
    </div>
  )
}
