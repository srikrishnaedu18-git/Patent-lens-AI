import { useEffect, useRef } from 'react'
import { useStore } from '../../store/useStore'

export default function Toast() {
  const { toasts, removeToast } = useStore()

  return (
    <div id="toast-container" className="toast-container" aria-live="polite" aria-atomic="false">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onRemove={() => removeToast(t.id)} />
      ))}
    </div>
  )
}

const ICONS = {
  success: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  error:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>,
  warning: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  info:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
}
const TITLES = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Notice' }

function ToastItem({ toast, onRemove }) {
  const timerRef = useRef(null)

  useEffect(() => {
    timerRef.current = setTimeout(onRemove, toast.duration)
    return () => clearTimeout(timerRef.current)
  }, [])

  return (
    <div className={`toast toast-${toast.type}`}>
      <span className="toast-icon">{ICONS[toast.type] || ICONS.info}</span>
      <div className="toast-body">
        <div className="toast-title">{TITLES[toast.type] || 'Notice'}</div>
        <div className="toast-message">{toast.message}</div>
      </div>
      <button className="toast-close" aria-label="Dismiss" onClick={onRemove}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div className="toast-progress" style={{ animationDuration: `${toast.duration}ms` }} />
    </div>
  )
}
