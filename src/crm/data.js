// The board's data layer. The UI keeps working on the in-memory shape from the original design
// (one object per deal, with its events and reminders); this file maps that shape to and from the
// database, and saves changes by diffing the board before and after each change. So every
// existing mutation - including snapshot Undo - persists without knowing about the database.
//
// Saving: changed or new rows are upserted, missing ones soft-deleted (deleted_at), in parent →
// child order. Blank new rows (an event with no title yet, a company with no name) wait until
// they have one, exactly like the UI discards them if closed empty.
//
// Live updates: every change anywhere (this tab, another tab, the WhatsApp assistant) writes an
// activity_log row. The board listens for those over Supabase Realtime and, on a nudge - or every
// 15 seconds if the socket is down - asks the log what changed since it last looked, reloads, and
// hands the entries to the UI to animate. Entries for this tab's own writes are skipped.

import { useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatValue, parseValue } from './lib/deals.js'
import { getMe, getMyId } from './lib/me.js'

export const boardKey = ['fluidcrm', 'board']

const typeToIcon = {
  call: 'phone', team_call: 'phoneCall', demo: 'monitor', email: 'mail', document: 'file', contract: 'fileBlank',
  legal_review: 'fileText', meeting: 'users', qa: 'message', feedback: 'messages', pricing: 'tag', negotiation: 'handshake',
  review: 'settings', lunch: 'utensils', site_visit: 'map', website_visit: 'eye', outreach: 'link', onboarding: 'rocket', closing: 'trophy',
}
const iconToType = Object.fromEntries(Object.entries(typeToIcon).map(([type, icon]) => [icon, type]))

const pad = (n) => String(n).padStart(2, '0')
// timestamptz → the "YYYY-MM-DDTHH:mm" a datetime-local input uses, in the browser's timezone
const toLocalInput = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------- database → UI ----------

function ownerLabel(row) {
  if (row.owner_kind === 'contact') return 'Client'
  if (row.owner_kind === 'team') return 'Team'
  if (row.owner_kind === 'automation') return `Auto • ${row.owner_automation === 'ai' ? 'AI' : row.owner_automation[0].toUpperCase() + row.owner_automation.slice(1)}`
  return getMe()
}

function toEvent(row) {
  return {
    id: row.id,
    icon: typeToIcon[row.event_type] ?? 'phone',
    title: row.title,
    date: row.event_date,
    owner: ownerLabel(row),
    ownerContactId: row.owner_contact_id,
    variant: row.color_variant,
    notes: row.notes ?? '',
    done: row.completed_at !== null,
    completedAt: row.completed_at,
    sortKey: Number(row.sort_key),
    origin: row.origin,
    ...(row.origin === 'ai' ? { ai: { status: row.ai_review_status, reason: row.ai_reason ?? '' } } : {}),
    reminders: (row.reminders ?? [])
      .filter((r) => r.deleted_at === null && r.status !== 'cancelled')
      .map((r) => {
        // A reminder for an employee names them (and is sent to them); older ones only had a label
        const personName = r.recipient_kind === 'user' ? r.recipient_person?.name ?? r.recipient_label ?? getMe() : null
        return {
          id: r.id,
          at: toLocalInput(r.remind_at),
          // What it was when loaded: a new time schedules it again
          loadedAt: toLocalInput(r.remind_at),
          channel: r.channel.replace('_', '-'),
          recipient: personName ?? r.recipient_label,
          recipientKind: r.recipient_kind,
          recipientContactId: r.recipient_contact_id,
          recipientPersonId: r.recipient_person_id,
          recipientPersonName: personName,
          message: r.message,
          status: r.status,
          failureReason: r.failure_reason,
          origin: r.origin,
        }
      }),
  }
}

function toDeal(row) {
  return {
    id: row.id,
    companyId: row.company.id,
    name: row.company.name,
    tag: row.tag.toUpperCase(),
    industry: row.company.industry ?? '',
    // "City" on the card is the company's area in the workspace's shared data
    city: row.company.area?.name ?? '',
    value: formatValue(row.value_amount, row.value_currency, row.value_period),
    logo: row.company.profile?.logo_key ?? 'briefcase',
    logoColor: row.company.profile?.logo_color ?? 'blue',
    ownerId: row.owner_id,
    position: Number(row.board_position),
    events: row.deal_events
      .filter((e) => e.deleted_at === null)
      .sort((a, b) => (a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : Number(a.sort_key) - Number(b.sort_key)))
      .map(toEvent),
  }
}

export async function loadBoard() {
  const { data, error } = await supabase
    .from('deals')
    .select(`id, tag, status, value_amount, value_currency, value_period, board_position, owner_id,
      company:parties!inner (id, name, industry, area:areas (name), profile:company_profiles (logo_key, logo_color)),
      deal_events (id, title, event_type, color_variant, event_date, sort_key, owner_kind, owner_contact_id, owner_automation,
        notes, completed_at, origin, ai_review_status, ai_reason, deleted_at,
        reminders (id, remind_at, channel, recipient_kind, recipient_contact_id, recipient_person_id, recipient_label, message, status, failure_reason, origin, deleted_at,
          recipient_person:people!recipient_person_id (name)))`)
    .is('deleted_at', null)
    .eq('status', 'open')
    .order('board_position')
  if (error) throw error
  const deals = data.map(toDeal)
  rememberBoard(deals)
  return deals
}

// ---------- UI → database ----------

// Companies are the workspace's (core); save_company creates or updates the shared record and
// returns its id, which a new card (with a browser-made id) switches to.
function companyCall(deal) {
  return {
    p_party_id: deal.companyId,
    p_name: deal.name.trim(),
    p_industry: deal.industry?.trim() || null,
    p_city: deal.city?.trim() ?? null,
    p_logo_key: deal.logo,
    p_logo_color: deal.logoColor,
  }
}

function dealRow(deal) {
  const value = parseValue(deal.value)
  return {
    id: deal.id,
    company_id: deal.companyId,
    tag: deal.tag.toLowerCase(),
    value_amount: value?.amount ?? null,
    value_currency: value ? value.currency : null,
    value_period: value ? value.period : null,
    board_position: deal.position ?? 0,
    deleted_at: null,
  }
}

function eventRow(deal, event) {
  const owner = event.owner ?? getMe()
  const automation = owner.startsWith('Auto') ? owner.split('•')[1].trim().toLowerCase() : null
  const pending = event.ai?.status === 'pending'
  return {
    id: event.id,
    deal_id: deal.id,
    title: event.title.trim(),
    event_type: iconToType[event.icon] ?? 'call',
    color_variant: event.variant ?? 'default',
    event_date: event.date,
    sort_key: event.sortKey ?? 0,
    owner_kind: automation ? 'automation' : owner === 'Client' ? 'contact' : owner === 'Team' ? 'team' : 'user',
    owner_contact_id: owner === 'Client' ? event.ownerContactId ?? null : null,
    owner_automation: automation,
    notes: event.notes?.trim() || null,
    completed_at: event.done && !pending ? event.completedAt ?? new Date().toISOString() : null,
    origin: event.ai ? 'ai' : event.origin ?? 'manual',
    ai_review_status: event.ai ? event.ai.status : null,
    ai_reason: event.ai ? event.ai.reason ?? null : null,
    deleted_at: null,
  }
}

function reminderRow(event, reminder) {
  // An employee's reminder keeps its person; one set to "me" is for the signed-in person
  const forPerson = Boolean(reminder.recipientPersonId) && reminder.recipient === reminder.recipientPersonName
  const toMe = !forPerson && reminder.recipient === getMe()
  const pending = event.ai?.status === 'pending'
  const at = new Date(reminder.at)
  // A new time (or a new reminder) is scheduled again; otherwise what the sender recorded stays
  const rescheduled = reminder.at !== reminder.loadedAt
  return {
    id: reminder.id,
    event_id: event.id,
    remind_at: at.toISOString(),
    channel: reminder.channel.replace('-', '_'),
    recipient_kind: forPerson || toMe ? 'user' : reminder.recipientKind === 'contact' ? 'contact' : 'custom',
    recipient_contact_id: forPerson || toMe ? null : reminder.recipientContactId ?? null,
    recipient_person_id: forPerson ? reminder.recipientPersonId : toMe ? getMyId() : null,
    recipient_label: reminder.recipient ?? '',
    message: reminder.message ?? '',
    status: pending ? 'draft' : rescheduled || !reminder.status || reminder.status === 'draft' ? 'scheduled' : reminder.status,
    failure_reason: rescheduled ? null : reminder.failureReason ?? null,
    origin: reminder.origin ?? (event.ai ? 'ai' : 'manual'),
    deleted_at: null,
  }
}

const byId = (list) => new Map(list.map((item) => [item.id, item]))

// What changed between two boards, as database writes.
export function diffBoards(prev, next) {
  const writes = { companies: [], deals: [], events: [], reminders: [], deleteDeals: [], deleteEvents: [], dismissEvents: [], deleteReminders: [] }
  const prevDeals = byId(prev)
  const nextDeals = byId(next)
  const saved = (deal) => deal.name.trim() !== ''

  for (const deal of next) {
    const before = prevDeals.get(deal.id)
    if (!saved(deal)) continue
    if (deal !== before) {
      const same = (keys) => before && saved(before) && keys.every((k) => before[k] === deal[k])
      if (!same(['name', 'industry', 'city', 'logo', 'logoColor'])) writes.companies.push(companyCall(deal))
      if (!same(['companyId', 'tag', 'value', 'position'])) writes.deals.push(dealRow(deal))
    }
    const beforeEvents = byId(before?.events ?? [])
    for (const event of deal.events) {
      if (!event.title.trim()) continue
      const old = beforeEvents.get(event.id)
      if (event === old && before && saved(before)) continue
      if (event !== old || !before || !saved(before)) writes.events.push(eventRow(deal, event))
      const oldReminders = byId(old?.reminders ?? [])
      for (const reminder of event.reminders ?? []) {
        if (reminder !== oldReminders.get(reminder.id) || event.ai?.status !== old?.ai?.status || !before || !saved(before)) {
          writes.reminders.push(reminderRow(event, reminder))
        }
      }
      for (const reminder of old?.reminders ?? []) {
        if (!(event.reminders ?? []).some((r) => r.id === reminder.id)) writes.deleteReminders.push(reminder.id)
      }
    }
    for (const old of before?.events ?? []) {
      if (deal.events.some((e) => e.id === old.id) || !old.title.trim()) continue
      if (old.ai?.status === 'pending') writes.dismissEvents.push(old.id)
      else writes.deleteEvents.push(old.id)
    }
  }
  // Removing a card removes the deal, never the company: other apps share it
  for (const deal of prev) {
    if (!nextDeals.has(deal.id) && saved(deal)) writes.deleteDeals.push(deal.id)
  }
  return writes
}

// Ids this tab wrote recently, so their activity_log echoes aren't shown as someone else's change.
const ownWrites = new Map()
const rememberOwn = (ids) => {
  const now = Date.now()
  for (const id of ids) ownWrites.set(id, now)
  for (const [id, at] of ownWrites) if (now - at > 60000) ownWrites.delete(id)
}

// Every id the database is known to have (loaded or saved). Rows it hasn't seen are inserted;
// known ones upserted (which also restores a soft-deleted row on Undo).
const knownIds = new Set()
function rememberBoard(deals) {
  for (const deal of deals ?? []) {
    knownIds.add(deal.id).add(deal.companyId)
    for (const event of deal.events) {
      knownIds.add(event.id)
      for (const reminder of event.reminders ?? []) knownIds.add(reminder.id)
    }
  }
}

// Returns browser-made company ids that became real ones: { [browserId]: companyId }.
async function applyWrites(writes) {
  const now = new Date().toISOString()
  const run = async (promise) => {
    const { error } = await promise
    if (error) throw error
  }
  const save = async (table, rows) => {
    const fresh = rows.filter((row) => !knownIds.has(row.id))
    const known = rows.filter((row) => knownIds.has(row.id))
    if (fresh.length) await run(supabase.from(table).insert(fresh))
    if (known.length) await run(supabase.from(table).upsert(known))
    for (const row of fresh) knownIds.add(row.id)
    rememberOwn(rows.map((row) => row.id))
  }
  rememberOwn([...writes.deleteReminders, ...writes.dismissEvents, ...writes.deleteEvents, ...writes.deleteDeals])
  // Companies first: a new card's deal needs its company's real id.
  const companyIds = {}
  for (const call of writes.companies) {
    const { data, error } = await supabase.rpc('save_company', call)
    if (error) throw error
    knownIds.add(data)
    if (data !== call.p_party_id) companyIds[call.p_party_id] = data
  }
  const deals = writes.deals.map((row) => (companyIds[row.company_id] ? { ...row, company_id: companyIds[row.company_id] } : row))
  // Parents before children, deletes last (children of a deleted parent go with it).
  await save('deals', deals)
  await save('deal_events', writes.events)
  await save('reminders', writes.reminders)
  if (writes.deleteReminders.length) await run(supabase.from('reminders').update({ deleted_at: now }).in('id', writes.deleteReminders))
  if (writes.dismissEvents.length) {
    await run(supabase.from('deal_events').update({ ai_review_status: 'dismissed', deleted_at: now }).in('id', writes.dismissEvents))
    await run(supabase.from('reminders').update({ status: 'cancelled' }).in('event_id', writes.dismissEvents).in('status', ['draft', 'scheduled']))
  }
  if (writes.deleteEvents.length) await run(supabase.from('deal_events').update({ deleted_at: now }).in('id', writes.deleteEvents))
  if (writes.deleteDeals.length) await run(supabase.from('deals').update({ deleted_at: now }).in('id', writes.deleteDeals))
  return companyIds
}

// A board with browser-made company ids swapped for the real ones.
const withCompanyIds = (deals, ids) =>
  !deals || !Object.keys(ids).length ? deals : deals.map((deal) => (ids[deal.companyId] ? { ...deal, companyId: ids[deal.companyId] } : deal))

const isEmpty = (writes) => Object.values(writes).every((list) => list.length === 0)

const schema = import.meta.env.VITE_SUPABASE_SCHEMA
const pollMs = 15000

const activityColumns = 'id, deal_id, entity_type, entity_id, action, changes, via, created_at'

// Activity after `since` (null = from the start), oldest first.
async function activitySince(since) {
  let request = supabase.from('activity_log').select(activityColumns)
  if (since) request = request.gt('created_at', since)
  const { data, error } = await request.order('created_at', { ascending: true }).limit(100)
  if (error) throw error
  return data
}

// Where to start: the newest entry's time (null when the log is still empty).
async function newestActivity() {
  const { data, error } = await supabase.from('activity_log').select('created_at').order('created_at', { ascending: false }).limit(1)
  if (error) throw error
  return data[0]?.created_at ?? null
}

// [deals, setDeals] like useState, backed by the database. Edits apply at once and are saved
// shortly after (typing in the sidebar becomes one write, not one per key). While edits are
// waiting, nothing from outside overwrites them; outside changes are applied right after.
// onRemoteChange(entries) gets the activity_log rows behind each outside change, after the
// board has been reloaded to include them.
export function useBoard({ userId, onError, onRemoteChange } = {}) {
  const queryClient = useQueryClient()
  const synced = useRef(null) // the board as the database last saw it
  const pending = useRef(false)
  const timer = useRef(null)
  const saving = useRef(Promise.resolve())
  const lastSeen = useRef(undefined) // newest activity_log created_at handled; undefined = not read yet
  const checking = useRef(null)
  const recheck = useRef(false)
  const onRemote = useRef(onRemoteChange)
  onRemote.current = onRemoteChange

  const query = useQuery({
    queryKey: boardKey,
    queryFn: loadBoard,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (query.data && !pending.current) synced.current = query.data
  }, [query.data])

  const flush = useCallback(() => {
    timer.current = null
    saving.current = saving.current.then(async () => {
      const next = queryClient.getQueryData(boardKey)
      const prev = synced.current ?? []
      const writes = diffBoards(prev, next ?? [])
      try {
        const ids = isEmpty(writes) ? {} : await applyWrites(writes)
        if (Object.keys(ids).length) queryClient.setQueryData(boardKey, (current) => withCompanyIds(current, ids))
        synced.current = withCompanyIds(next, ids)
      } catch (error) {
        onError?.(error)
        // The database is the truth: reload it rather than keep a board that didn't save
        synced.current = null
        await queryClient.invalidateQueries({ queryKey: boardKey })
      } finally {
        if (!timer.current) {
          pending.current = false
          if (recheck.current) checkForChanges.current()
        }
      }
    })
  }, [queryClient, onError])

  // Ask the log what changed since we last looked; reload and report anything not ours.
  const checkForChanges = useRef(async () => {})
  checkForChanges.current = async () => {
    if (pending.current) {
      recheck.current = true // runs once the local edits are saved
      return
    }
    if (checking.current) {
      recheck.current = true
      return checking.current
    }
    recheck.current = false
    checking.current = (async () => {
      try {
        if (lastSeen.current === undefined) {
          lastSeen.current = await newestActivity()
          return
        }
        const entries = await activitySince(lastSeen.current)
        if (!entries.length) return
        lastSeen.current = entries[entries.length - 1].created_at
        const outside = entries.filter((entry) => !(entry.via === 'app' && ownWrites.has(entry.entity_id)))
        if (!outside.length || pending.current) return
        await queryClient.refetchQueries({ queryKey: boardKey, exact: true })
        onRemote.current?.(outside)
      } catch {
        // The next nudge or poll tries again
      } finally {
        checking.current = null
        if (recheck.current && !pending.current) checkForChanges.current()
      }
    })()
    return checking.current
  }

  // Where to start reading the log, then the socket plus a slow poll as its safety net.
  useEffect(() => {
    checkForChanges.current()
    const poll = setInterval(() => checkForChanges.current(), pollMs)
    const onFocus = () => checkForChanges.current()
    window.addEventListener('focus', onFocus)
    let channel = null
    if (userId) {
      let nudge = null
      channel = supabase
        .channel(`fluidcrm-activity-${userId}`)
        // Realtime applies the log's access rules, so this only hears about deals this person can see
        .on('postgres_changes', { event: 'INSERT', schema, table: 'activity_log' }, () => {
          // A WhatsApp action writes a few rows in one go; look once they've all landed
          clearTimeout(nudge)
          nudge = setTimeout(() => checkForChanges.current(), 250)
        })
        .subscribe()
    }
    return () => {
      clearInterval(poll)
      window.removeEventListener('focus', onFocus)
      if (channel) supabase.removeChannel(channel)
    }
  }, [userId])

  const setDeals = useCallback((update) => {
    queryClient.setQueryData(boardKey, (current) => (typeof update === 'function' ? update(current ?? []) : update))
    pending.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 600)
  }, [queryClient, flush])

  // Save anything still waiting before the tab goes away
  useEffect(() => {
    const onHide = () => {
      if (timer.current) {
        clearTimeout(timer.current)
        flush()
      }
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [flush])

  return { deals: query.data, setDeals, isLoading: query.isLoading, error: query.error, refetch: query.refetch }
}

// New ids are generated in the browser, so a new card can be edited (and undone) before it saves.
export const newId = () => crypto.randomUUID()

// A sort key between two neighbours on the timeline (fractional, so nothing else is renumbered).
export function sortKeyBetween(prev, next) {
  if (prev?.sortKey === undefined && next?.sortKey === undefined) return 0
  if (prev?.sortKey === undefined) return next.sortKey - 1
  if (next?.sortKey === undefined) return prev.sortKey + 1
  return (prev.sortKey + next.sortKey) / 2
}
