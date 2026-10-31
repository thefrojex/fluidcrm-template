import { useState } from 'react'
import { Lightbulb, X } from 'lucide-react'

const STORAGE_KEY = 'fluidcrm.tips.dismissed'

const tips = [
  { title: 'Click any card to edit it', body: 'Events and companies open in a panel on the right. Changes save as you type.' },
  { title: 'Add events anywhere', body: 'Hover the gap between two events and click the + to slot a new one in.' },
  { title: 'Move fast with the keyboard', body: 'Press / to search, N to add a company and Esc to close the panel.' },
]

const readDismissed = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

// Sequenced, one-at-a-time tips instead of a wall of instructions
export default function OnboardingTips() {
  const [dismissed, setDismissed] = useState(readDismissed)
  const [step, setStep] = useState(0)

  if (dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // storage unavailable; tips simply reappear next visit
    }
  }

  const tip = tips[step]
  const last = step === tips.length - 1
  return (
    <div className="tips" role="status">
      <div className="tips-head">
        <span className="tips-icon"><Lightbulb size={16} /></span>
        <span className="tips-step">Tip {step + 1} of {tips.length}</span>
        <button className="tips-close" onClick={dismiss} aria-label="Dismiss tips">
          <X size={15} />
        </button>
      </div>
      <div className="tips-body" key={step}>
        <div className="tips-title">{tip.title}</div>
        <p>{tip.body}</p>
      </div>
      <div className="tips-foot">
        <div className="tips-dots">
          {tips.map((_, i) => (
            <span key={i} className={i === step ? 'is-active' : ''} />
          ))}
        </div>
        <button className="tips-next" onClick={() => (last ? dismiss() : setStep(step + 1))}>
          {last ? 'Got it' : 'Next'}
        </button>
      </div>
    </div>
  )
}
