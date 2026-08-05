// lib/chains/stellar/stellarErrors.ts

/**
 * Map Horizon result_codes to user-friendly messages.
 */

const OP_ERROR_MAP: Record<string, string> = {
  op_no_trust: 'O destinatario nao esta autorizado a receber este ativo.',
  op_underfunded: 'Saldo insuficiente. Lembre que cada trustline reserva 0.5 XLM.',
  op_line_full: 'O destinatario nao pode receber mais deste ativo no momento.',
  op_no_destination: 'Conta de destino nao esta ativa na rede Stellar.',
  op_not_authorized: 'Sua conta ainda nao foi autorizada pelo emissor para este ativo.',
}

const TX_ERROR_MAP: Record<string, string> = {
  tx_bad_seq: 'Sessao expirada, tentando novamente...',
  tx_too_late: 'Tempo da transacao expirou, tente novamente.',
  tx_insufficient_fee: 'Taxa de rede insuficiente, tente novamente.',
  tx_insufficient_balance: 'Saldo de XLM insuficiente para cobrir taxa e reserva minima.',
}

/** Errors that can be auto-retried (1 attempt) */
const RETRYABLE_TX_ERRORS = new Set(['tx_bad_seq', 'tx_insufficient_fee'])

export type StellarErrorResult = {
  message: string
  retryable: boolean
  code: string
}

/**
 * Extract a user-friendly error from a Horizon submission failure.
 */
export function parseStellarError(err: any): StellarErrorResult {
  const extras = err?.response?.data?.extras ?? err?.extras

  if (extras?.result_codes) {
    const { transaction, operations } = extras.result_codes

    // Check operation-level errors first
    if (operations && operations.length > 0) {
      const opCode = operations[0]
      if (OP_ERROR_MAP[opCode]) {
        return { message: OP_ERROR_MAP[opCode], retryable: false, code: opCode }
      }
    }

    // Check transaction-level errors
    if (transaction && TX_ERROR_MAP[transaction]) {
      return {
        message: TX_ERROR_MAP[transaction],
        retryable: RETRYABLE_TX_ERRORS.has(transaction),
        code: transaction,
      }
    }

    const code = transaction ?? operations?.[0] ?? 'unknown'
    return {
      message: `Erro Stellar: ${code}`,
      retryable: false,
      code,
    }
  }

  return {
    message: err?.message ?? 'Erro desconhecido ao enviar transacao Stellar.',
    retryable: false,
    code: 'unknown',
  }
}
