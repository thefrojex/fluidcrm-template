import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ChevronDown, Inbox, KeyRound, LogOut, Users, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { changePassword, signOut } from './session.js'

// Sign-in only: there's no sign-up. Employees have one workspace login for every app; the
// workspace owner adds them (console) and gives them access to the CRM.
export function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(/invalid/i.test(error.message) ? 'That email and password don’t match.' : error.message)
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div className="brand-icon"><Inbox size={20} strokeWidth={2.2} /></div>
          <div>
            <div className="auth-title">FluidCRM</div>
            <div className="auth-sub">Sign in to your deals</div>
          </div>
        </div>
        <label className="field">
          <span className="field-label">Email</span>
          <input type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <span className="field-error"><AlertCircle size={13} /> {error}</span>}
        <button type="submit" className="btn-primary auth-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="auth-note">No login? Ask the workspace owner to add you.</p>
      </form>
    </main>
  )
}

export function NoAccess({ email }) {
  const queryClient = useQueryClient()
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-icon"><Inbox size={20} strokeWidth={2.2} /></div>
          <div>
            <div className="auth-title">You don’t have access yet</div>
            <div className="auth-sub">{email}</div>
          </div>
        </div>
        <p className="auth-note auth-note-left">
          You’re signed in, but you aren’t a member of FluidCRM. Ask the workspace owner or the CRM’s admin to add you.
        </p>
        <button type="button" className="btn-secondary auth-submit" onClick={() => signOut(queryClient)}>
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </main>
  )
}

export function ChangePasswordDialog({ onClose }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (password.length < 8) return setError('Use at least 8 characters.')
    setBusy(true)
    try {
      await changePassword(password)
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head">
          <span className="modal-title">Change password</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {done ? (
          <p className="auth-note auth-note-left">Password changed. Use it next time you sign in.</p>
        ) : (
          <>
            <label className="field">
              <span className="field-label">New password</span>
              <input type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <p className="auth-note auth-note-left">This is your workspace login, so it changes for every app you use in the workspace.</p>
            {error && <span className="field-error"><AlertCircle size={13} /> {error}</span>}
          </>
        )}
        <div className="modal-actions">
          {done ? <button type="button" className="btn-primary" onClick={onClose}>Done</button> : (
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
          )}
        </div>
      </form>
    </div>
  )
}

// The avatar menu at the end of the top bar.
export function AccountMenu({ member }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [changing, setChanging] = useState(false)
  const wrapRef = useRef()

  useEffect(() => {
    if (!open) return
    const onDown = (e) => !wrapRef.current?.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="popover-wrap" ref={wrapRef}>
      <button className={`account-btn ${open ? 'is-on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Account">
        <span className="account-avatar">{(member.name || member.email || '?')[0].toUpperCase()}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="popover popover-account" role="menu">
          <div className="popover-section">
            <div className="account-name">{member.name}</div>
            <div className="account-email">{member.email}{member.role === 'admin' ? ' · Admin' : member.sees_all ? ' · Sales manager' : ''}</div>
          </div>
          <div className="popover-section">
            {member.role === 'admin' && (
              <Link className="popover-option" to="/team" onClick={() => setOpen(false)}><span><Users size={15} /> Team</span></Link>
            )}
            <button className="popover-option" onClick={() => { setChanging(true); setOpen(false) }}>
              <span><KeyRound size={15} /> Change password</span>
            </button>
            <button className="popover-option" onClick={() => signOut(queryClient)}>
              <span><LogOut size={15} /> Sign out</span>
            </button>
          </div>
        </div>
      )}
      {changing && <ChangePasswordDialog onClose={() => setChanging(false)} />}
    </div>
  )
}
