import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type ToastVariant = 'default' | 'success' | 'error' | 'warning' | 'reminder'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  title: string
  description?: string
  variant?: ToastVariant
  /** milliseconds before auto-dismiss; 0 keeps it until dismissed. */
  duration?: number
  icon?: React.ReactNode
  action?: ToastAction
  id?: string
}

interface ToastItem extends ToastOptions {
  id: string
}

let opener: ((item: ToastItem) => void) | null = null
let seq = 0

/** Show a toast in the top-right corner. Returns its id. */
export function toast(options: ToastOptions): string {
  const id = options.id ?? `toast-${Date.now()}-${seq++}`
  opener?.({ ...options, id })
  return id
}

function Stroke({ children, color }: { children: React.ReactNode; color?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color ?? 'currentColor'} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" width={16} height={16}>
      {children}
    </svg>
  )
}

function variantIcon(variant: ToastVariant): React.ReactNode {
  switch (variant) {
    case 'success':
      return <Stroke><circle cx="12" cy="12" r="9" /><path d="m8.5 12.2 2.4 2.4 4.6-5" /></Stroke>
    case 'error':
      return <Stroke><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></Stroke>
    case 'warning':
      return <Stroke><path d="M12 4 3 19h18L12 4Z" /><path d="M12 10v4M12 17.2h.01" /></Stroke>
    case 'reminder':
      return <Stroke><path d="M6 16V11a6 6 0 0 1 12 0v5" /><path d="M4.5 16h15M10 19.2a2 2 0 0 0 4 0" /><path d="M12 4.4V3" /></Stroke>
    default:
      return <Stroke><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Stroke>
  }
}

function ToastCard({ item, onClose }: { item: ToastItem; onClose: (id: string) => void }): React.JSX.Element {
  const [leaving, setLeaving] = useState(false)
  const [paused, setPaused] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const duration = item.duration ?? (item.action ? 9000 : 6500)
  const variant = item.variant ?? 'default'

  const close = useCallback(() => {
    setLeaving(true)
    window.setTimeout(() => onClose(item.id), 220)
  }, [item.id, onClose])

  useEffect(() => {
    if (!duration || paused) return
    timer.current = setTimeout(close, duration)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [duration, paused, close])

  return (
    <div
      className={`rs-toast rs-toast--${variant}${leaving ? ' is-leaving' : ''}${paused ? ' is-paused' : ''}`}
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="rs-toast__glow" aria-hidden="true" />
      <span className="rs-toast__icon" aria-hidden="true">{item.icon ?? variantIcon(variant)}</span>
      <div className="rs-toast__body">
        <p className="rs-toast__title">{item.title}</p>
        {item.description ? <p className="rs-toast__desc">{item.description}</p> : null}
        {item.action ? (
          <button
            type="button"
            className="rs-toast__action"
            onClick={() => {
              item.action?.onClick()
              close()
            }}
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <button type="button" className="rs-toast__close" aria-label="Dismiss" onClick={close}>
        <Stroke><path d="M6 6l12 12M18 6 6 18" /></Stroke>
      </button>
      {duration ? <span className="rs-toast__bar" style={{ animationDuration: `${duration}ms` }} aria-hidden="true" /> : null}
    </div>
  )
}

/** Mount once near the app root to power `toast(...)`. */
export function Toaster(): React.JSX.Element | null {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    opener = (item) =>
      setItems((list) => {
        const next = [...list.filter((t) => t.id !== item.id), item]
        return next.slice(-4)
      })
    return () => {
      opener = null
    }
  }, [])

  const remove = useCallback((id: string) => setItems((list) => list.filter((t) => t.id !== id)), [])

  if (!items.length || typeof document === 'undefined') return null

  return createPortal(
    <div className="rs-toast-host" role="region" aria-label="Notifications">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} onClose={remove} />
      ))}
    </div>,
    document.body,
  )
}
