import { committedEvents, formatDay } from '../lib/deals.js'
import Tooltip from './Tooltip.jsx'

const statusLabel = { done: 'Done', overdue: 'Overdue', next: 'Next', upcoming: 'Upcoming' }

// One segment per event, coloured by status, so a row's progress reads at a glance
export default function DealProgress({ deal, statuses }) {
  const events = committedEvents(deal)
  const done = events.filter((e) => statuses[e.id] === 'done').length
  const overdue = events.filter((e) => statuses[e.id] === 'overdue').length
  if (!events.length) return <span className="progress-empty">No events yet</span>
  return (
    <span className="progress" aria-label={`${done} of ${events.length} events done`}>
      <span className="progress-segments">
        {events.map((e) => (
          <Tooltip key={e.id} label={`${e.title || 'Untitled event'} · ${formatDay(e.date)} · ${statusLabel[statuses[e.id]]}`}>
            <span className={`seg seg-${statuses[e.id]}`} />
          </Tooltip>
        ))}
      </span>
      {overdue > 0 ? (
        <span className="progress-text is-overdue">{overdue} overdue</span>
      ) : (
        <span className="progress-text">{done}/{events.length}</span>
      )}
    </span>
  )
}
