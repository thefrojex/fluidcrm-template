import { useEffect, useMemo, useRef, useState } from 'react'
import TopBar from './components/TopBar.jsx'
import StatsBar from './components/StatsBar.jsx'
import DealsTimeline from './components/DealsTimeline.jsx'
import DealsTable from './components/DealsTable.jsx'
import EmptyState from './components/EmptyState.jsx'
import EditSidebar from './components/EditSidebar.jsx'
import Toasts from './components/Toasts.jsx'
import OnboardingTips from './components/OnboardingTips.jsx'
import {
  companyMatches, eventMatches, filterTests, isAutomation, isPendingSuggestion, sorters, todayISO,
} from './lib/deals.js'
import { getMe } from './lib/me.js'
import { useQueryClient } from '@tanstack/react-query'
import { boardKey, newId, sortKeyBetween, useBoard } from './data.js'

const filters = ['All Deals', 'Hot', 'Warm', 'Overdue', 'Enterprise']
const TOAST_MS = 4500
const logoColors = ['blue', 'red', 'green', 'orange', 'purple']

const isTyping = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)

const verbs = {
  created: 'Added', updated: 'Updated', completed: 'Completed', reopened: 'Reopened', deleted: 'Deleted',
  restored: 'Restored', accepted: 'Accepted', dismissed: 'Dismissed',
}
const LIVE_MS = 2600

export default function Board({ accountMenu, userId }) {
  const [activeFilter, setActiveFilter] = useState(filters[0])
  const [view, setView] = useState('timeline')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('default')
  const [owner, setOwner] = useState('all')
  const saveErrorRef = useRef()
  const remoteRef = useRef()
  const board = useBoard({
    userId,
    onError: (error) => saveErrorRef.current?.(error),
    onRemoteChange: (entries) => remoteRef.current?.(entries),
  })
  // Cards and company cells changed from outside this tab, animating for a moment
  const [live, setLive] = useState(null)
  const queryClient = useQueryClient()
  const deals = board.deals ?? []
  const setDeals = board.setDeals
  // { type: 'event', dealId, eventId, isNew } | { type: 'company', dealId, isNew } | null
  const [selection, setSelection] = useState(null)
  const [recentId, setRecentId] = useState(null)
  const [toasts, setToasts] = useState([])
  const searchRef = useRef()

  // ---------- toasts ----------

  const dismissToast = (id) => setToasts((ts) => ts.filter((t) => t.id !== id))
  const toast = (message, kind = 'success', action) => {
    const id = newId()
    setToasts((ts) => [...ts.slice(-2), { id, message, kind, action, duration: TOAST_MS }])
    setTimeout(() => dismissToast(id), TOAST_MS)
  }
  // Snapshot-based undo: restore the deals exactly as they were before the change
  const undoable = (message, kind) => {
    const snapshot = deals
    toast(message, kind, { label: 'Undo', onClick: () => setDeals(snapshot) })
  }

  // ---------- data updates ----------

  const updateDeal = (dealId, patch) =>
    setDeals((ds) => ds.map((d) => (d.id === dealId ? { ...d, ...patch } : d)))

  const updateEvent = (dealId, eventId, patch) =>
    setDeals((ds) =>
      ds.map((d) =>
        d.id === dealId
          ? { ...d, events: d.events.map((e) => (e.id === eventId ? { ...e, ...patch } : e)) }
          : d
      )
    )

  const findEvent = (dealId, eventId) =>
    deals.find((d) => d.id === dealId)?.events.find((e) => e.id === eventId)

  const deleteEvent = (dealId, eventId, { silent } = {}) => {
    const event = findEvent(dealId, eventId)
    if (!silent && event) {
      const verb = isPendingSuggestion(event) ? 'Dismissed suggestion' : 'Deleted'
      undoable(`${verb} “${event.title || 'Untitled event'}”`, 'delete')
    }
    setDeals((ds) =>
      ds.map((d) =>
        d.id === dealId ? { ...d, events: d.events.filter((e) => e.id !== eventId) } : d
      )
    )
    setSelection(null)
  }

  const toggleDone = (dealId, eventId) => {
    const event = findEvent(dealId, eventId)
    undoable(event.done ? `Reopened “${event.title}”` : `Marked “${event.title}” as done`)
    updateEvent(dealId, eventId, { done: !event.done, completedAt: event.done ? null : new Date().toISOString() })
  }

  // Accepting an AI suggestion makes it a normal event; `ai` stays so the card keeps its AI tag
  const acceptSuggestion = (dealId, eventId) => {
    const event = findEvent(dealId, eventId)
    undoable(`Added “${event.title}” to the timeline`)
    updateEvent(dealId, eventId, { ai: { ...event.ai, status: 'accepted' } })
  }

  // Insert a blank event right after `afterId` (or first, if null) and open it for editing
  const addEvent = (dealId, afterId) => {
    const deal = deals.find((d) => d.id === dealId)
    const index = afterId ? deal.events.findIndex((e) => e.id === afterId) + 1 : 0
    const prev = deal.events[index - 1]
    const event = {
      id: newId(),
      icon: 'phone',
      title: '',
      date: prev?.date ?? todayISO(),
      sortKey: sortKeyBetween(prev, deal.events[index]),
      owner: getMe(),
      variant: 'default',
      notes: '',
      done: false,
      reminders: [],
    }
    setDeals((ds) =>
      ds.map((d) =>
        d.id === dealId
          ? { ...d, events: [...d.events.slice(0, index), event, ...d.events.slice(index)] }
          : d
      )
    )
    setRecentId(event.id)
    setSelection({ type: 'event', dealId, eventId: event.id, isNew: true })
  }

  const addCompany = () => {
    const deal = {
      id: newId(),
      companyId: newId(),
      position: Math.min(0, ...deals.map((d) => d.position ?? 0)) - 1,
      name: '',
      tag: 'WARM',
      industry: '',
      city: '',
      value: '',
      logo: 'briefcase',
      logoColor: logoColors[deals.length % logoColors.length],
      events: [],
    }
    setDeals((ds) => [deal, ...ds])
    // Make sure the new company is visible
    setActiveFilter('All Deals')
    setSearch('')
    setSelection({ type: 'company', dealId: deal.id, isNew: true })
  }

  const deleteDeal = (dealId, { silent } = {}) => {
    const deal = deals.find((d) => d.id === dealId)
    if (!silent && deal) undoable(`Deleted ${deal.name || 'company'}`, 'delete')
    setDeals((ds) => ds.filter((d) => d.id !== dealId))
    setSelection(null)
  }

  // Closing a brand-new item: discard it if left empty, otherwise confirm it was added
  const closeSidebar = () => {
    if (selection?.isNew) {
      const deal = deals.find((d) => d.id === selection.dealId)
      if (selection.type === 'event') {
        const event = deal?.events.find((e) => e.id === selection.eventId)
        if (event && !event.title.trim()) return deleteEvent(deal.id, event.id, { silent: true })
        if (event) toast(`Added “${event.title}” to ${deal.name}`)
      } else if (deal) {
        if (!deal.name.trim()) return deleteDeal(deal.id, { silent: true })
        toast(`Created ${deal.name}`)
      }
    }
    setSelection(null)
  }

  // Let the "just added" highlight play once
  useEffect(() => {
    if (!recentId) return
    const t = setTimeout(() => setRecentId(null), 1600)
    return () => clearTimeout(t)
  }, [recentId])

  // ---------- keyboard shortcuts ----------

  useEffect(() => {
    const onKey = (e) => {
      if (isTyping(document.activeElement) || e.metaKey || e.ctrlKey || e.altKey || selection) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        addCompany()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  saveErrorRef.current = (error) => toast(`Couldn't save that change: ${error.message}`, 'delete')

  // Something changed from outside (the WhatsApp assistant, another tab): the board has already
  // reloaded; light up what changed and say so.
  remoteRef.current = (entries) => {
    const fresh = queryClient.getQueryData(boardKey) ?? []
    const dealOfEvent = (id) => fresh.find((d) => d.events.some((e) => e.id === id))
    const eventOfReminder = (id) => fresh.flatMap((d) => d.events).find((e) => e.reminders?.some((r) => r.id === id))
    const via = entries.some((e) => e.via === 'whatsapp') ? 'whatsapp' : 'app'
    const events = {}
    const dealsLit = {}
    let first = null
    for (const entry of entries) {
      if (entry.entity_type === 'deal_event' && entry.action !== 'deleted' && entry.action !== 'dismissed') {
        const kind = entry.action === 'created' ? 'added' : 'changed'
        if (events[entry.entity_id]?.kind !== 'added') events[entry.entity_id] = { kind, via: entry.via }
        first ??= entry
      } else if (entry.entity_type === 'reminder') {
        const event = eventOfReminder(entry.entity_id)
        if (event && !events[event.id]) events[event.id] = { kind: 'changed', via: entry.via }
      } else if (entry.entity_type === 'deal') {
        dealsLit[entry.entity_id] = entry.via
      } else if (entry.entity_type === 'company') {
        const deal = fresh.find((d) => d.companyId === entry.entity_id)
        if (deal) dealsLit[deal.id] = entry.via
      }
    }
    setLive({ events, deals: dealsLit })
    setTimeout(() => setLive(null), LIVE_MS)

    const main = first ?? entries.find((e) => e.entity_type !== 'reminder') ?? entries[0]
    const deal = main.entity_type === 'deal_event' ? dealOfEvent(main.entity_id) : fresh.find((d) => d.id === main.deal_id || d.id === main.entity_id || d.companyId === main.entity_id)
    const label = main.changes?._label
    const what = main.entity_type === 'deal' || (main.entity_type === 'company' && !label)
      ? `${verbs[main.action] ?? 'Updated'} ${deal?.name ?? 'a deal'}`
      : `${verbs[main.action] ?? 'Updated'} ${main.entity_type === 'contact' ? 'contact ' : ''}“${label ?? 'an item'}”${deal && main.entity_type !== 'company' ? ` on ${deal.name}` : ''}`
    const more = entries.filter((e) => e !== main && e.entity_type !== 'reminder').length
    const target = first && deal ? { type: 'event', dealId: deal.id, eventId: first.entity_id } : deal ? { type: 'company', dealId: deal.id } : null
    toast(
      `${via === 'whatsapp' ? 'From WhatsApp' : 'Updated in another window'}: ${what}${more ? ` and ${more} more change${more === 1 ? '' : 's'}` : ''}`,
      via === 'whatsapp' ? 'whatsapp' : 'info',
      target ? { label: 'View', onClick: () => setSelection(target) } : undefined,
    )
  }

  // ---------- derived view ----------

  const range = useMemo(() => {
    const dates = deals.flatMap((d) => d.events.map((e) => e.date)).filter(Boolean).sort()
    return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null
  }, [deals])

  const q = search.trim().toLowerCase()

  const filterCounts = useMemo(
    () => Object.fromEntries(filters.map((f) => [f, deals.filter(filterTests[f]).length])),
    [deals]
  )

  const visibleDeals = useMemo(() => {
    let list = deals.filter(filterTests[activeFilter])
    if (q) list = list.filter((d) => companyMatches(d, q) || d.events.some((e) => eventMatches(e, q)))
    // Keep a company being edited visible even if edits stop it matching
    if (selection) {
      const sel = deals.find((d) => d.id === selection.dealId)
      if (sel && !list.includes(sel)) list = [sel, ...list]
    }
    const sorter = sorters[sort]
    return sorter ? [...list].sort(sorter) : list
  }, [deals, activeFilter, q, sort, selection])

  // Fade out events that don't match the search or owner highlight
  const isEventDimmed = (deal, event) => {
    if (q && !companyMatches(deal, q) && !eventMatches(event, q)) return true
    if (owner === 'all') return false
    if (owner === 'auto') return !isAutomation(event.owner)
    return event.owner !== owner
  }

  const resetView = () => {
    setSearch('')
    setActiveFilter('All Deals')
  }

  if (board.isLoading || board.error) {
    return (
      <div className="page">
        <section className="board board-empty">
          <div className="empty">
            <div className="empty-title">{board.error ? 'Couldn’t load your deals' : 'Loading your deals…'}</div>
            {board.error && (
              <>
                <p className="empty-body">{board.error.message}</p>
                <button className="btn-secondary" onClick={() => board.refetch()}>Try again</button>
              </>
            )}
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="page">
      <TopBar
        range={range}
        accountMenu={accountMenu}
        filters={filters}
        filterCounts={filterCounts}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        view={view}
        onViewChange={setView}
        search={search}
        onSearchChange={setSearch}
        searchRef={searchRef}
        sort={sort}
        onSortChange={setSort}
        owner={owner}
        onOwnerChange={setOwner}
        onAddCompany={addCompany}
      />
      <StatsBar deals={visibleDeals} activeFilter={activeFilter} onFilterChange={setActiveFilter} />

      {visibleDeals.length === 0 ? (
        <EmptyState search={search} onReset={resetView} />
      ) : view === 'timeline' ? (
        <DealsTimeline
          deals={visibleDeals}
          selection={selection}
          recentId={recentId}
          live={live}
          isEventDimmed={isEventDimmed}
          onSelectEvent={(dealId, eventId) => setSelection({ type: 'event', dealId, eventId })}
          onSelectCompany={(dealId) => setSelection({ type: 'company', dealId })}
          onAddEvent={addEvent}
          onToggleDone={toggleDone}
          onDeleteEvent={deleteEvent}
          onAcceptEvent={acceptSuggestion}
        />
      ) : (
        <DealsTable
          deals={visibleDeals}
          selection={selection}
          onSelectCompany={(dealId) => setSelection({ type: 'company', dealId })}
          onSelectEvent={(dealId, eventId) => setSelection({ type: 'event', dealId, eventId })}
        />
      )}

      <EditSidebar
        deals={deals}
        selection={selection}
        onClose={closeSidebar}
        onSelect={setSelection}
        onUpdateDeal={updateDeal}
        onUpdateEvent={updateEvent}
        onDeleteEvent={deleteEvent}
        onDeleteDeal={deleteDeal}
        onAcceptEvent={acceptSuggestion}
      />
      <Toasts toasts={toasts} onDismiss={dismissToast} />
      <OnboardingTips />
    </div>
  )
}
