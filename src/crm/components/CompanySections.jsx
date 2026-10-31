import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, MessageCircle, Pencil, Plus, Star, Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// Contacts at a company: who the assistant matches "I spoke to Rohan" against, and who an event
// owned by "Client" is.
export function CompanyContacts({ companyId }) {
  const queryClient = useQueryClient()
  const key = ['fluidcrm', 'contacts', companyId]
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, name, job_title, email, phone, is_decision_maker')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .order('name')
      if (error) throw error
      return data
    },
  })
  const [editing, setEditing] = useState(null) // contact id, 'new' or null
  const [draft, setDraft] = useState({})

  const save = useMutation({
    mutationFn: async (contact) => {
      const row = {
        name: contact.name.trim(),
        job_title: contact.job_title?.trim() || null,
        email: contact.email?.trim() || null,
        phone: contact.phone?.trim() || null,
        is_decision_maker: Boolean(contact.is_decision_maker),
      }
      const { error } = contact.id
        ? await supabase.from('contacts').update(row).eq('id', contact.id)
        : await supabase.from('contacts').insert({ ...row, company_id: companyId })
      if (error) throw error
    },
    onSuccess: () => {
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: key })
    },
  })
  const remove = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('contacts').update({ deleted_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  const start = (contact) => {
    setEditing(contact?.id ?? 'new')
    setDraft(contact ?? { name: '', job_title: '', email: '', phone: '', is_decision_maker: false })
  }

  const form = (
    <div className="contact-form">
      <input autoFocus value={draft.name ?? ''} placeholder="Name" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      <input value={draft.job_title ?? ''} placeholder="Job title" onChange={(e) => setDraft({ ...draft, job_title: e.target.value })} />
      <div className="contact-form-row">
        <input value={draft.email ?? ''} placeholder="Email" onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
        <input value={draft.phone ?? ''} placeholder="Phone" onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
      </div>
      <label className="contact-check">
        <input type="checkbox" checked={Boolean(draft.is_decision_maker)} onChange={(e) => setDraft({ ...draft, is_decision_maker: e.target.checked })} />
        Decision maker
      </label>
      {save.error && <span className="field-error">{save.error.message}</span>}
      <div className="contact-form-actions">
        <button type="button" className="btn-secondary" onClick={() => setEditing(null)}><X size={14} /> Cancel</button>
        <button type="button" className="btn-primary" disabled={!draft.name?.trim() || save.isPending} onClick={() => save.mutate(draft)}>
          <Check size={14} /> {save.isPending ? 'Saving…' : 'Save contact'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="field">
      <span className="field-label field-label-row">
        Contacts {query.data?.length > 0 && <span className="count-pill">{query.data.length}</span>}
      </span>
      {query.isLoading && <p className="field-empty">Loading contacts…</p>}
      {query.error && <p className="field-empty">Couldn’t load contacts: {query.error.message}</p>}
      {query.data?.length === 0 && editing !== 'new' && <p className="field-empty">No contacts yet.</p>}
      {query.data?.length > 0 && (
        <ul className="contact-list">
          {query.data.map((c) => (editing === c.id ? <li key={c.id}>{form}</li> : (
            <li key={c.id} className="contact-item">
              <div className="contact-text">
                <span className="contact-name">
                  {c.name}
                  {c.is_decision_maker && <Star size={12} className="contact-star" aria-label="Decision maker" />}
                </span>
                <span className="contact-sub">{[c.job_title, c.email, c.phone].filter(Boolean).join(' · ') || '—'}</span>
              </div>
              <button type="button" className="icon-btn" onClick={() => start(c)} aria-label={`Edit ${c.name}`}><Pencil size={14} /></button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => window.confirm(`Remove ${c.name} from this company?`) && remove.mutate(c.id)}
                aria-label={`Remove ${c.name}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          )))}
        </ul>
      )}
      {editing === 'new' ? form : (
        <button type="button" className="btn-add-reminder" onClick={() => start(null)}><Plus size={14} /> Add contact</button>
      )}
    </div>
  )
}

const actionLabel = {
  created: 'Added',
  updated: 'Changed',
  deleted: 'Deleted',
  restored: 'Restored',
  completed: 'Completed',
  reopened: 'Reopened',
  accepted: 'Accepted suggestion',
  dismissed: 'Dismissed suggestion',
}

const ago = (iso) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Recent changes to this deal, by the person in the app or through the WhatsApp assistant.
export function DealHistory({ deal }) {
  const query = useQuery({
    queryKey: ['fluidcrm', 'history', deal.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activity_log')
        .select('id, entity_type, entity_id, action, changes, via, created_at')
        .eq('deal_id', deal.id)
        .order('created_at', { ascending: false })
        .limit(12)
      if (error) throw error
      return data
    },
  })

  const titleOf = (entry) => {
    const event = deal.events.find((e) => e.id === entry.entity_id)
    const label = event?.title ?? entry.changes?._label
    if (entry.entity_type === 'deal') {
      const fields = Object.keys(entry.changes ?? {}).filter((k) => !k.startsWith('_') && k !== 'deleted_at')
      return fields.length ? `the deal’s ${fields.map((f) => f.replace('value_', '').replace('_', ' ')).join(', ')}` : 'the deal'
    }
    if (entry.entity_type === 'reminder') return label ? `a reminder: “${label}”` : 'a reminder'
    return `“${label ?? 'an event'}”`
  }

  return (
    <div className="field">
      <span className="field-label">History</span>
      {query.isLoading && <p className="field-empty">Loading…</p>}
      {query.error && <p className="field-empty">Couldn’t load history: {query.error.message}</p>}
      {query.data?.length === 0 && <p className="field-empty">No changes yet.</p>}
      {query.data?.length > 0 && (
        <ul className="history-list">
          {query.data.map((entry) => (
            <li key={entry.id}>
              <span className="history-text">{actionLabel[entry.action] ?? entry.action} {titleOf(entry)}</span>
              {entry.via === 'whatsapp' && <span className="history-via"><MessageCircle size={11} /> WhatsApp</span>}
              <span className="history-time">{ago(entry.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
