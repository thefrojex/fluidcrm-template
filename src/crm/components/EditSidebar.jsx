import { useEffect, useRef, useState } from 'react'
import { X, Trash2, ChevronRight, ChevronDown, Check, AlertCircle, ArrowRight, Sparkles, Bell, Plus, MessageCircle } from 'lucide-react'
import { companyIcons, eventIcons, eventTypeOptions } from './icons.js'
import {
  channelLabel, eventStatuses, formatDay, formatReminderTime, isPendingSuggestion, reminderChannels, reminderState,
  sortedEvents, sortedReminders, todayISO,
} from '../lib/deals.js'
import { getMe } from '../lib/me.js'
import Tooltip from './Tooltip.jsx'
import { CompanyContacts, DealHistory } from './CompanySections.jsx'

const owners = () => [getMe(), 'Client', 'Team', 'Auto • AI', 'Auto • Email', 'Auto • Calendar']
const variants = ['default', 'blue', 'purple', 'red', 'green']
const tags = ['HOT', 'WARM', 'COLD', 'ENTERPRISE']
const logoColors = ['blue', 'red', 'green', 'orange', 'purple']

const statusMeta = {
  done: { icon: Check, label: 'Done' },
  overdue: { icon: AlertCircle, label: 'Overdue' },
  next: { icon: ArrowRight, label: 'Next' },
}


function Field({ label, error, children }) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {error && (
        <span className="field-error">
          <AlertCircle size={13} /> {error}
        </span>
      )}
    </label>
  )
}

// Shared "required field" behaviour: error message plus a shake when submitting empty
function useRequired(value) {
  const [error, setError] = useState(null)
  const [shake, setShake] = useState(0)
  const inputRef = useRef()
  useEffect(() => {
    if (error && value.trim()) setError(null)
  }, [value, error])
  const validate = (message) => {
    if (value.trim()) return true
    setError(message)
    setShake((n) => n + 1)
    inputRef.current?.focus()
    return false
  }
  return { error, shake, inputRef, validate }
}

// Top of an AI event: why the AI proposed it, and (while pending) the decision to make
function SuggestionBanner({ event, onAccept, onDismiss }) {
  const pending = isPendingSuggestion(event)
  return (
    <div className={`ai-banner ${pending ? '' : 'is-accepted'}`}>
      <div className="ai-banner-head">
        <span className={`ai-tag ai-tag-inline ${pending ? '' : 'is-accepted'}`}>
          <Sparkles size={11} strokeWidth={2.5} />
          AI suggestion
        </span>
        <span className="ai-banner-hint">
          {pending ? 'Not on the timeline until you accept it' : 'Accepted · now a normal event'}
        </span>
      </div>
      {event.ai.reason?.trim() && <p className="ai-banner-reason">{event.ai.reason}</p>}
      {pending && (
        <div className="ai-banner-actions">
          <button type="button" className="btn-ai" onClick={onAccept}>
            <Check size={15} strokeWidth={2.5} /> Accept
          </button>
          <button type="button" className="btn-secondary" onClick={onDismiss}>Dismiss</button>
        </div>
      )}
    </div>
  )
}

const personOwner = (owner) => (['Client', 'Team'].includes(owner) || owner.startsWith('Auto') ? getMe() : owner)

// Reminders make an event a task someone gets nudged about. Rows stay collapsed to a summary
// (time · channel · recipient · state) and expand to edit.
function RemindersSection({ event, onChange }) {
  const [openId, setOpenId] = useState(null)
  const reminders = sortedReminders(event)

  const setReminders = (next) => onChange({ reminders: next })
  const update = (id, patch) =>
    setReminders(event.reminders.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const remove = (id) => setReminders(event.reminders.filter((r) => r.id !== id))
  const add = () => {
    const r = {
      id: crypto.randomUUID(),
      at: `${event.date || todayISO()}T09:00`,
      channel: 'in-app',
      recipient: personOwner(event.owner),
      message: event.title ? `Reminder: ${event.title}` : '',
    }
    setReminders([...(event.reminders ?? []), r])
    setOpenId(r.id)
  }

  return (
    <div className="field">
      <span className="field-label field-label-row">
        Reminders {reminders.length > 0 && <span className="count-pill">{reminders.length}</span>}
      </span>
      {reminders.length > 0 && (
        <ul className="reminder-list">
          {reminders.map((r) => {
            const state = reminderState(r)
            const open = openId === r.id
            return (
              <li key={r.id} className={`reminder-item is-${state} ${open ? 'is-open' : ''}`}>
                <button type="button" className="reminder-summary" onClick={() => setOpenId(open ? null : r.id)}>
                  <span className="reminder-bell"><Bell size={14} /></span>
                  <span className="reminder-text">
                    <span className="reminder-time">{formatReminderTime(r)}</span>
                    <span className="reminder-sub">{channelLabel(r.channel)} to {r.recipient || '—'}</span>
                  </span>
                  <span className={`reminder-state state-${state}`}>{state === 'sent' ? 'Sent' : 'Scheduled'}</span>
                  <ChevronDown size={15} className="reminder-chevron" />
                </button>
                {open && (
                  <div className="reminder-edit">
                    <div className="field-row">
                      <Field label="When">
                        <input type="datetime-local" value={r.at} onChange={(e) => e.target.value && update(r.id, { at: e.target.value })} />
                      </Field>
                      <Field label="Channel">
                        <select value={r.channel} onChange={(e) => update(r.id, { channel: e.target.value })}>
                          {reminderChannels.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Field label="Remind">
                      <input value={r.recipient} placeholder="Who gets this reminder" onChange={(e) => update(r.id, { recipient: e.target.value })} />
                    </Field>
                    <Field label="Message">
                      <textarea rows={2} value={r.message} placeholder="What should the reminder say?" onChange={(e) => update(r.id, { message: e.target.value })} />
                    </Field>
                    <button type="button" className="btn-ghost-danger btn-sm" onClick={() => remove(r.id)}>
                      <Trash2 size={14} /> Remove reminder
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <button type="button" className="add-reminder" onClick={add}>
        <Plus size={15} /> Add reminder
      </button>
    </div>
  )
}

function EventEditor({ deal, event, isNew, onChange, onDelete, onDone, onAccept }) {
  const Icon = eventIcons[event.icon]
  const status = eventStatuses(deal)[event.id]
  const meta = statusMeta[status]
  const title = useRequired(event.title)
  const pending = isPendingSuggestion(event)

  const submit = () => title.validate('Give this event a title') && onDone()

  return (
    <form
      className="sidebar-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit()}
    >
      <div className="sidebar-body">
        {event.ai && (
          <SuggestionBanner
            event={event}
            onAccept={() => {
              onAccept()
              onDone()
            }}
            onDismiss={onDelete}
          />
        )}

        <div className={`event-preview variant-${event.variant ?? 'default'}`}>
          <div className="event-title">
            <Icon size={19} />
            <span className={event.title ? '' : 'is-placeholder'}>{event.title || 'Untitled event'}</span>
          </div>
          <div className="event-date">
            {formatDay(event.date)}
            {meta && (
              <span className={`event-status status-chip-${status}`}>
                <meta.icon size={11} strokeWidth={3} />
                {meta.label}
              </span>
            )}
          </div>
        </div>

        <Field label="Title" error={title.error}>
          <input
            ref={title.inputRef}
            key={title.shake}
            className={title.shake ? 'shake' : ''}
            autoFocus={isNew}
            value={event.title}
            placeholder="e.g. Pricing Discussion"
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </Field>

        <div className="field-row">
          <Field label="Type">
            <select value={event.icon} onChange={(e) => onChange({ icon: e.target.value })}>
              {eventTypeOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input
              type="date"
              value={event.date}
              onChange={(e) => e.target.value && onChange({ date: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Owner">
          <select value={event.owner} onChange={(e) => onChange({ owner: e.target.value })}>
            {owners().map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </Field>

        <div className="field">
          <span className="field-label">Color</span>
          <div className="swatches">
            {variants.map((v) => (
              <Tooltip key={v} label={v === 'default' ? 'Plain' : v[0].toUpperCase() + v.slice(1)}>
                <button
                  type="button"
                  className={`swatch swatch-${v} ${(event.variant ?? 'default') === v ? 'is-active' : ''}`}
                  onClick={() => onChange({ variant: v })}
                  aria-label={v}
                />
              </Tooltip>
            ))}
          </div>
        </div>

        {!pending && (
          <button
            type="button"
            role="switch"
            aria-checked={!!event.done}
            className={`switch-row ${event.done ? 'is-on' : ''}`}
            onClick={() => onChange({ done: !event.done })}
          >
            <span className="switch-text">
              <span className="field-label">Completed</span>
              <span className="switch-hint">
                {event.done ? 'This event is done' : status === 'overdue' ? 'This event is past its date' : 'Mark it done once it happens'}
              </span>
            </span>
            <span className="switch"><span className="switch-knob" /></span>
          </button>
        )}

        <RemindersSection event={event} onChange={onChange} />

        <Field label="Notes">
          <textarea
            rows={4}
            value={event.notes ?? ''}
            placeholder={`Notes for ${deal.name || 'this company'}…`}
            onChange={(e) => onChange({ notes: e.target.value })}
          />
        </Field>
      </div>

      <div className="sidebar-footer">
        <button type="button" className="btn-ghost-danger" onClick={onDelete}>
          {isNew ? 'Discard' : pending ? <><X size={15} /> Dismiss</> : <><Trash2 size={15} /> Delete</>}
        </button>
        <span className="footer-right">
          <kbd className="kbd-hint">⌘↵</kbd>
          <button type="submit" className="btn-primary">{isNew ? 'Add event' : pending ? 'Save for later' : 'Done'}</button>
        </span>
      </div>
    </form>
  )
}

function CompanyEditor({ deal, isNew, onChange, onSelectEvent, onDelete, onDone }) {
  const Logo = companyIcons[deal.logo]
  const statuses = eventStatuses(deal)
  const name = useRequired(deal.name)

  const submit = () => name.validate('Company name is required') && onDone()

  return (
    <form
      className="sidebar-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit()}
    >
      <div className="sidebar-body">
        <div className="company-preview">
          <div className={`company-logo logo-${deal.logoColor}`}>
            <Logo size={22} />
          </div>
          <div>
            <div className="company-name">{deal.name || 'Untitled company'}</div>
            <div className="company-meta">
              {[deal.industry, deal.city].filter(Boolean).join(' • ') || 'Add an industry and city'}
            </div>
          </div>
        </div>

        <Field label="Company name" error={name.error}>
          <input
            ref={name.inputRef}
            key={name.shake}
            className={name.shake ? 'shake' : ''}
            autoFocus={isNew}
            value={deal.name}
            placeholder="e.g. Meridian Technologies"
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Field>

        <div className="field">
          <span className="field-label">Status</span>
          <div className="tag-picker">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                className={`deal-tag tag-${t.toLowerCase()} ${deal.tag === t ? 'is-active' : ''}`}
                onClick={() => onChange({ tag: t })}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="field-row">
          <Field label="Industry">
            <input value={deal.industry} placeholder="e.g. Healthcare" onChange={(e) => onChange({ industry: e.target.value })} />
          </Field>
          <Field label="City">
            <input value={deal.city} placeholder="e.g. Pune" onChange={(e) => onChange({ city: e.target.value })} />
          </Field>
        </div>

        <Field label="Deal value">
          <input
            value={deal.value ?? ''}
            placeholder="e.g. ₹45L/yr"
            onChange={(e) => onChange({ value: e.target.value })}
          />
        </Field>

        <div className="field">
          <span className="field-label">Logo</span>
          <div className="logo-picker">
            {Object.entries(companyIcons).map(([key, LogoIcon]) => (
              <button
                key={key}
                type="button"
                className={`logo-option ${deal.logo === key ? 'is-active' : ''}`}
                onClick={() => onChange({ logo: key })}
                aria-label={key}
              >
                <LogoIcon size={17} />
              </button>
            ))}
          </div>
          <div className="swatches">
            {logoColors.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch logo-${c} ${deal.logoColor === c ? 'is-active' : ''}`}
                onClick={() => onChange({ logoColor: c })}
                aria-label={c}
              />
            ))}
          </div>
        </div>

        {!isNew && (
          <div className="field">
            <span className="field-label">Events ({deal.events.length})</span>
            {deal.events.length ? (
              <ul className="event-list">
                {sortedEvents(deal).map((event) => {
                  const Icon = eventIcons[event.icon]
                  const status = statuses[event.id]
                  return (
                    <li key={event.id}>
                      <button type="button" onClick={() => onSelectEvent(event.id)}>
                        <span className={`list-dot seg-${status}`} />
                        <Icon size={16} />
                        <span className="event-list-title">{event.title || 'Untitled event'}</span>
                        {event.reminders?.length > 0 && <Bell size={13} className="event-list-bell" aria-label="Has reminders" />}
                        {event.ai && <Sparkles size={13} className="event-list-ai" aria-label="AI suggestion" />}
                        {event.origin === 'whatsapp' && <MessageCircle size={13} className="event-list-wa" aria-label="Added from WhatsApp" />}
                        <span className={`event-list-date ${status === 'overdue' ? 'is-overdue' : ''}`}>{formatDay(event.date)}</span>
                        <ChevronRight size={15} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="field-empty">No events yet. Use the + at the end of the row to add one.</p>
            )}
          </div>
        )}

        {!isNew && <CompanyContacts companyId={deal.companyId} />}
        {!isNew && <DealHistory deal={deal} />}
      </div>

      <div className="sidebar-footer">
        <button type="button" className="btn-ghost-danger" onClick={onDelete}>
          {isNew ? 'Discard' : <><Trash2 size={15} /> Delete company</>}
        </button>
        <span className="footer-right">
          <kbd className="kbd-hint">⌘↵</kbd>
          <button type="submit" className="btn-primary">{isNew ? 'Create company' : 'Done'}</button>
        </span>
      </div>
    </form>
  )
}

export default function EditSidebar({
  deals,
  selection,
  onClose,
  onSelect,
  onUpdateDeal,
  onUpdateEvent,
  onDeleteEvent,
  onDeleteDeal,
  onAcceptEvent,
}) {
  const [leaving, setLeaving] = useState(false)
  const deal = selection && deals.find((d) => d.id === selection.dealId)
  const event =
    selection?.type === 'event' && deal?.events.find((e) => e.id === selection.eventId)

  // Play the slide-out before actually closing
  const requestClose = (then = onClose) => {
    setLeaving(true)
    setTimeout(() => {
      setLeaving(false)
      then()
    }, 170)
  }

  useEffect(() => {
    if (!selection) return
    const onKey = (e) => e.key === 'Escape' && requestClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!deal || (selection.type === 'event' && !event)) return null

  const heading =
    selection.type === 'company'
      ? selection.isNew ? 'New company' : 'Edit company'
      : selection.isNew ? 'New event' : isPendingSuggestion(event) ? 'Review suggestion' : 'Edit event'

  return (
    <>
      <div className={`sidebar-backdrop ${leaving ? 'is-leaving' : ''}`} onClick={() => requestClose()} />
      <aside className={`sidebar ${leaving ? 'is-leaving' : ''}`} role="dialog" aria-label={heading}>
        <div className="sidebar-header">
          <div>
            <div className="sidebar-title">{heading}</div>
            {selection.type === 'event' && (
              <button
                className="sidebar-subtitle"
                onClick={() => onSelect({ type: 'company', dealId: deal.id })}
              >
                {deal.name || 'Untitled company'}
              </button>
            )}
          </div>
          <Tooltip label="Close" shortcut="Esc" side="bottom">
            <button className="icon-btn" onClick={() => requestClose()} aria-label="Close">
              <X size={18} />
            </button>
          </Tooltip>
        </div>

        {selection.type === 'event' ? (
          <EventEditor
            key={event.id}
            deal={deal}
            event={event}
            isNew={selection.isNew}
            onChange={(patch) => onUpdateEvent(deal.id, event.id, patch)}
            onDelete={() => requestClose(() => onDeleteEvent(deal.id, event.id, { silent: selection.isNew }))}
            onDone={() => requestClose()}
            onAccept={() => onAcceptEvent(deal.id, event.id)}
          />
        ) : (
          <CompanyEditor
            key={deal.id}
            deal={deal}
            isNew={selection.isNew}
            onChange={(patch) => onUpdateDeal(deal.id, patch)}
            onSelectEvent={(eventId) => onSelect({ type: 'event', dealId: deal.id, eventId })}
            onDelete={() => requestClose(() => onDeleteDeal(deal.id, { silent: selection.isNew }))}
            onDone={() => requestClose()}
          />
        )}
      </aside>
    </>
  )
}
