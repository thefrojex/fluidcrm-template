import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Plus, Workflow, CalendarClock, Mail, Check, Trash2, AlertCircle, RotateCcw, StickyNote, Sparkles, X, Bell, MessageCircle,
} from 'lucide-react'
import { companyIcons, eventIcons } from './icons.js'
import {
  channelLabel, eventStatuses, formatDay, formatReminderTime, isPast, isPendingSuggestion, nextReminder, overdueCount,
  relativeLabel, sortedEvents,
} from '../lib/deals.js'
import Tooltip from './Tooltip.jsx'
import DealProgress from './DealProgress.jsx'

// "₹45L/yr" → amount "₹45L" plus a quieter "/yr"
function DealValue({ value }) {
  if (!value) return <span className="company-value is-empty"><Plus size={13} /> Add value</span>
  const [, amount, period] = /^(.*?)(\/\w+)?$/.exec(value)
  return (
    <span className="company-value">
      {amount}
      {period && <span className="value-period">{period}</span>}
    </span>
  )
}

function CompanyCell({ deal, statuses, selected, hovered, onHover, onSelect, index, live }) {
  const Logo = companyIcons[deal.logo]
  const overdue = overdueCount(deal)
  return (
    <button
      className={`company-cell ${selected ? 'is-selected' : ''} ${hovered ? 'is-hovered' : ''} ${live ? `live-changed live-${live}` : ''}`}
      onClick={onSelect}
      onMouseEnter={() => onHover(deal.id)}
      onMouseLeave={() => onHover(null)}
      style={{ '--i': index }}
    >
      <div className={`company-logo logo-${deal.logoColor}`}>
        <Logo size={22} />
        {overdue > 0 && (
          <span className="logo-badge" aria-label={`${overdue} overdue`}>{overdue}</span>
        )}
      </div>
      <div className="company-info">
        <div className="company-name-row">
          <span className="company-name">{deal.name || 'Untitled company'}</span>
          <span className={`deal-tag tag-${deal.tag.toLowerCase()}`}>{deal.tag}</span>
        </div>
        <div className="company-meta">
          {[deal.industry, deal.city].filter(Boolean).join(' • ') || 'No details yet'}
        </div>
        <div className="company-foot">
          <DealValue value={deal.value} />
          <DealProgress deal={deal} statuses={statuses} />
        </div>
      </div>
    </button>
  )
}

function Owner({ owner }) {
  if (owner.startsWith('Auto')) {
    const AutoIcon = owner.includes('Calendar')
      ? CalendarClock
      : owner.includes('Email')
        ? Mail
        : Workflow
    return (
      <span className="owner owner-auto">
        <AutoIcon size={13} />
        {owner}
      </span>
    )
  }
  return (
    <span className="owner">
      <span className={`avatar avatar-${owner.toLowerCase()}`}>{owner[0]}</span>
      {owner}
    </span>
  )
}

// Only the statuses that need attention get a chip; "done" is shown quietly on the icon tile
function StatusChip({ status, date }) {
  if (status === 'overdue') {
    return (
      <span className="event-status status-chip-overdue">
        <AlertCircle size={11} strokeWidth={2.75} />
        {relativeLabel(date)}
      </span>
    )
  }
  if (status === 'next') {
    return (
      <span className="event-status status-chip-next">
        <span className="next-pulse" />
        {relativeLabel(date)}
      </span>
    )
  }
  return null
}

// Tags on the card's top-right edge. Order is fixed: reminders first, AI provenance last (rightmost).
function CardTags({ event }) {
  const count = event.reminders?.length ?? 0
  const upcoming = nextReminder(event)
  const pending = isPendingSuggestion(event)
  if (!count && !event.ai) return null
  return (
    <div className="card-tags">
      {count > 0 && (
        <Tooltip
          label={
            upcoming
              ? `Next: ${formatReminderTime(upcoming)} · ${channelLabel(upcoming.channel)} to ${upcoming.recipient}`
              : 'All reminders sent'
          }
        >
          <span className={`reminder-tag ${upcoming ? '' : 'is-sent'}`}>
            <Bell size={11} strokeWidth={2.5} />
            {count} {count === 1 ? 'reminder' : 'reminders'}
          </span>
        </Tooltip>
      )}
      {event.ai && (
        <Tooltip label={pending ? 'Suggested by AI · click to review' : 'Suggested by AI · accepted'}>
          <span className={`ai-tag ${pending ? '' : 'is-accepted'}`}>
            <Sparkles size={11} strokeWidth={2.5} />
            AI suggestion
          </span>
        </Tooltip>
      )}
    </div>
  )
}

function EventCard({ event, status, selected, dimmed, justAdded, live, index, onSelect, onToggleDone, onDelete, onAccept }) {
  const Icon = eventIcons[event.icon]
  const variant = event.variant ?? 'default'
  const pending = isPendingSuggestion(event)
  const tagCount = (event.reminders?.length ? 1 : 0) + (event.ai ? 1 : 0)
  return (
    <div
      role="button"
      tabIndex={0}
      data-event-id={event.id}
      className={[
        'event-card',
        `variant-${variant}`,
        `status-${status}`,
        pending && 'is-suggested',
        tagCount === 2 && 'has-two-tags',
        selected && 'is-selected',
        dimmed && 'is-dimmed',
        justAdded && 'just-added',
        // Changed outside this tab (WhatsApp assistant, another tab): live = { kind, via }
        live && `live-${live.kind} live-${live.via}`,
      ].filter(Boolean).join(' ')}
      style={{ '--i': index }}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect())}
    >
      {live && (
        <span className="live-badge" aria-hidden="true">
          {live.via === 'whatsapp' ? <><MessageCircle size={10} strokeWidth={2.75} /> WhatsApp</> : 'Updated'}
        </span>
      )}
      <span className="event-icon">
        <Icon size={16} />
        {status === 'done' && (
          <span className="event-icon-check" aria-label="Done">
            <Check size={9} strokeWidth={4} />
          </span>
        )}
      </span>

      <div className="event-body">
        <div className={`event-name ${event.title ? '' : 'is-placeholder'}`}>
          {event.title || 'Untitled event'}
        </div>
        <div className="event-meta">
          <span className="event-day">{formatDay(event.date)}</span>
          <StatusChip status={status} date={event.date} />
          {event.notes?.trim() && (
            <Tooltip label="Has notes">
              <span className="event-note"><StickyNote size={12} /></span>
            </Tooltip>
          )}
        </div>
        <Owner owner={event.owner} />
      </div>

      <CardTags event={event} />

      {/* Secondary actions stay hidden until the card is hovered or focused */}
      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        {pending ? (
          <>
            <Tooltip label="Accept suggestion">
              <button className="card-action card-action-accept" onClick={onAccept} aria-label="Accept suggestion">
                <Check size={14} strokeWidth={2.5} />
              </button>
            </Tooltip>
            <Tooltip label="Dismiss suggestion">
              <button className="card-action card-action-danger" onClick={onDelete} aria-label="Dismiss suggestion">
                <X size={14} strokeWidth={2.5} />
              </button>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip label={event.done ? 'Mark as not done' : 'Mark as done'}>
              <button className="card-action" onClick={onToggleDone} aria-label="Toggle done">
                {event.done ? <RotateCcw size={14} /> : <Check size={14} strokeWidth={2.5} />}
              </button>
            </Tooltip>
            <Tooltip label="Delete event">
              <button className="card-action card-action-danger" onClick={onDelete} aria-label="Delete event">
                <Trash2 size={14} />
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  )
}

// The gap between two events: a dot, a "Today" marker where the past meets the future,
// and a plus button on hover that inserts an event here. The line is solid where the
// timeline is complete and dashed ahead; the dot takes the next event's status.
function Connector({ status, today, onAdd }) {
  return (
    <div className={`connector seg-line-${status ?? 'end'} ${today ? 'is-today' : ''}`}>
      {today && <span className="today-marker"><span>Today</span></span>}
      <span className={`connector-dot dot-${status ?? 'end'}`} />
      {onAdd && (
        <Tooltip label="Add event here">
          <button className="connector-add" aria-label="Add event here" onClick={onAdd}>
            <Plus size={16} strokeWidth={2.5} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}

function TimelineRow({ deal, statuses, selectedEventId, recentId, live, highlighted, onHover, isDimmed, onSelectEvent, onAddEvent, onToggleDone, onDeleteEvent, onAcceptEvent }) {
  const trackRef = useRef()
  const [edges, setEdges] = useState({ left: false, right: false })
  const events = sortedEvents(deal)
  // Index of the first event that isn't in the past; the Today marker sits just before it
  const firstFuture = events.findIndex((e) => !isPast(e.date))
  const todayAt = firstFuture === -1 ? events.length : firstFuture

  const updateEdges = () => {
    const t = trackRef.current
    if (!t) return
    setEdges({ left: t.scrollLeft > 4, right: t.scrollLeft + t.clientWidth < t.scrollWidth - 4 })
  }

  // On first render, bring the deal's "next" (or first overdue) event into view
  useLayoutEffect(() => {
    const t = trackRef.current
    const focusId = events.find((e) => statuses[e.id] === 'overdue' || statuses[e.id] === 'next')?.id
    const card = focusId && t.querySelector(`[data-event-id="${focusId}"]`)
    if (card && card.offsetLeft + card.offsetWidth > t.clientWidth) {
      t.scrollLeft = card.offsetLeft - 90
    }
    updateEdges()
    const ro = new ResizeObserver(updateEdges)
    ro.observe(t)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Scroll a freshly added event - or one changed from outside - into view
  const liveId = deal.events.find((e) => live?.[e.id])?.id
  useEffect(() => {
    const id = recentId ?? liveId
    if (!id) return
    const card = trackRef.current.querySelector(`[data-event-id="${id}"]`)
    card?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    updateEdges()
  }, [recentId, liveId, deal.events.length])

  return (
    <div
      className={`track-wrap ${edges.left ? 'fade-left' : ''} ${edges.right ? 'fade-right' : ''} ${highlighted ? 'is-highlighted' : ''}`}
      onMouseEnter={() => onHover(deal.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="timeline-track" ref={trackRef} onScroll={updateEdges}>
        {events.map((event, i) => (
          <div className="track-item" key={event.id}>
            {i > 0 && (
              <Connector
                status={statuses[event.id]}
                today={i === todayAt}
                onAdd={() => onAddEvent(events[i - 1].id)}
              />
            )}
            <EventCard
              event={event}
              index={i}
              status={statuses[event.id]}
              selected={event.id === selectedEventId}
              dimmed={isDimmed(event)}
              justAdded={event.id === recentId}
              live={live?.[event.id]}
              onSelect={() => onSelectEvent(event.id)}
              onToggleDone={() => onToggleDone(event.id)}
              onDelete={() => onDeleteEvent(event.id)}
              onAccept={() => onAcceptEvent(event.id)}
            />
          </div>
        ))}
        {events.length > 0 && <Connector today={todayAt === events.length} />}
        <Tooltip label="Add event at the end">
          <button
            className={`add-event-slot ${events.length ? '' : 'is-first'}`}
            aria-label="Add event"
            onClick={() => onAddEvent(events.at(-1)?.id ?? null)}
          >
            <Plus size={22} strokeWidth={1.5} />
            {!events.length && <span>Add the first event</span>}
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

export default function DealsTimeline({
  deals,
  selection,
  recentId,
  live,
  isEventDimmed,
  onSelectEvent,
  onSelectCompany,
  onAddEvent,
  onToggleDone,
  onDeleteEvent,
  onAcceptEvent,
}) {
  // Hovering either the company or its timeline highlights the whole row
  const [hoveredId, setHoveredId] = useState(null)
  const isSelectedDeal = (id) => selection?.dealId === id

  return (
    <section className="board">
      {/* Fixed company column */}
      <div className="company-col">
        {deals.map((deal, i) => (
          <CompanyCell
            key={deal.id}
            index={i}
            deal={deal}
            statuses={eventStatuses(deal)}
            selected={selection?.type === 'company' && selection.dealId === deal.id}
            hovered={hoveredId === deal.id || isSelectedDeal(deal.id)}
            onHover={setHoveredId}
            onSelect={() => onSelectCompany(deal.id)}
            live={live?.deals?.[deal.id]}
          />
        ))}
      </div>

      {/* Each company's timeline row scrolls horizontally on its own */}
      <div className="board-scroll">
        <div className="timeline-area">
          {deals.map((deal) => (
            <TimelineRow
              key={deal.id}
              deal={deal}
              statuses={eventStatuses(deal)}
              recentId={recentId}
              live={live?.events}
              highlighted={hoveredId === deal.id || isSelectedDeal(deal.id)}
              onHover={setHoveredId}
              selectedEventId={selection?.type === 'event' && selection.dealId === deal.id ? selection.eventId : null}
              isDimmed={(event) => isEventDimmed(deal, event)}
              onSelectEvent={(eventId) => onSelectEvent(deal.id, eventId)}
              onAddEvent={(afterId) => onAddEvent(deal.id, afterId)}
              onToggleDone={(eventId) => onToggleDone(deal.id, eventId)}
              onDeleteEvent={(eventId) => onDeleteEvent(deal.id, eventId)}
              onAcceptEvent={(eventId) => onAcceptEvent(deal.id, eventId)}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
