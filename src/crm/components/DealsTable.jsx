import { AlertCircle } from 'lucide-react'
import { companyIcons, eventIcons } from './icons.js'
import { eventStatuses, formatDay, nextEvent, overdueCount } from '../lib/deals.js'
import DealProgress from './DealProgress.jsx'

// Same deals as the timeline, rolled up one row per company
export default function DealsTable({ deals, selection, onSelectCompany, onSelectEvent }) {
  return (
    <section className="board board-table">
      <table className="deals-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Status</th>
            <th>Industry</th>
            <th>City</th>
            <th className="num">Deal value</th>
            <th>Progress</th>
            <th>Next step</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal, i) => {
            const Logo = companyIcons[deal.logo]
            const statuses = eventStatuses(deal)
            const next = nextEvent(deal)
            const NextIcon = next && eventIcons[next.icon]
            const overdue = overdueCount(deal)
            const selected = selection?.dealId === deal.id
            return (
              <tr
                key={deal.id}
                className={selected ? 'is-selected' : ''}
                style={{ '--i': i }}
                onClick={() => onSelectCompany(deal.id)}
              >
                <td>
                  <span className="table-company">
                    <span className={`company-logo company-logo-sm logo-${deal.logoColor}`}>
                      <Logo size={16} />
                    </span>
                    <span className="table-company-name">{deal.name || 'Untitled company'}</span>
                  </span>
                </td>
                <td>
                  <span className={`deal-tag tag-${deal.tag.toLowerCase()}`}>{deal.tag}</span>
                </td>
                <td className="muted">{deal.industry || '—'}</td>
                <td className="muted">{deal.city || '—'}</td>
                <td className="num strong">{deal.value || '—'}</td>
                <td><DealProgress deal={deal} statuses={statuses} /></td>
                <td>
                  <span className="table-next">
                    {next ? (
                      <button
                        className="table-next-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectEvent(deal.id, next.id)
                        }}
                      >
                        <NextIcon size={15} />
                        <span className="truncate">{next.title || 'Untitled event'}</span>
                        <span className="muted">{formatDay(next.date)}</span>
                      </button>
                    ) : (
                      <span className="muted">Nothing scheduled</span>
                    )}
                    {overdue > 0 && (
                      <span className="overdue-chip">
                        <AlertCircle size={12} strokeWidth={2.5} />
                        {overdue} overdue
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
