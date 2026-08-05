'use client'
//
// Sistema de toasts leve, sem dependências. Substitui os `alert()` bloqueantes:
// dá feedback NÃO-bloqueante e com estado (pendente → sucesso/erro), com link
// opcional (ex.: ver no explorer). Acessível (aria-live) e respeita
// prefers-reduced-motion.
//
// Uso:
//   const toast = useToast()
//   toast.success('Transação enviada', { action: { label: 'Ver no explorer', href } })
//   const id = toast.pending('Enviando…'); …; toast.update(id, { variant: 'success', message: 'Pronto' })
//   await toast.promise(fn(), { pending, success, error })

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

export type ToastVariant = 'info' | 'success' | 'error' | 'pending'

export interface ToastAction {
  label: string
  href?: string
  onClick?: () => void
}

export interface ToastOptions {
  title?: string
  message?: string
  variant?: ToastVariant
  /** ms até sumir sozinho. `pending` nunca some sozinho (0). Default 5000. */
  duration?: number
  action?: ToastAction
}

interface ToastItem extends Required<Pick<ToastOptions, 'variant'>> {
  id: number
  title?: string
  message?: string
  duration: number
  action?: ToastAction
}

interface ToastApi {
  show: (opts: ToastOptions) => number
  info: (message: string, opts?: ToastOptions) => number
  success: (message: string, opts?: ToastOptions) => number
  error: (message: string, opts?: ToastOptions) => number
  pending: (message: string, opts?: ToastOptions) => number
  update: (id: number, opts: ToastOptions) => void
  dismiss: (id: number) => void
  promise: <T>(
    p: Promise<T>,
    msgs: {
      pending: string
      success: string | ((v: T) => string | ToastOptions)
      error: string | ((e: unknown) => string | ToastOptions)
    },
  ) => Promise<T>
}

const ToastContext = createContext<ToastApi | null>(null)

const VARIANT: Record<ToastVariant, { color: string; ring: string; icon: string }> = {
  info: { color: '#5fb3f0', ring: 'rgba(95,179,240,.35)', icon: 'ℹ' },
  success: { color: '#5fd6a4', ring: 'rgba(95,214,164,.35)', icon: '✓' },
  error: { color: '#ff6b6b', ring: 'rgba(255,107,107,.35)', icon: '✕' },
  pending: { color: '#f7b955', ring: 'rgba(247,185,85,.35)', icon: '⏳' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const [mounted, setMounted] = useState(false)
  const idRef = useRef(0)
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => setMounted(true), [])
  useEffect(() => {
    const map = timers.current
    return () => {
      map.forEach((t) => clearTimeout(t))
      map.clear()
    }
  }, [])

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
    const t = timers.current.get(id)
    if (t) {
      clearTimeout(t)
      timers.current.delete(id)
    }
  }, [])

  const arm = useCallback(
    (id: number, duration: number) => {
      const existing = timers.current.get(id)
      if (existing) clearTimeout(existing)
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        )
      } else {
        timers.current.delete(id)
      }
    },
    [dismiss],
  )

  const show = useCallback(
    (opts: ToastOptions) => {
      const variant = opts.variant ?? 'info'
      const duration = opts.duration ?? (variant === 'pending' ? 0 : 5000)
      const id = ++idRef.current
      setItems((prev) => [
        ...prev,
        { id, variant, duration, title: opts.title, message: opts.message, action: opts.action },
      ])
      arm(id, duration)
      return id
    },
    [arm],
  )

  const update = useCallback(
    (id: number, opts: ToastOptions) => {
      setItems((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t
          const variant = opts.variant ?? t.variant
          const duration = opts.duration ?? (variant === 'pending' ? 0 : 5000)
          arm(id, duration)
          return {
            ...t,
            variant,
            duration,
            title: opts.title ?? t.title,
            message: opts.message ?? t.message,
            action: opts.action ?? t.action,
          }
        }),
      )
    },
    [arm],
  )

  const api = useMemo<ToastApi>(() => {
    const mk = (variant: ToastVariant) => (message: string, opts?: ToastOptions) =>
      show({ ...opts, message, variant })
    return {
      show,
      update,
      dismiss,
      info: mk('info'),
      success: mk('success'),
      error: mk('error'),
      pending: mk('pending'),
      promise: async (p, msgs) => {
        const id = show({ message: msgs.pending, variant: 'pending' })
        try {
          const v = await p
          const r = typeof msgs.success === 'function' ? msgs.success(v) : msgs.success
          update(
            id,
            typeof r === 'string'
              ? { message: r, variant: 'success' }
              : { ...r, variant: r.variant ?? 'success' },
          )
          return v
        } catch (e) {
          const r = typeof msgs.error === 'function' ? msgs.error(e) : msgs.error
          update(
            id,
            typeof r === 'string'
              ? { message: r, variant: 'error' }
              : { ...r, variant: r.variant ?? 'error' },
          )
          throw e
        }
      },
    }
  }, [show, update, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted && createPortal(<ToastViewport items={items} onDismiss={dismiss} />, document.body)}
    </ToastContext.Provider>
  )
}

function ToastViewport({
  items,
  onDismiss,
}: {
  items: ToastItem[]
  onDismiss: (id: number) => void
}) {
  const viewport: React.CSSProperties = {
    position: 'fixed',
    right: 16,
    bottom: 16,
    zIndex: 2147483000,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    maxWidth: 'min(92vw, 380px)',
    pointerEvents: 'none',
  }
  return (
    <div style={viewport} aria-live="polite" aria-relevant="additions">
      {items.map((t) => (
        <ToastCard key={t.id} item={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  )
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const v = VARIANT[item.variant]
  const card: React.CSSProperties = {
    pointerEvents: 'auto',
    display: 'grid',
    gridTemplateColumns: '22px 1fr auto',
    gap: 10,
    alignItems: 'start',
    background: '#14171f',
    border: '1px solid #262b38',
    borderLeft: `3px solid ${v.color}`,
    borderRadius: 12,
    padding: '12px 12px 12px 14px',
    boxShadow: '0 12px 34px rgba(0,0,0,.45)',
    color: '#e8edf4',
    animation: 'toastIn .18s ease',
  }
  const iconWrap: React.CSSProperties = {
    color: v.color,
    fontSize: 14,
    lineHeight: '20px',
    textAlign: 'center',
    ...(item.variant === 'pending' ? { animation: 'toastSpin 1.1s linear infinite' } : {}),
  }
  return (
    <div role="status" style={card}>
      <span style={iconWrap} aria-hidden="true">
        {v.icon}
      </span>
      <div style={{ minWidth: 0 }}>
        {item.title && (
          <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 2 }}>{item.title}</div>
        )}
        {item.message && (
          <div
            style={{ fontSize: 13.5, color: '#c3cbd8', lineHeight: 1.45, wordBreak: 'break-word' }}
          >
            {item.message}
          </div>
        )}
        {item.action &&
          (item.action.href ? (
            <a
              href={item.action.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block',
                marginTop: 6,
                fontSize: 13,
                color: v.color,
                fontWeight: 600,
              }}
            >
              {item.action.label} ↗
            </a>
          ) : (
            <button
              onClick={item.action.onClick}
              style={{
                marginTop: 6,
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                fontSize: 13,
                color: v.color,
                fontWeight: 600,
              }}
            >
              {item.action.label}
            </button>
          ))}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Fechar notificação"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#6c7688',
          cursor: 'pointer',
          fontSize: 15,
          lineHeight: '18px',
          padding: 0,
        }}
      >
        ✕
      </button>
      <style>{`
        @keyframes toastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes toastSpin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          [role="status"] { animation: none !important; }
        }
      `}</style>
    </div>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast precisa de <ToastProvider> na árvore (app/providers.tsx).')
  return ctx
}
