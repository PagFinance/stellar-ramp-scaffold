// components/actions/CashinCard.tsx
'use client'
//
// Cash-in / onramp (Pix → cripto). Fluxo canônico da partner-api:
//   1. Cotar (POST /cashin/quote) - mostra quanta cripto o usuário recebe.
//   2. Gerar cobrança (POST /cashin/intent) amarrada ao quoteId - exibe o QR Pix.
//   3. Pagar e confirmar - polling do status até liquidar.
//
// Scaffold exclusivo do Stellar: a partner-api não valida `destinationWallet`
// para Stellar, então o cash-in segue o caminho legado (só-valor) - o backend do
// parceiro credita a cripto após o pagamento.
//
// Ativo: **apenas XLM**. Não há seletor porque não há escolha - o `assetId` vem do
// `configs/gateway-config.json` (ver `lib/partner/cashinAssets.ts`, XLM = 100) e a
// rota `app/api/partner/cashin/quote` rejeita qualquer outro id.

import React, { useId, useMemo, useState } from 'react'
import { useWalletWeb3 } from '@/hooks/useWalletWeb3'
import { useCashin } from '@/hooks/useCashin'
import { useToast } from '@/components/toast/ToastProvider'
import QrDisplay from '@/components/partner/QrDisplay'
import { helpText } from '@/components/partner/formStyles'
import { getCashinAsset } from '@/lib/partner/cashinAssets'
import type { CashinQuoteResponse } from '@/lib/partner/types'

function statusBadge(phase: string, status?: string) {
  const st = (status ?? '').toUpperCase()
  if (phase === 'completed' || st === 'COMPLETED') return 'Pago ✓'
  if (phase === 'expired' || st === 'EXPIRED') return 'Expirada'
  if (phase === 'awaiting_payment') return 'Aguardando pagamento…'
  return st || '-'
}

/** "XLM/BRL" → "XLM". Fallback para o símbolo do ativo ofertado ou "cripto". */
function assetSymbol(quote: CashinQuoteResponse | null, fallback?: string) {
  const pair = quote?.priceContext?.pair ?? ''
  return pair.split('/')[0] || fallback || 'cripto'
}

function fmtCrypto(n: number) {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 6 })
}

function fmtBRL(n: number) {
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function CashinCard() {
  const { isConnected } = useWalletWeb3()
  const cashin = useCashin()
  const toast = useToast()
  const uid = useId()

  const [amount, setAmount] = useState('50')
  const [name, setName] = useState('')
  const [taxID, setTaxID] = useState('')
  const [email, setEmail] = useState('')

  // Ativo fixo do scaffold (XLM). `null` só se a oferta for desligada no
  // gateway-config - aí o quote vai sem `assetId` (legado) em vez de quebrar.
  const asset = useMemo(() => getCashinAsset(), [])

  const q = cashin.quote
  const c = cashin.charge
  const created = Boolean(c)
  const quoted = Boolean(q)

  const onQuote = async () => {
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Informe um valor em BRL maior que zero.')
      return
    }
    const res = await cashin.requestQuote({ amount: amt, assetId: asset?.id })
    if (res) toast.success('Cotação gerada - confira o valor a receber.')
    else toast.error('Não foi possível cotar. Veja o detalhe abaixo.')
  }

  const onConfirm = async () => {
    // Nome, CPF/CNPJ e e-mail do pagador são opcionais - envia apenas o que foi
    // preenchido e omite o bloco inteiro quando nada foi informado.
    const customer = {
      name: name.trim() || undefined,
      taxID: taxID.trim() || undefined,
      email: email.trim() || undefined,
    }
    const hasCustomer = Object.values(customer).some(Boolean)
    const res = await cashin.confirmCharge({
      customer: hasCustomer ? customer : undefined,
      comment: 'Cash-in (scaffold)',
    })
    if (res) toast.success('Cobrança criada - escaneie o QR para pagar.')
    else toast.error('Não foi possível gerar a cobrança. Veja o detalhe abaixo.')
  }

  // Enter no formulário dispara a ação primária da fase atual (cotar → gerar cobrança).
  const onSubmitPrimary = (e: React.FormEvent) => {
    e.preventDefault()
    if (cashin.busy) return
    if (!quoted) void onQuote()
    else if (!created) void onConfirm()
  }

  if (!isConnected) {
    return (
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Cash-in - Pix → cripto</h2>
        <div className="pf-empty" style={{ marginTop: 12 }}>
          Conecte uma carteira no topo para começar.
        </div>
      </section>
    )
  }

  const fieldsDisabled = cashin.busy || created
  const lockedAfterQuote = cashin.busy || quoted

  return (
    <section className="card">
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ margin: 0 }}>Cash-in</h2>
        <span className="muted">Pix → cripto</span>
      </div>

      <div className="pf-steps">
        <span className={`pf-step ${quoted ? 'done' : 'active'}`}>
          <span className="dot" />
          1. Cotar
        </span>
        <span className="pf-arrow">›</span>
        <span className={`pf-step ${created ? 'done' : quoted ? 'active' : ''}`}>
          <span className="dot" />
          2. Gerar cobrança
        </span>
        <span className="pf-arrow">›</span>
        <span
          className={`pf-step ${cashin.phase === 'completed' ? 'done' : created ? 'active' : ''}`}
        >
          <span className="dot" />
          3. Pagar e confirmar
        </span>
      </div>

      <div className="pf-cols">
        {/* ── Coluna do formulário ─────────────────────────────────────── */}
        <form className="pf-form" onSubmit={onSubmitPrimary} noValidate>
          {/* Ativo a comprar - fixo em XLM, exibido como campo somente-leitura para
              deixar explícito o que será entregue (não é um seletor). */}
          {asset && (
            <div className="pf-two">
              <div>
                <label className="pf-label" htmlFor={`${uid}-net`}>
                  Rede
                </label>
                <input
                  id={`${uid}-net`}
                  className="pf-input"
                  value={asset.chainName}
                  readOnly
                  disabled
                />
              </div>
              <div>
                <label className="pf-label" htmlFor={`${uid}-asset`}>
                  Ativo a comprar
                </label>
                <input
                  id={`${uid}-asset`}
                  className="pf-input"
                  value={`${asset.symbol} - ${asset.name}`}
                  readOnly
                  disabled
                />
              </div>
            </div>
          )}

          <div>
            <label className="pf-label" htmlFor={`${uid}-amount`}>
              Valor (BRL)
            </label>
            <input
              id={`${uid}-amount`}
              className="pf-input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={lockedAfterQuote}
            />
          </div>

          {/* Dados do pagador - só após cotar. Todos opcionais. */}
          {quoted && (
            <>
              <div>
                <label className="pf-label" htmlFor={`${uid}-name`}>
                  Nome do pagador (opcional)
                </label>
                <input
                  id={`${uid}-name`}
                  className="pf-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={fieldsDisabled}
                />
              </div>

              <div className="pf-two">
                <div>
                  <label className="pf-label" htmlFor={`${uid}-tax`}>
                    CPF/CNPJ (opcional)
                  </label>
                  <input
                    id={`${uid}-tax`}
                    className="pf-input"
                    value={taxID}
                    onChange={(e) => setTaxID(e.target.value)}
                    disabled={fieldsDisabled}
                  />
                </div>
                <div>
                  <label className="pf-label" htmlFor={`${uid}-email`}>
                    E-mail (opcional)
                  </label>
                  <input
                    id={`${uid}-email`}
                    className="pf-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={fieldsDisabled}
                  />
                </div>
              </div>
            </>
          )}

          <div className="pf-actions">
            {!quoted ? (
              <button type="submit" disabled={cashin.busy} className="btn btn-primary">
                {cashin.phase === 'quoting' ? 'Cotando…' : 'Calcular cotação'}
              </button>
            ) : !created ? (
              <>
                <button type="submit" disabled={cashin.busy} className="btn btn-primary">
                  {cashin.phase === 'creating' ? 'Gerando…' : 'Gerar cobrança Pix'}
                </button>
                <button
                  type="button"
                  onClick={cashin.reset}
                  disabled={cashin.busy}
                  className="btn btn-outline"
                >
                  Refazer cotação
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={cashin.reset}
                disabled={cashin.busy}
                className="btn btn-outline"
              >
                Nova cobrança
              </button>
            )}
          </div>

          {cashin.error && (
            <p style={{ ...helpText, color: 'var(--danger-ink)' }}>{cashin.error}</p>
          )}
        </form>

        {/* ── Coluna da cotação / QR / status ──────────────────────────── */}
        <div>
          {c ? (
            <div className="pf-panel">
              <div className="pf-srow">
                <span className="k">Valor</span>
                <span className="v">R$ {fmtBRL(c.valueCents / 100)}</span>
              </div>
              {typeof c.cryptoEstimate === 'number' && (
                <div className="pf-srow">
                  <span className="k">Você recebe ≈</span>
                  <span className="v">
                    {fmtCrypto(c.cryptoEstimate)} {assetSymbol(q, asset?.symbol)}
                  </span>
                </div>
              )}
              <div className="pf-srow">
                <span className="k">Status</span>
                <span className="badge badge-neutral">
                  {statusBadge(cashin.phase, cashin.status?.status as string | undefined)}
                </span>
              </div>

              <QrDisplay brCode={c.brCode} qrCodeImage={c.qrCodeImage} />

              {c.paymentLinkUrl && (
                <div style={{ marginTop: 12 }}>
                  <a
                    href={c.paymentLinkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-outline"
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    Abrir link de pagamento ↗
                  </a>
                </div>
              )}
            </div>
          ) : q ? (
            <div className="pf-panel">
              <div className="pf-srow">
                <span className="k">Você paga</span>
                <span className="v">R$ {fmtBRL(q.valuesAndFees.paymentInFiat)}</span>
              </div>
              <div className="pf-srow">
                <span className="k">Você recebe ≈</span>
                <span className="v">
                  {fmtCrypto(q.valuesAndFees.paymentInCrypto)} {assetSymbol(q, asset?.symbol)}
                </span>
              </div>
              {q.priceContext && (
                <div className="pf-srow">
                  <span className="k">Preço ({q.priceContext.pair})</span>
                  <span className="v">R$ {fmtBRL(q.priceContext.priceAfterDiscount)}</span>
                </div>
              )}
              <div className="pf-srow">
                <span className="k">Taxa</span>
                <span className="v">R$ {fmtBRL(q.valuesAndFees.totalFeeFiat)}</span>
              </div>
              <p style={helpText}>
                Cotação válida por ~{q.ttlSeconds}s. Gere a cobrança para travar este preço - os
                dados do pagador são opcionais.
              </p>
            </div>
          ) : (
            <div className="pf-empty">
              Informe o valor e clique em <strong>Calcular cotação</strong> para ver quanto de
              cripto você recebe.
            </div>
          )}
        </div>
      </div>

      <p style={helpText}>
        Após o pagamento, o parceiro credita {asset?.symbol ?? 'a cripto'} pelo backend (evento{' '}
        <code>CASHIN_COMPLETED</code>). Este scaffold compra apenas XLM na rede Stellar.
      </p>
    </section>
  )
}
