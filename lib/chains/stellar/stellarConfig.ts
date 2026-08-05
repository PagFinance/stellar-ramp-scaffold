// lib/chains/stellar/stellarConfig.ts

import { Networks } from '@stellar/stellar-sdk'

export const STELLAR_NETWORK = (
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'PUBLIC').toUpperCase()
) as 'PUBLIC' | 'TESTNET'

export const STELLAR_HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ??
  (STELLAR_NETWORK === 'PUBLIC'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org')

export const STELLAR_PASSPHRASE =
  STELLAR_NETWORK === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET

export const STELLAR_EXPLORER = 'https://stellarchain.io'
