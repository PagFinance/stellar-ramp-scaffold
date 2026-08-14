'use client'
//
// Resultado da perna EMPRESA do KYB (a verificação do CNPJ contra a Receita
// Federal), em lista de checks.
//
// Por que uma lista e não uma mensagem só: os quatro checks têm remédios
// DIFERENTES. "CNPJ baixado" é ir à Receita; "razão social divergente" é
// corrigir um campo do formulário; "representante fora do QSA" é escolher outra
// pessoa. Uma frase agregada ("empresa reprovada") esconde justamente o que a
// pessoa precisa fazer a seguir.
//
// SKIPPED tem tom neutro de propósito: significa "a fonte não trouxe o dado", e
// pintá-lo de verde afirmaria uma verificação que não aconteceu.
import React from 'react'
import type { KybCheck, KybCheckStatus, KybCompanyVerification } from '@/lib/partner/types'

const STATUS_MARK: Record<KybCheckStatus, string> = {
  PASS: '✓',
  FAIL: '✕',
  SKIPPED: '–',
}

const STATUS_TONE: Record<KybCheckStatus, string> = {
  PASS: 'var(--success)',
  FAIL: 'var(--danger)',
  SKIPPED: 'var(--muted)',
}

const STATUS_LABEL: Record<KybCheckStatus, string> = {
  PASS: 'aprovado',
  FAIL: 'reprovado',
  SKIPPED: 'não verificado',
}

const CHECK_LABEL: Record<KybCheck['id'], string> = {
  CNPJ_FOUND: 'CNPJ na Receita Federal',
  CNPJ_ACTIVE: 'Situação cadastral ativa',
  BUSINESS_NAME_MATCH: 'Razão social',
  REPRESENTATIVE_IN_QSA: 'Representante no quadro societário',
}

export default function KybCompanyChecks({
  verification,
  compact = false,
}: {
  verification: KybCompanyVerification
  /** Trilho lateral: some com os detalhes e mantém só os checks. */
  compact?: boolean
}) {
  const rejected = verification.status === 'REJECTED'

  return (
    <div>
      {!compact ? (
        <p style={{ margin: '0 0 10px', fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>
          {rejected
            ? 'A empresa não passou na verificação cadastral. Nenhuma sessão foi aberta - corrija o que está apontado abaixo e envie de novo.'
            : 'Empresa conferida na Receita Federal.'}
          {verification.officialName ? (
            <>
              {' '}
              Razão social registrada:{' '}
              <span style={{ fontFamily: 'var(--font-mono)' }}>{verification.officialName}</span>.
            </>
          ) : null}
        </p>
      ) : null}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {verification.checks.map((c) => (
          <li key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span
              aria-hidden
              style={{
                color: STATUS_TONE[c.status],
                fontWeight: 700,
                lineHeight: 1.45,
                fontSize: 12.5,
              }}
            >
              {STATUS_MARK[c.status]}
            </span>
            <span style={{ fontSize: 12.5, lineHeight: 1.45 }}>
              <strong style={{ fontWeight: 600 }}>{CHECK_LABEL[c.id] ?? c.id}</strong>
              <span className="sr-only"> ({STATUS_LABEL[c.status]})</span>
              {/* A mensagem do provider só aparece quando acrescenta algo: no
                  PASS ela repete o rótulo. */}
              {c.status === 'PASS' ? null : (
                <>
                  {' — '}
                  <span style={{ color: 'var(--muted)' }}>{c.message}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
