import { SearchX } from 'lucide-react'

export default function EmptyState({ search, onReset }) {
  return (
    <section className="board board-empty">
      <div className="empty">
        <span className="empty-icon"><SearchX size={26} /></span>
        <div className="empty-title">No deals match</div>
        <p className="empty-body">
          {search
            ? <>Nothing found for “{search}” with the current filter.</>
            : 'There are no deals in this view yet.'}
        </p>
        <button className="btn-secondary" onClick={onReset}>Clear search and filters</button>
      </div>
    </section>
  )
}
