'use client'

import Link from 'next/link'
import CashoutCard from '@/components/actions/CashoutCard'

export default function CashoutPage() {
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
            <h1 style={{ margin: 0 }}>Cash-out</h1>
            <p className="muted" style={{ margin: '8px 0 0' }}>
              Cripto → Pix. Cote, confirme e assine na sua carteira; a instrução vem da PagFinance
              Partner API.
            </p>
          </div>
          <Link href="/" className="btn btn-outline">
            ← Início
          </Link>
        </div>
      </div>

      <CashoutCard />
    </main>
  )
}
