import { Wallet, Briefcase, CalendarClock, AlertTriangle } from 'lucide-react'
import { dueWithin, formatLakhs, overdueCount, valueInLakhs } from '../lib/deals.js'

// Rolls the visible deals up into a few headline numbers
export default function StatsBar({ deals, activeFilter, onFilterChange }) {
  const pipeline = deals.reduce((sum, d) => sum + valueInLakhs(d.value), 0)
  const dueThisWeek = deals.reduce((sum, d) => sum + dueWithin(d, 7), 0)
  const overdue = deals.reduce((sum, d) => sum + overdueCount(d), 0)

  const stats = [
    { icon: Wallet, label: 'Pipeline value', value: `${formatLakhs(pipeline)}/yr`, tone: 'blue' },
    { icon: Briefcase, label: 'Active deals', value: deals.length, tone: 'neutral' },
    { icon: CalendarClock, label: 'Due in next 7 days', value: dueThisWeek, tone: 'neutral' },
    {
      icon: AlertTriangle,
      label: 'Overdue events',
      value: overdue,
      tone: overdue ? 'red' : 'neutral',
      onClick: () => onFilterChange(activeFilter === 'Overdue' ? 'All Deals' : 'Overdue'),
      active: activeFilter === 'Overdue',
    },
  ]

  return (
    <div className="stats">
      {stats.map(({ icon: Icon, label, value, tone, onClick, active }) => {
        const Tag = onClick ? 'button' : 'div'
        return (
          <Tag
            key={label}
            className={`stat stat-${tone} ${onClick ? 'is-clickable' : ''} ${active ? 'is-active' : ''}`}
            onClick={onClick}
          >
            <span className="stat-icon"><Icon size={17} /></span>
            <span className="stat-text">
              <span className="stat-label">{label}</span>
              <span className="stat-value">{value}</span>
            </span>
            {onClick && <span className="stat-hint">{active ? 'Clear filter' : 'View'}</span>}
          </Tag>
        )
      })}
    </div>
  )
}
