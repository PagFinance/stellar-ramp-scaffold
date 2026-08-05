'use client'

import Link from 'next/link'
import { useWalletWeb3 } from '@/hooks/useWalletWeb3'

export default function Page() {
  const { isConnected } = useWalletWeb3()

  return (
    <main className="row">
      <div className="card">
        <h1 style={{ margin: 0 }}>Stellar Ramp Scaffold</h1>
        <p className="muted" style={{ margin: '8px 0 0' }}>
          Conecte uma carteira Stellar no topo. Os fluxos de cash-in, cash-out e KYC são
          orquestrados pela Partner API - a transação é montada pelo backend e apenas assinada aqui.
        </p>

        {isConnected && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <Link href="/cashin" className="btn btn-primary">
              Cash-in (Pix → cripto)
            </Link>
            <Link href="/cashout" className="btn btn-outline">
              Cash-out (cripto → Pix)
            </Link>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Link href="/kyc" className="btn btn-outline">
            Verificação de identidade (KYC / KYB)
          </Link>
        </div>
      </div>

      {!isConnected && (
        <div className="card" style={{ textAlign: 'center', color: '#9aa4b2' }}>
          <p style={{ margin: 0 }}>
            👋 Comece conectando uma carteira Stellar (Freighter, Lobstr, xBull, Hana ou Albedo).
          </p>
        </div>
      )}
    </main>
  )
}
