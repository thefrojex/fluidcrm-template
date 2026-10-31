// "Today" is the real current day (the sample data is dated around it when a board is seeded)
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export const TODAY = startOfDay(new Date())
// "Now" for reminders, which have a time of day; read fresh each time
const now = () => new Date()

const DAY = 24 * 60 * 60 * 1000
const pad = (n) => String(n).padStart(2, '0')

// Event dates are calendar days stored as "YYYY-MM-DD"
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const todayISO = () => toISODate(TODAY)
export const parseDate = (iso) => new Date(`${iso}T00:00`)
// "Oct 20", plus the year when it isn't this year
export const formatDay = (iso) => {
  const d = parseDate(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', d.getFullYear() === TODAY.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

export const isPast = (label) => parseDate(label) < TODAY

export const byDate = (a, b) => parseDate(a.date) - parseDate(b.date)

// Events in display order (stable, so a newly inserted event stays after its neighbour on the same day)
export const sortedEvents = (deal) => [...deal.events].sort(byDate)

// AI provenance: pending suggestions aren't committed work; accepted ones are normal events
export const isPendingSuggestion = (e) => e.ai?.status === 'pending'
export const isFromAI = (e) => Boolean(e.ai)

// 'done' | 'overdue' | 'next' | 'upcoming' | 'suggested'
// Pending AI suggestions never count as next, overdue or progress
export function eventStatuses(deal) {
  const statuses = {}
  let nextFound = false
  for (const e of sortedEvents(deal)) {
    if (isPendingSuggestion(e)) statuses[e.id] = 'suggested'
    else if (e.done) statuses[e.id] = 'done'
    else if (isPast(e.date)) statuses[e.id] = 'overdue'
    else if (!nextFound) {
      statuses[e.id] = 'next'
      nextFound = true
    } else statuses[e.id] = 'upcoming'
  }
  return statuses
}

export const overdueCount = (deal) =>
  Object.values(eventStatuses(deal)).filter((s) => s === 'overdue').length

export const nextEvent = (deal) => {
  const statuses = eventStatuses(deal)
  return sortedEvents(deal).find((e) => statuses[e.id] === 'next')
}

// Whole days from TODAY to the event (negative when in the past)
export const daysFromToday = (label) => Math.round((parseDate(label) - TODAY) / DAY)

// Short relative label used on Next / Overdue chips
export function relativeLabel(label) {
  const d = daysFromToday(label)
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  if (d === -1) return '1 day late'
  return d > 0 ? `In ${d} days` : `${-d} days late`
}

export const committedEvents = (deal) => sortedEvents(deal).filter((e) => !isPendingSuggestion(e))

export const suggestionCount = (deal) => deal.events.filter(isPendingSuggestion).length

export const dueWithin = (deal, days) =>
  deal.events.filter((e) => {
    if (isPendingSuggestion(e)) return false
    const t = parseDate(e.date) - TODAY
    return !e.done && t >= 0 && t <= days * DAY
  }).length

// "₹45L/yr" → 45, "₹1.2Cr/yr" → 120 (in lakhs)
export function valueInLakhs(value) {
  const parsed = parseValue(value)
  return parsed ? parsed.amount / 100000 : 0
}

// "₹45L/yr" ↔ { amount: 4500000, currency: 'INR', period: 'yearly' } (L = lakh, Cr = crore).
// Also accepts plain numbers, "45 lakh", "2.5 cr per month", "₹80,000". Null when it can't tell.
export function parseValue(value) {
  const m = /^\s*(?:₹|rs\.?|inr)?\s*([\d,]*\.?\d+)\s*(k|l|lakh|lakhs|lac|cr|crore|crores)?\s*(?:\/|per)?\s*(yr|year|yearly|annum|mo|month|monthly)?\s*$/i.exec(value ?? '')
  if (!m) return null
  const n = parseFloat(m[1].replace(/,/g, ''))
  const unit = (m[2] ?? '').toLowerCase()
  const factor = unit === 'k' ? 1000 : unit.startsWith('l') ? 100000 : unit.startsWith('c') ? 10000000 : 1
  const period = (m[3] ?? '').toLowerCase()
  return { amount: Math.round(n * factor * 100) / 100, currency: 'INR', period: period.startsWith('y') || period === 'annum' ? 'yearly' : period.startsWith('m') ? 'monthly' : 'one_time' }
}

export function formatValue(amount, currency, period) {
  if (amount === null || amount === undefined) return ''
  const n = Number(amount)
  const body = n >= 10000000 ? `${+(n / 10000000).toFixed(2)}Cr` : n >= 100000 ? `${+(n / 100000).toFixed(1)}L` : n.toLocaleString('en-IN')
  const suffix = period === 'yearly' ? '/yr' : period === 'monthly' ? '/mo' : ''
  return `${currency === 'INR' || !currency ? '₹' : `${currency} `}${body}${suffix}`
}

export function formatLakhs(lakhs) {
  if (lakhs >= 100) return `₹${+(lakhs / 100).toFixed(2)}Cr`
  return `₹${+lakhs.toFixed(1)}L`
}

export const isAutomation = (owner) => owner.startsWith('Auto')

const includes = (text, q) => (text ?? '').toLowerCase().includes(q)

export const companyMatches = (deal, q) =>
  includes(deal.name, q) || includes(deal.industry, q) || includes(deal.city, q)

export const eventMatches = (event, q) => includes(event.title, q) || includes(event.owner, q)

export const filterTests = {
  'All Deals': () => true,
  Hot: (d) => d.tag === 'HOT',
  Warm: (d) => d.tag === 'WARM',
  Overdue: (d) => overdueCount(d) > 0,
  Enterprise: (d) => d.tag === 'ENTERPRISE',
}

export const sorters = {
  default: null,
  value: (a, b) => valueInLakhs(b.value) - valueInLakhs(a.value),
  next: (a, b) => {
    const an = nextEvent(a)
    const bn = nextEvent(b)
    if (!an || !bn) return (an ? 0 : 1) - (bn ? 0 : 1)
    return parseDate(an.date) - parseDate(bn.date)
  },
  name: (a, b) => a.name.localeCompare(b.name),
}

// ---------- reminders ----------

// Reminder times are local "YYYY-MM-DDTHH:mm" strings (what a datetime-local input produces)
export const reminderDate = (r) => new Date(r.at)

export const reminderState = (r) => (reminderDate(r) <= now() ? 'sent' : 'scheduled')

export const sortedReminders = (event) =>
  [...(event.reminders ?? [])].sort((a, b) => reminderDate(a) - reminderDate(b))

export const nextReminder = (event) => sortedReminders(event).find((r) => reminderState(r) === 'scheduled')

export const formatReminderTime = (r) =>
  reminderDate(r).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export const reminderChannels = [
  { value: 'in-app', label: 'In-app' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'sms', label: 'SMS' },
]

export const channelLabel = (value) => reminderChannels.find((c) => c.value === value)?.label ?? value
