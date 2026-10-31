import { cloneElement, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Wraps a single element; shows a small label (and optional shortcut) after a short hover delay.
// Rendered in a portal so it isn't clipped by scrolling rows.
export default function Tooltip({ label, shortcut, side = 'top', children }) {
  const [pos, setPos] = useState(null)
  const timer = useRef()

  useEffect(() => () => clearTimeout(timer.current), [])

  const show = (el, delay) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const r = el.getBoundingClientRect()
      setPos({ x: r.left + r.width / 2, y: side === 'top' ? r.top : r.bottom })
    }, delay)
  }
  const hide = () => {
    clearTimeout(timer.current)
    setPos(null)
  }

  const p = children.props
  return (
    <>
      {cloneElement(children, {
        onMouseEnter: (e) => { p.onMouseEnter?.(e); show(e.currentTarget, 350) },
        onMouseLeave: (e) => { p.onMouseLeave?.(e); hide() },
        onFocus: (e) => { p.onFocus?.(e); if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget, 0) },
        onBlur: (e) => { p.onBlur?.(e); hide() },
        onClick: (e) => { p.onClick?.(e); hide() },
      })}
      {pos &&
        createPortal(
          <div className={`tooltip tooltip-${side}`} style={{ left: pos.x, top: pos.y }} role="tooltip">
            {label}
            {shortcut && <kbd>{shortcut}</kbd>}
          </div>,
          document.body
        )}
    </>
  )
}
