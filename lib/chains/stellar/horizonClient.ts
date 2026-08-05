// lib/chains/stellar/horizonClient.ts

import { Horizon } from '@stellar/stellar-sdk'
import { STELLAR_HORIZON_URL } from './stellarConfig'

let _server: Horizon.Server | null = null

export function getHorizonServer(): Horizon.Server {
  if (!_server) {
    _server = new Horizon.Server(STELLAR_HORIZON_URL)
  }
  return _server
}
