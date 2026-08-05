// lib/chains/stellar/stellarHelpers.ts

import { StrKey } from '@stellar/stellar-sdk'
import { getHorizonServer } from './horizonClient'
import type { Horizon } from '@stellar/stellar-sdk'

/**
 * Validate a Stellar G... address (Ed25519 public key).
 */
export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address)
}

/**
 * Check if a Stellar account exists on the network.
 * Returns the account record or null if account_not_found.
 */
export async function loadAccount(address: string): Promise<Horizon.AccountResponse | null> {
  try {
    return await getHorizonServer().loadAccount(address)
  } catch (err: any) {
    if (err?.response?.status === 404) return null
    throw err
  }
}

/**
 * Check if an account has a trustline for a given asset.
 */
export type TrustlineStatus = {
  exists: boolean
  authorized: boolean
  limit: string
}

export async function hasTrustline(
  account: Horizon.AccountResponse,
  symbol: string,
  issuer: string,
): Promise<TrustlineStatus> {
  const balance = account.balances.find(
    (b): b is Horizon.HorizonApi.BalanceLineAsset =>
      'asset_code' in b &&
      b.asset_code === symbol &&
      b.asset_issuer === issuer,
  )

  if (!balance) {
    return { exists: false, authorized: false, limit: '0' }
  }

  // is_authorized may be undefined (defaults to true if not present)
  const authorized = balance.is_authorized !== false

  return {
    exists: true,
    authorized,
    limit: balance.limit,
  }
}

/**
 * Get native XLM balance for an account.
 */
export function getXlmBalance(account: Horizon.AccountResponse): string {
  const native = account.balances.find(
    (b): b is Horizon.HorizonApi.BalanceLineNative => b.asset_type === 'native',
  )
  return native?.balance ?? '0'
}

/**
 * Get balance for a specific issued asset.
 */
export function getIssuedAssetBalance(
  account: Horizon.AccountResponse,
  symbol: string,
  issuer: string,
): string {
  const balance = account.balances.find(
    (b): b is Horizon.HorizonApi.BalanceLineAsset =>
      'asset_code' in b &&
      b.asset_code === symbol &&
      b.asset_issuer === issuer,
  )
  return balance?.balance ?? '0'
}

/**
 * Base reserve per entry on Stellar mainnet (0.5 XLM).
 * Minimum account reserve = (2 + subentryCount) * BASE_RESERVE_XLM.
 *
 * Ref: https://developers.stellar.org/docs/learn/fundamentals/lumens#minimum-balance
 */
export const BASE_RESERVE_XLM = 0.5

/**
 * Computes the minimum XLM reserve an account must keep.
 * One account = 2 base entries (account itself); each subentry (trustline,
 * offer, signer, data entry, claimable balance sponsorship) adds +1.
 */
export function getMinReserveXlm(account: Horizon.AccountResponse): number {
  const subentries = Number(account.subentry_count ?? 0)
  return (2 + subentries) * BASE_RESERVE_XLM
}

export type BalanceCheckResult =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Verifies the source account can afford a payment without busting the
 * minimum reserve. Run this BEFORE asking the wallet to sign so the user
 * gets a clear message instead of a generic `op_underfunded` from Horizon.
 *
 * @param account       Loaded source account.
 * @param amount        Payment amount as a decimal string (e.g. "1.5").
 * @param isNative      Whether the asset being sent is native XLM.
 * @param assetBalance  Source's balance of the issued asset (only used when !isNative).
 * @param feeXlm        Estimated fee in XLM (defaults to a generous 0.00001 / 100 stroops).
 */
export function checkStellarBalance(
  account: Horizon.AccountResponse,
  amount: string,
  isNative: boolean,
  assetBalance?: string,
  feeXlm = 0.00001,
): BalanceCheckResult {
  const amountNum = Number(amount)
  if (!isFinite(amountNum) || amountNum <= 0) {
    return { ok: false, reason: 'Valor do pagamento invalido.' }
  }

  const xlmBalance = Number(getXlmBalance(account))
  const minReserve = getMinReserveXlm(account)

  if (isNative) {
    const need = amountNum + minReserve + feeXlm
    if (xlmBalance < need) {
      const available = Math.max(0, xlmBalance - minReserve - feeXlm)
      return {
        ok: false,
        reason:
          `Saldo de XLM insuficiente. Voce tem ${xlmBalance.toFixed(7)} XLM, mas ` +
          `precisa de ${need.toFixed(7)} XLM (valor + reserva minima de ` +
          `${minReserve.toFixed(2)} XLM + taxa). Disponivel para envio: ` +
          `${available.toFixed(7)} XLM.`,
      }
    }
    return { ok: true }
  }

  const issuedBalance = Number(assetBalance ?? '0')
  if (issuedBalance < amountNum) {
    return {
      ok: false,
      reason:
        `Saldo do ativo insuficiente. Voce tem ${issuedBalance} mas precisa ` +
        `de ${amountNum}.`,
    }
  }

  // Even when sending an issued asset, fee is paid in XLM. The account must
  // hold its minimum reserve plus the fee in XLM.
  if (xlmBalance < minReserve + feeXlm) {
    return {
      ok: false,
      reason:
        `Saldo de XLM insuficiente para taxa de rede. Voce tem ` +
        `${xlmBalance.toFixed(7)} XLM, mas precisa manter ao menos ` +
        `${minReserve.toFixed(2)} XLM de reserva + taxa.`,
    }
  }

  return { ok: true }
}

/**
 * Validate memo value for a given type.
 */
export function validateMemo(
  type: 'MEMO_TEXT' | 'MEMO_ID' | 'MEMO_HASH',
  value: string,
): { valid: boolean; reason?: string } {
  if (!value || value.length === 0) {
    return { valid: false, reason: 'Memo vazio' }
  }

  switch (type) {
    case 'MEMO_TEXT': {
      const byteLen = Buffer.byteLength(value, 'utf8')
      if (byteLen > 28) {
        return {
          valid: false,
          reason: `Memo TEXT excede 28 bytes (${byteLen} bytes)`,
        }
      }
      return { valid: true }
    }
    case 'MEMO_ID': {
      const n = BigInt(value)
      if (n < BigInt(0) || n > BigInt('18446744073709551615')) {
        return { valid: false, reason: 'MEMO_ID deve ser uint64' }
      }
      return { valid: true }
    }
    case 'MEMO_HASH': {
      const clean = value.startsWith('0x') ? value.slice(2) : value
      if (clean.length !== 64 || !/^[0-9a-fA-F]+$/.test(clean)) {
        return { valid: false, reason: 'MEMO_HASH deve ter 32 bytes em hex' }
      }
      return { valid: true }
    }
    default:
      return { valid: false, reason: `Tipo de memo desconhecido: ${type}` }
  }
}
