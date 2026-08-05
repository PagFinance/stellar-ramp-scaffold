// components/actions/CashoutCard.tsx
'use client'
//
// Cash-out (cripto → Pix): valida o código Pix (opcional), cota, e ao confirmar
// entrega a instrução blockchain (vinda da partner-api) à carteira ativa para
// assinar/enviar; depois acompanha o status.
//
// Scaffold exclusivo do Stellar: o cash-out roda para a rede Stellar (única
// suportada pela partner-api neste fork).

import React, { useEffect, useId, useMemo, useState } from 'react'
import { useWalletWeb3 } from '@/hooks/useWalletWeb3'
import { useCashout } from '@/hooks/useCashout'
import { useToast } from '@/components/toast/ToastProvider'
import { getAcceptedCryptos } from '@/lib/partner/browserClient'
import { getAllActiveChains } from '@/lib/gatewayConfig'
import { explorerTxUrl } from '@/lib/explorer'
import { helpText } from '@/components/partner/formStyles'
import type { AssetType } from '@/lib/types/AssetType'

function money(n: number, currency = 'BRL') {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(n)
  } catch {
    return `${currency} ${n.toFixed(2)}`
  }
}

function Step({ label, state }: { label: string; state: 'idle' | 'active' | 'done' }) {
  return (
    <span className={`pf-step ${state === 'idle' ? '' : state}`}>
      <span className="dot" />
      {label}
    </span>
  )
}

export default function CashoutCard() {
  const { activeChainId, isConnected } = useWalletWeb3()
  const cashout = useCashout()
  const toast = useToast()
  const uid = useId()

  // Redes locais da mesma família da chain ativa (para o seletor de rede).
  const networks = useMemo(() => {
    if (!activeChainId) return [] as { name: string }[]
    return getAllActiveChains()
      .filter((c: any) => c.family === activeChainId)
      .map((c: any) => ({ name: c.name as string }))
  }, [activeChainId])

  const [networkName, setNetworkName] = useState<string>('')
  const [assets, setAssets] = useState<AssetType[]>([])
  const [assetsError, setAssetsError] = useState<string | null>(null)
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [assetId, setAssetId] = useState<number | null>(null)

  const [amount, setAmount] = useState('100')
  const [invoiceCode, setInvoiceCode] = useState('')
  const [invoiceName, setInvoiceName] = useState('')
  const [userTaxId, setUserTaxId] = useState('')
  const [validated, setValidated] = useState<Record<string, unknown> | null>(null)

  // Default de rede quando a chain ativa muda.
  useEffect(() => {
    setNetworkName(networks[0]?.name ?? '')
  }, [networks])

  // Carrega os assets aceitos (partner-api) para a rede selecionada.
  useEffect(() => {
    if (!cashout.supported || !networkName) {
      setAssets([])
      setAssetId(null)
      return
    }
    let cancelled = false
    setLoadingAssets(true)
    setAssetsError(null)
    getAcceptedCryptos(networkName)
      .then((res) => {
        if (cancelled) return
        const list = res.assets ?? []
        setAssets(list)
        setAssetId(list[0]?.id ?? null)
      })
      .catch((e) => {
        if (cancelled) return
        setAssets([])
        setAssetId(null)
        setAssetsError(e?.message ?? 'Falha ao carregar cryptos aceitas.')
      })
      .finally(() => !cancelled && setLoadingAssets(false))
    return () => {
      cancelled = true
    }
  }, [cashout.supported, networkName])

  const selectedAsset = useMemo(
    () => assets.find((a) => a.id === assetId) ?? null,
    [assets, assetId],
  )

  // Validação opcional do código Pix (endpoint /validate-code da partner-api).
  // Não é obrigatória para cotar; serve para conferir o beneficiário antes.
  const onValidate = async () => {
    const code = invoiceCode.trim()
    if (!code) {
      toast.error('Informe o código Pix para validar.')
      return
    }
    const data = await cashout.validate(code)
    if (data) {
      setValidated(data)
      toast.success('Código Pix válido.')
    }
  }

  const onQuote = async () => {
    if (!selectedAsset) {
      toast.error('Selecione um ativo.')
      return
    }
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Informe um valor em BRL maior que zero.')
      return
    }
    if (!invoiceCode.trim()) {
      toast.error('Informe o código Pix (copia e cola).')
      return
    }
    await cashout.getQuote({
      asset: selectedAsset,
      amount: amt,
      invoiceCode: invoiceCode.trim(),
      invoiceName: invoiceName.trim() || undefined,
      userTaxId: userTaxId.trim() || undefined,
    })
  }

  const onConfirm = async () => {
    const id = toast.pending('Confirme a transação na sua carteira…')
    const err = await cashout.confirm()
    if (err) {
      toast.update(id, { variant: 'error', message: err })
    } else {
      toast.update(id, {
        variant: 'success',
        message: 'Transação enviada - acompanhando liquidação.',
      })
    }
  }

  // ── Guards de conexão / suporte ────────────────────────────────────────────
  if (!isConnected) {
    return (
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Cash-out - cripto → Pix</h2>
        <div className="pf-empty" style={{ marginTop: 12 }}>
          Conecte uma carteira no topo para começar.
        </div>
      </section>
    )
  }

  if (!cashout.supported) {
    return (
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Cash-out - cripto → Pix</h2>
        <div className="pf-empty" style={{ marginTop: 12 }}>
          Rede ativa (<b>{activeChainId}</b>) não suportada no cash-out. Conecte uma carteira{' '}
          <b>Stellar</b>.
        </div>
      </section>
    )
  }

  const q = cashout.quote
  const v = q?.valuesAndFees
  const p = q?.priceContext
  const hasQuote = Boolean(q)
  const hasIntent = Boolean(cashout.intent)
  const terminal = cashout.phase === 'completed' || cashout.phase === 'failed'

  // A ação primária da coluna do formulário é sempre Cotar/Recotar (a confirmação
  // fica na coluna do resumo). Enter e o botão submit disparam a cotação.
  const onSubmitPrimary = (e: React.FormEvent) => {
    e.preventDefault()
    if (cashout.busy || !assets.length) return
    void onQuote()
  }

  return (
    <section className="card">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Cash-out</h2>
        <span className="muted">cripto → Pix</span>
        <span className="badge badge-neutral" style={{ fontSize: 11, marginLeft: 'auto' }}>
          {activeChainId?.toUpperCase()}
        </span>
      </div>

      <div className="pf-steps">
        <Step label="1. Cotar" state={hasQuote ? 'done' : 'active'} />
        <span className="pf-arrow">›</span>
        <Step label="2. Assinar" state={hasIntent ? 'done' : hasQuote ? 'active' : 'idle'} />
        <span className="pf-arrow">›</span>
        <Step
          label="3. Liquidar"
          state={
            cashout.phase === 'completed' ? 'done' : cashout.phase === 'polling' ? 'active' : 'idle'
          }
        />
      </div>

      <div className="pf-cols">
        {/* ── Coluna do formulário ─────────────────────────────────────── */}
        <form className="pf-form" onSubmit={onSubmitPrimary} noValidate>
          <div className="pf-two">
            <div>
              <label className="pf-label" htmlFor={`${uid}-net`}>
                Rede
              </label>
              <select
                id={`${uid}-net`}
                className="pf-select"
                value={networkName}
                onChange={(e) => setNetworkName(e.target.value)}
                disabled={cashout.busy}
              >
                {networks.map((n) => (
                  <option key={n.name} value={n.name}>
                    {n.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="pf-label" htmlFor={`${uid}-asset`}>
                Ativo (accepted-cryptos)
              </label>
              <select
                id={`${uid}-asset`}
                className="pf-select"
                value={assetId ?? ''}
                onChange={(e) => setAssetId(Number(e.target.value))}
                disabled={cashout.busy || loadingAssets || !assets.length}
              >
                {loadingAssets && <option>Carregando…</option>}
                {!loadingAssets &&
                  assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.symbol} - {a.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          {assetsError && <p style={{ ...helpText, color: 'var(--danger-ink)' }}>{assetsError}</p>}

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
              disabled={cashout.busy}
            />
          </div>

          <div>
            <label className="pf-label" htmlFor={`${uid}-pix`}>
              Código Pix (copia e cola / QR)
            </label>
            <input
              id={`${uid}-pix`}
              className="pf-input"
              value={invoiceCode}
              placeholder="00020126..."
              onChange={(e) => {
                setInvoiceCode(e.target.value)
                if (validated) setValidated(null)
              }}
              disabled={cashout.busy}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
              <button
                type="button"
                onClick={onValidate}
                disabled={cashout.busy || !invoiceCode.trim()}
                className="btn btn-outline"
                style={{ padding: '4px 10px', fontSize: 12 }}
              >
                {cashout.phase === 'validating' ? 'Validando…' : 'Validar código (opcional)'}
              </button>
              {validated && (
                <span className="badge badge-neutral" style={{ fontSize: 11 }}>
                  ✓ beneficiário validado
                </span>
              )}
            </div>
            {validated && (
              <div className="pf-panel" style={{ marginTop: 8, fontSize: 12 }}>
                {Object.entries(validated)
                  .filter(
                    ([, val]) =>
                      typeof val === 'string' ||
                      typeof val === 'number' ||
                      typeof val === 'boolean',
                  )
                  .slice(0, 6)
                  .map(([key, val]) => (
                    <div
                      key={key}
                      className="pf-srow"
                      style={{ borderBottom: 0, padding: '2px 0' }}
                    >
                      <span className="k">{key}</span>
                      <span className="v">{String(val)}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="pf-two">
            <div>
              <label className="pf-label" htmlFor={`${uid}-benef`}>
                Nome do beneficiário (opcional)
              </label>
              <input
                id={`${uid}-benef`}
                className="pf-input"
                value={invoiceName}
                onChange={(e) => setInvoiceName(e.target.value)}
                disabled={cashout.busy}
              />
            </div>
            <div>
              <label className="pf-label" htmlFor={`${uid}-taxid`}>
                CPF/CNPJ (opcional)
              </label>
              <input
                id={`${uid}-taxid`}
                className="pf-input"
                value={userTaxId}
                onChange={(e) => setUserTaxId(e.target.value)}
                disabled={cashout.busy}
              />
            </div>
          </div>

          <div className="pf-actions">
            <button
              type="submit"
              disabled={cashout.busy || !assets.length}
              className={hasQuote ? 'btn btn-outline' : 'btn btn-primary'}
            >
              {cashout.phase === 'authenticating'
                ? 'Autenticando…'
                : cashout.phase === 'quoting'
                  ? 'Cotando…'
                  : hasQuote
                    ? 'Recotar'
                    : 'Cotar'}
            </button>
            {(hasQuote || cashout.error) && (
              <button
                type="button"
                onClick={() => {
                  cashout.reset()
                  setValidated(null)
                }}
                disabled={cashout.busy}
                className="btn"
                style={{ flex: '0 0 auto' }}
              >
                Recomeçar
              </button>
            )}
          </div>
        </form>

        {/* ── Coluna do resumo / status ────────────────────────────────── */}
        <div>
          {!v || !p ? (
            <div className="pf-empty">
              Preencha os dados e clique em <b>Cotar</b> para ver o resumo, taxas e cotação.
            </div>
          ) : (
            <div className="pf-panel">
              <p className="pf-panel-title">Resumo</p>
              <div className="pf-srow pf-total">
                <span className="k">Você paga (Pix)</span>
                <span className="v">{money(v.totalFiat)}</span>
              </div>
              <div className="pf-srow">
                <span className="k">Você envia</span>
                <span className="v">
                  {v.totalCrypto} {selectedAsset?.symbol}
                </span>
              </div>
              <div className="pf-srow">
                <span className="k">Taxa</span>
                <span className="v">{money(v.totalFeeFiat)}</span>
              </div>
              <div className="pf-srow">
                <span className="k">Preço {p.pair}</span>
                <span className="v">{money(p.priceAfterDiscount)}</span>
              </div>

              <p style={helpText}>
                Válida até {new Date(q!.expiresAt).toLocaleTimeString('pt-BR')} · TTL{' '}
                {q!.ttlSeconds}s
              </p>

              <div className="pf-actions">
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={cashout.busy || terminal}
                  className="btn btn-primary"
                >
                  {cashout.phase === 'authenticating'
                    ? 'Autenticando…'
                    : cashout.phase === 'creating' || cashout.phase === 'signing'
                      ? 'Assinando…'
                      : cashout.phase === 'polling'
                        ? 'Liquidando…'
                        : 'Confirmar e assinar'}
                </button>
              </div>

              {/* Status da ordem */}
              {cashout.intent && (
                <div
                  style={{
                    marginTop: 14,
                    paddingTop: 12,
                    borderTop: '1px solid #222531',
                    fontSize: 13,
                  }}
                >
                  <div className="pf-srow" style={{ borderBottom: 0, padding: '4px 0' }}>
                    <span className="k">Ordem</span>
                    <code>{cashout.intent.intentId.slice(0, 12)}…</code>
                  </div>
                  <div className="pf-srow" style={{ borderBottom: 0, padding: '4px 0' }}>
                    <span className="k">Status</span>
                    <span className="badge badge-neutral">
                      {cashout.status?.status ?? (cashout.phase === 'polling' ? 'PROCESSING' : '-')}
                    </span>
                  </div>
                  {cashout.txHash &&
                    (() => {
                      const href = explorerTxUrl(activeChainId, cashout.txHash!)
                      return href ? (
                        <a href={href} target="_blank" rel="noreferrer">
                          Ver transação no explorer ↗
                        </a>
                      ) : (
                        <code>{cashout.txHash}</code>
                      )
                    })()}
                </div>
              )}
            </div>
          )}

          {cashout.error && (
            <p style={{ ...helpText, color: 'var(--danger-ink)' }}>{cashout.error}</p>
          )}
        </div>
      </div>

      <p style={helpText}>
        A instrução da transação vem da Partner API; você aprova o envio na sua própria carteira.
      </p>
    </section>
  )
}
