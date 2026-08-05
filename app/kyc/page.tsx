'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useWalletWeb3 } from '@/hooks/useWalletWeb3'
import { useKyc } from '@/hooks/useKyc'
import KycNaturalPersonForm from '@/components/partner/kyc/KycNaturalPersonForm'
import KycLegalPersonForm from '@/components/partner/kyc/KycLegalPersonForm'
import KycSessionResult from '@/components/partner/kyc/KycSessionResult'

type Mode = 'pf' | 'pj'

/** Encurta um endereço longo mantendo as pontas, que é o que se confere. */
function shortenAddress(address: string): string {
  return address.length <= 18 ? address : `${address.slice(0, 8)}…${address.slice(-6)}`
}

export default function KycPage() {
  const { activeAddress } = useWalletWeb3()
  const kyc = useKyc()
  const [mode, setMode] = useState<Mode>('pf')

  const switchMode = (m: Mode) => {
    if (m === mode) return
    kyc.reset()
    setMode(m)
  }

  return (
    <div className="kyc-wrap">
      <header className="kyc-head">
        <div>
          <p className="kyc-eyebrow">
            Partner API
            <span className="kyc-badge">sandbox</span>
          </p>
          <h1 className="kyc-title">Verificação de identidade</h1>
          <p className="kyc-lede">
            Abre uma sessão de KYC (pessoa física) ou KYB (pessoa jurídica) na Partner API. A
            consulta de documento preenche o formulário com os dados da Receita Federal.
          </p>
        </div>
        <Link href="/" className="btn btn-outline btn-sm">
          ← Início
        </Link>
      </header>

      <div className="kyc-seg" role="tablist" aria-label="Tipo de verificação">
        <button
          role="tab"
          aria-selected={mode === 'pf'}
          onClick={() => switchMode('pf')}
          disabled={kyc.busy}
        >
          Pessoa física
        </button>
        <button
          role="tab"
          aria-selected={mode === 'pj'}
          onClick={() => switchMode('pj')}
          disabled={kyc.busy}
        >
          Pessoa jurídica
        </button>
      </div>

      <div className="kyc-cols">
        <div>
          {mode === 'pf' ? (
            <KycNaturalPersonForm kyc={kyc} walletAddress={activeAddress ?? ''} />
          ) : (
            <KycLegalPersonForm kyc={kyc} walletAddress={activeAddress ?? ''} />
          )}
        </div>

        <aside className="rail">
          <div className="rail-card">
            <p className="rail-label">Carteira</p>
            {activeAddress ? (
              <p className="rail-value" title={activeAddress}>
                {shortenAddress(activeAddress)}
              </p>
            ) : (
              <p className="rail-empty">
                Nenhuma carteira conectada. A identidade da verificação é vinculada a ela.
              </p>
            )}
          </div>

          {kyc.session ? (
            <KycSessionResult
              session={kyc.session}
              polling={kyc.phase === 'pending'}
              onReset={kyc.reset}
            />
          ) : (
            <div className="rail-card">
              <p className="rail-label">Sessão</p>
              <p className="rail-empty">O resultado aparece aqui depois do envio.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
