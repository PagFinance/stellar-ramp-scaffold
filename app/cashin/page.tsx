'use client'

import Link from 'next/link'
import CashinCard from '@/components/actions/CashinCard'

export default function CashinPage() {
  return (
    <main className="row">
      <div className="card">
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h1 style={{ margin: 0 }}>Cash-in</h1>
            <p className="muted" style={{ margin: '8px 0 0' }}>
              Pix → cripto. Gere uma cobrança Pix (QR Code) via PagFinance Partner API e acompanhe a
              liquidação.
            </p>
          </div>
          <Link href="/" className="btn btn-outline">
            ← Início
          </Link>
        </div>
      </div>

      <CashinCard />
    </main>
  )
}
