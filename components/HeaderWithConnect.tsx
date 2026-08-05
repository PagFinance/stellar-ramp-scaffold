// components/HeaderWithConnect.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ConnectModal from '@/components/ConnectModal'

// Hook unificado
import { useWalletWeb3 } from '@/hooks/useWalletWeb3'
import { endPartnerSession } from '@/lib/partner/session'
import { useStellarWallet } from '@/contexts/StellarWalletProvider'
import { shortenAddress } from '@/lib/helpers/shortenAddress'
import { useStuckConnectingGuard } from '@/hooks/useStuckConnectingGuard'

export default function HeaderWithConnect() {
  const [open, setOpen] = useState(false)

  // ---- Unificado (endereço ativo, chain ativa, conectado, etc.)
  const { activeAddress, isConnected, activeWallet } = useWalletWeb3()

  // ---- Logout: encerra a sessão de parceiro (cookie de prova-de-posse) sempre
  // que a carteira autenticada desconecta OU troca. Assim o cookie nunca
  // sobrevive à wallet que o emitiu; a próxima operação re-autentica. No-op em
  // dev (sem APP_SESSION_SECRET, não há cookie a limpar).
  const prevAddrRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevAddrRef.current
    if (prev && prev !== activeAddress) {
      void endPartnerSession()
    }
    prevAddrRef.current = activeAddress
  }, [activeAddress])

  // ---- Stellar (connecting)
  const { connecting: stellarConnecting } = useStellarWallet()

  // ---- Estado agregado
  // `connecting` pode ficar preso em true quando a popup de aprovação é fechada
  // sem aprovar/rejeitar (a promise de connect fica pendente). O guard "expira"
  // esse estado para o botão voltar ao normal em vez de ficar travado.
  const connecting = useStuckConnectingGuard(Boolean(stellarConnecting))

  // ---- Label dinâmica
  const buttonLabel = useMemo(() => {
    if (connecting || activeWallet?.busy) return 'Conectando...'
    if (!isConnected) return 'Conectar carteira'

    const label = activeWallet?.label ?? 'Stellar'
    return `${label} • ${shortenAddress(activeAddress ?? '')}`
  }, [connecting, activeWallet?.busy, isConnected, activeWallet?.label, activeAddress])

  return (
    <>
      <header
        style={{
          display: 'flex',
          justifyContent: 'end',
          padding: 16,
          borderBottom: '1px solid #1c1f2c',
        }}
      >
        <button
          onClick={() => setOpen(true)}
          className="btn btn-neutral"
          title={isConnected ? 'Abrir opções de conexão' : 'Conectar carteira'}
          disabled={connecting}
        >
          {buttonLabel}
        </button>
      </header>

      <ConnectModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
