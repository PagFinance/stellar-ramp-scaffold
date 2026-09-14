'use client'
//
// O dialog COMPLETO de "Conectar carteira": overlay + portal + a11y de diálogo
// (foco inicial, focus-trap, Escape, restauração de foco) + header. O conteúdo
// é o <WalletOptions/> - quem quer o mesmo fluxo dentro de um dialog do próprio
// design system usa WalletOptions direto.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import WalletOptions from '@/components/WalletOptions'

type Props = {
  open: boolean
  onClose: () => void
}

export default function ConnectModal({ open, onClose }: Props) {
  const [mounted, setMounted] = useState(false)
  const modalRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Foco inicial + focus-trap + restauração de foco ao fechar (a11y de diálogo).
  useEffect(() => {
    if (!open || !mounted) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const node = modalRef.current
    const focusable = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'a,button,[tabindex]:not([tabindex="-1"]),input,select,textarea',
            ),
          ).filter(
            (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
          )
        : []

    focusable()[0]?.focus()

    const handleFocus = (e: FocusEvent) => {
      if (node && !node.contains(e.target as Node)) focusable()[0]?.focus()
    }
    document.addEventListener('focusin', handleFocus)
    return () => {
      document.removeEventListener('focusin', handleFocus)
      // Só restaura o foco se ninguém o assumiu (caiu no body). Se o modal do
      // Stellar Wallets Kit já tomou o foco no handoff, NÃO roubamos de volta.
      const active = document.activeElement
      if (!active || active === document.body) previouslyFocused?.focus?.()
    }
  }, [open, mounted])

  // Fechado = desmontado: o WalletOptions (e o erro dele) zera a cada abertura.
  if (!mounted || !open) return null

  // ---------- styles ----------
  const overlay: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99999,
  }
  const modal: React.CSSProperties = {
    width: 460,
    maxWidth: '92vw',
    maxHeight: '88vh',
    overflowY: 'auto',
    background: '#12141a',
    color: '#fff',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 20px 60px rgba(0,0,0,.45)',
    border: '1px solid #222531',
  }
  const headerRow: React.CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 12 }
  const title: React.CSSProperties = { fontSize: 18, fontWeight: 700, margin: 0, flex: 1 }
  const closeBtn: React.CSSProperties = {
    background: 'transparent',
    color: '#aab2c0',
    border: 'none',
    cursor: 'pointer',
    fontSize: 18,
  }

  const content = (
    <div style={overlay} onClick={onClose}>
      <div
        style={modal}
        role="dialog"
        aria-modal="true"
        aria-label="Conectar carteira"
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
      >
        <div style={headerRow}>
          <h2 style={title}>Conectar carteira Stellar</h2>
          <button aria-label="Fechar modal" style={closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        <WalletOptions onDone={onClose} />
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
