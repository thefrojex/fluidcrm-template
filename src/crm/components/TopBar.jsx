import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Calendar, Filter, Search, Table2, List, Plus, Inbox, X, Check } from 'lucide-react'
import Tooltip from './Tooltip.jsx'
import { getMe } from '../lib/me.js'

const sortOptions = [
  { value: 'default', label: 'Default order' },
  { value: 'next', label: 'Next activity' },
  { value: 'value', label: 'Deal value' },
  { value: 'name', label: 'Company name' },
]

const ownerOptions = () => [
  { value: 'all', label: 'Everyone' },
  { value: getMe(), label: getMe() },
  { value: 'Client', label: 'Client' },
  { value: 'Team', label: 'Team' },
  { value: 'auto', label: 'Automations' },
]

function FilterPills({ filters, counts, active, onChange }) {
  const refs = useRef({})
  const [indicator, setIndicator] = useState(null)

  // Slide the highlight under the active pill
  useLayoutEffect(() => {
    const el = refs.current[active]
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth })
  }, [active, counts])

  return (
    <nav className="filter-pills">
      {indicator && <span className="pill-indicator" style={indicator} />}
      {filters.map((f) => (
        <button
          key={f}
          ref={(el) => (refs.current[f] = el)}
          className={`pill ${active === f ? 'pill-active' : ''}`}
          onClick={() => onChange(f)}
        >
          {f}
          <span className="pill-count">{counts[f]}</span>
        </button>
      ))}
    </nav>
  )
}

function FilterPopover({ sort, onSortChange, owner, onOwnerChange }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef()
  const activeCount = (sort !== 'default') + (owner !== 'all')

  useEffect(() => {
    if (!open) return
    const onDown = (e) => !wrapRef.current.contains(e.target) && setOpen(false)
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
      <button
        className={`ctrl-btn ${open || activeCount ? 'is-on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <Filter size={16} />
        <span>Filter</span>
        {activeCount > 0 && <span className="ctrl-badge">{activeCount}</span>}
      </button>

      {open && (
        <div className="popover" role="dialog" aria-label="Filter and sort">
          <div className="popover-section">
            <div className="popover-label">Sort companies by</div>
            {sortOptions.map((o) => (
              <button key={o.value} className="popover-option" onClick={() => onSortChange(o.value)}>
                {o.label}
                {sort === o.value && <Check size={15} />}
              </button>
            ))}
          </div>
          <div className="popover-section">
            <div className="popover-label">Highlight events owned by</div>
            <div className="chip-group">
              {ownerOptions().map((o) => (
                <button
                  key={o.value}
                  className={`chip ${owner === o.value ? 'is-active' : ''}`}
                  onClick={() => onOwnerChange(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {activeCount > 0 && (
            <button
              className="popover-reset"
              onClick={() => {
                onSortChange('default')
                onOwnerChange('all')
              }}
            >
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const SearchBox = forwardRef(function SearchBox({ value, onChange }, ref) {
  return (
    <label className={`search ${value ? 'has-value' : ''}`}>
      <Search size={17} />
      <input
        ref={ref}
        value={value}
        placeholder="Search events..."
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onChange('')
            e.currentTarget.blur()
          }
        }}
      />
      {value ? (
        <button className="search-clear" onClick={() => onChange('')} aria-label="Clear search">
          <X size={14} />
        </button>
      ) : (
        <kbd className="search-kbd">/</kbd>
      )}
    </label>
  )
})

export default function TopBar({
  filters,
  filterCounts,
  activeFilter,
  onFilterChange,
  view,
  onViewChange,
  search,
  onSearchChange,
  searchRef,
  sort,
  onSortChange,
  owner,
  onOwnerChange,
  onAddCompany,
  range,
  accountMenu,
}) {
  const fmt = (iso, opts) => new Date(`${iso}T00:00`).toLocaleDateString('en-US', opts)
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand-icon"><Inbox size={20} strokeWidth={2.2} /></div>
        <h1 className="page-title">Deals</h1>
        <FilterPills
          filters={filters}
          counts={filterCounts}
          active={activeFilter}
          onChange={onFilterChange}
        />
      </div>

      <div className="topbar-right">
        {range && (
          <Tooltip label={`Showing ${fmt(range.from, { month: 'short', day: 'numeric' })} – ${fmt(range.to, { month: 'short', day: 'numeric', year: 'numeric' })}`} side="bottom">
            <button className="ctrl-btn">
              <Calendar size={16} />
              <span>{fmt(range.from, { month: 'short', year: 'numeric' })} – {fmt(range.to, { month: 'short', year: 'numeric' })}</span>
            </button>
          </Tooltip>
        )}
        <FilterPopover sort={sort} onSortChange={onSortChange} owner={owner} onOwnerChange={onOwnerChange} />
        <SearchBox ref={searchRef} value={search} onChange={onSearchChange} />
        <div className={`view-toggle view-${view}`}>
          <span className="view-indicator" />
          <Tooltip label="Table view" side="bottom">
            <button
              className={view === 'table' ? 'active' : ''}
              onClick={() => onViewChange('table')}
              aria-label="Table view"
            >
              <Table2 size={17} />
            </button>
          </Tooltip>
          <Tooltip label="Timeline view" side="bottom">
            <button
              className={view === 'timeline' ? 'active' : ''}
              onClick={() => onViewChange('timeline')}
              aria-label="Timeline view"
            >
              <List size={17} />
            </button>
          </Tooltip>
        </div>
        <Tooltip label="Add company" shortcut="N" side="bottom">
          <button className="primary-btn" onClick={onAddCompany}>
            <Plus size={18} />
            <span>Add Company</span>
          </button>
        </Tooltip>
        {accountMenu}
      </div>
    </header>
  )
}
