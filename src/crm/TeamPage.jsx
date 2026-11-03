import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, UserPlus, Users } from 'lucide-react'
import { useMembers, usePeople, useSetMember } from './session.js'

// The admin's member list. Membership is the workspace's (core): anyone on the workspace's
// employee list can be added here, and the same list and roles show in the console. Members see
// their own deals and their team's; sales managers and admins see every deal. Members can also use
// FluidCRM from WhatsApp once they connect their phone in the workspace portal.
const roleLabels = { admin: 'Admin', sales_manager: 'Sales manager' }

export default function TeamPage({ me, accountMenu }) {
  const members = useMembers()
  const people = usePeople()
  const setMember = useSetMember()
  const [adding, setAdding] = useState('')

  const memberIds = new Set((members.data ?? []).map((m) => m.id))
  const candidates = (people.data ?? []).filter((p) => !memberIds.has(p.id))
  const rolesOf = (m) => (m.roles ?? []).filter((r) => r in roleLabels)
  const toggleRole = (m, role) => {
    const current = rolesOf(m)
    setMember.mutate({ personId: m.id, roles: current.includes(role) ? current.filter((r) => r !== role) : [...current, role] })
  }

  const add = (e) => {
    e.preventDefault()
    if (adding) setMember.mutate({ personId: adding, roles: [] }, { onSuccess: () => setAdding('') })
  }

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
          Add the workspace’s employees to FluidCRM. Members see their own deals and the deals of people who report to them;
          sales managers and admins see every deal. The workspace owner manages employees and who reports to whom in the console.
        </p>

        {setMember.error && <div className="team-card team-error">{setMember.error.message}</div>}

        <form className="team-card team-add" onSubmit={add}>
          <div className="team-card-title"><UserPlus size={16} /> Add a person</div>
          <div className="team-add-row">
            <label className="field">
              <span className="field-label">Employee</span>
              <select value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">{people.isLoading ? 'Loading…' : candidates.length ? 'Choose someone' : 'Everyone is already a member'}</option>
                {candidates.map((p) => <option key={p.id} value={p.id}>{p.name}{p.title ? ` · ${p.title}` : ''}</option>)}
              </select>
            </label>
            <button type="submit" className="btn-primary" disabled={!adding || setMember.isPending}>{setMember.isPending ? 'Adding…' : 'Add'}</button>
          </div>
        </form>

        <div className="team-card">
          <div className="team-card-title">Members {members.data && <span className="count-pill">{members.data.length}</span>}</div>
          {members.isLoading && <p className="field-empty">Loading…</p>}
          {members.error && <p className="field-empty">Couldn’t load members: {members.error.message}</p>}
          {members.data?.length === 0 && <p className="field-empty">No members yet.</p>}
          <ul className="member-list">
            {members.data?.map((m) => {
              const self = m.auth_user_id === me.user_id
              const owner = m.workspace_role === 'owner'
              const roles = rolesOf(m)
              return (
                <li key={m.id}>
                  <span className="account-avatar">{(m.name || m.email || '?')[0].toUpperCase()}</span>
                  <div className="member-text">
                    <span className="member-name">{m.name}{self && ' (you)'}</span>
                    <span className="member-sub">
                      {[m.title, owner ? 'Workspace owner' : roles.map((r) => roleLabels[r]).join(', ') || 'Member'].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  {!owner && !self && (
                    <div className="member-actions">
                      <button type="button" className="btn-secondary" disabled={setMember.isPending} onClick={() => toggleRole(m, 'sales_manager')}>
                        {roles.includes('sales_manager') ? 'Not a sales manager' : 'Make sales manager'}
                      </button>
                      <button type="button" className="btn-secondary" disabled={setMember.isPending} onClick={() => toggleRole(m, 'admin')}>
                        {roles.includes('admin') ? 'Remove admin' : 'Make admin'}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost-danger"
                        disabled={setMember.isPending}
                        onClick={() => window.confirm(`Remove ${m.name} from FluidCRM? Their deals stay; they lose access until you add them again.`) && setMember.mutate({ personId: m.id, active: false })}
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
