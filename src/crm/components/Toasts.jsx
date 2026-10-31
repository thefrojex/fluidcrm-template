import { CheckCircle2, Trash2, Info, MessageCircle } from 'lucide-react'

const icons = { success: CheckCircle2, delete: Trash2, info: Info, whatsapp: MessageCircle }

export default function Toasts({ toasts, onDismiss }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => {
        const Icon = icons[t.kind] ?? Info
        return (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <Icon size={17} />
            <span className="toast-message">{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  t.action.onClick()
                  onDismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <span className="toast-timer" style={{ animationDuration: `${t.duration}ms` }} />
          </div>
        )
      })}
    </div>
  )
}
