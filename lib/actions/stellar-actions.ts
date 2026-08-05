// lib/actions/stellar-actions.ts
'use client'

import { TransactionBuilder, Asset, Memo, Operation, BASE_FEE } from '@stellar/stellar-sdk'
import type { InterpretResponse } from '@/lib/processor/InstructionInterpreter'
import type { SignatureResult, TransferResult } from '@/lib/types/WalletSlice'
import type { StellarCtx } from '@/contexts/StellarWalletProvider'
import { getHorizonServer } from '@/lib/chains/stellar/horizonClient'
import { STELLAR_PASSPHRASE } from '@/lib/chains/stellar/stellarConfig'
import {
  checkStellarBalance,
  getIssuedAssetBalance,
  isValidStellarAddress,
  loadAccount,
  validateMemo,
} from '@/lib/chains/stellar/stellarHelpers'
import { parseStellarError } from '@/lib/chains/stellar/stellarErrors'

/**
 * Sign an arbitrary message (proof of ownership).
 */
export async function stellarSignMessage(
  ctx: StellarCtx,
  message: string,
): Promise<SignatureResult> {
  const signed = await ctx.signMessage(message)
  return {
    message,
    signature: signed,
    address: ctx.address,
  }
}

/**
 * Build a Stellar Asset from gateway-config asset data.
 */
function resolveAsset(asset: { address: string; symbol?: string | null }): Asset {
  if (asset.address === 'native') return Asset.native()
  return new Asset(asset.symbol ?? asset.address, asset.address)
}

/**
 * Build a Memo from the payment intent memo object.
 */
function buildMemo(memo?: { type: string; value: string }): Memo {
  if (!memo) return Memo.none()

  switch (memo.type) {
    case 'MEMO_TEXT':
      return Memo.text(memo.value)
    case 'MEMO_ID':
      return Memo.id(memo.value)
    case 'MEMO_HASH': {
      const hex = memo.value.startsWith('0x') ? memo.value.slice(2) : memo.value
      return Memo.hash(Buffer.from(hex, 'hex'))
    }
    default:
      return Memo.none()
  }
}

export type StellarPaymentParams = {
  sender: string
  destination: string
  asset: { address: string; symbol?: string | null }
  amount: string
  memo?: { type: 'MEMO_TEXT' | 'MEMO_ID' | 'MEMO_HASH'; value: string }
}

/**
 * Build, sign, and submit a Stellar payment.
 * Implements retry for tx_bad_seq and tx_insufficient_fee.
 */
export async function stellarBuildAndSubmitPayment(
  ctx: StellarCtx,
  params: StellarPaymentParams,
): Promise<TransferResult> {
  // Validate destination
  if (!isValidStellarAddress(params.destination)) {
    throw new Error('Endereco de destino Stellar invalido.')
  }

  // Validate memo
  if (params.memo) {
    const memoCheck = validateMemo(params.memo.type, params.memo.value)
    if (!memoCheck.valid) {
      throw new Error(`Memo invalido: ${memoCheck.reason}`)
    }
  }

  // Validate amount
  const amount = parseFloat(params.amount)
  if (isNaN(amount) || amount <= 0) {
    throw new Error('Valor do pagamento deve ser maior que zero.')
  }

  // Check source account exists
  const sourceAccount = await loadAccount(params.sender)
  if (!sourceAccount) {
    throw new Error(
      'Sua conta Stellar ainda nao esta ativa. E necessario receber ao menos 1 XLM antes de fazer pagamentos.',
    )
  }

  const stellarAsset = resolveAsset(params.asset)
  const memo = buildMemo(params.memo)

  // Format amount with max 7 decimal places
  const formattedAmount = amount.toFixed(7)

  // Pre-flight balance check: avoid asking the wallet to sign a tx that
  // will inevitably fail with op_underfunded. We surface a clear message
  // accounting for the source account's minimum reserve.
  const isNative = stellarAsset.isNative()
  const assetBalance = isNative
    ? undefined
    : getIssuedAssetBalance(sourceAccount, stellarAsset.code, stellarAsset.issuer ?? '')

  const balanceCheck = checkStellarBalance(sourceAccount, formattedAmount, isNative, assetBalance)
  if (!balanceCheck.ok) {
    throw new Error(balanceCheck.reason)
  }

  return await submitWithRetry(
    ctx,
    sourceAccount,
    stellarAsset,
    formattedAmount,
    params.destination,
    memo,
  )
}

async function submitWithRetry(
  ctx: StellarCtx,
  sourceAccount: any,
  asset: Asset,
  amount: string,
  destination: string,
  memo: Memo,
  retryCount = 0,
): Promise<TransferResult> {
  const server = getHorizonServer()
  const fee = retryCount > 0 ? String(Number(BASE_FEE) * 2) : BASE_FEE

  const txBuilder = new TransactionBuilder(sourceAccount, {
    fee,
    networkPassphrase: STELLAR_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset,
        amount,
      }),
    )
    .addMemo(memo)
    .setTimeout(180)
    .build()

  const signedXdr = await ctx.signTransaction(txBuilder.toXDR())

  try {
    const tx = TransactionBuilder.fromXDR(signedXdr, STELLAR_PASSPHRASE)
    const result = await server.submitTransaction(tx)
    return {
      hash: result.hash,
      extra: result,
    }
  } catch (err: any) {
    const parsed = parseStellarError(err)

    // Auto-retry once for retryable errors
    if (parsed.retryable && retryCount < 1) {
      // Reload account for fresh sequence number
      const freshAccount = await server.loadAccount(sourceAccount.accountId())
      return submitWithRetry(ctx, freshAccount, asset, amount, destination, memo, retryCount + 1)
    }

    throw new Error(parsed.message)
  }
}

/**
 * Submit a Stellar payment using the endpoints Next flow.
 *
 * The endpoints Next is responsible for assembling the memo - when the canonical
 * `paycrypto:<cid>` exceeds 28 bytes (true for typical CIDs) it falls back
 * to MEMO_HASH and stores the memo→cid mapping in Redis so the
 * ValidateMemo_stellar Lambda can resolve it. Here we just attach whatever
 * the endpoints Next returned to the Stellar transaction we build locally.
 */
export async function stellarSubmitInterpret(
  ctx: StellarCtx,
  response: InterpretResponse,
): Promise<TransferResult> {
  const { request, result } = response
  const payload = result as unknown as {
    memo: string
    memoType?: 'MEMO_TEXT' | 'MEMO_HASH'
    receiver: string
    amount: number
  }

  const sender = ctx.address
  if (!sender) {
    throw new Error('Carteira Stellar não conectada.')
  }

  const memoType = payload.memoType ?? 'MEMO_TEXT'
  const memo =
    payload.memo != null && payload.memo !== ''
      ? { type: memoType, value: payload.memo }
      : undefined

  return stellarBuildAndSubmitPayment(ctx, {
    sender,
    destination: payload.receiver,
    asset: {
      address: request.asset.address,
      symbol: request.asset.symbol,
    },
    amount: Number(payload.amount).toFixed(7),
    memo,
  })
}

/**
 * Create a trustline for an issued asset.
 */
export async function stellarCreateTrustline(
  ctx: StellarCtx,
  symbol: string,
  issuer: string,
): Promise<TransferResult> {
  const sourceAccount = await loadAccount(ctx.address!)
  if (!sourceAccount) {
    throw new Error(
      'Sua conta Stellar ainda nao esta ativa. E necessario receber ao menos 1 XLM antes de criar trustlines.',
    )
  }

  const server = getHorizonServer()
  const asset = new Asset(symbol, issuer)

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(180)
    .build()

  const signedXdr = await ctx.signTransaction(tx.toXDR())
  const signedTx = TransactionBuilder.fromXDR(signedXdr, STELLAR_PASSPHRASE)
  const result = await server.submitTransaction(signedTx)

  return {
    hash: result.hash,
    extra: result,
  }
}
