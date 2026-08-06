// lib/partner/cashinAssets.ts
//
// Catálogo do cash-in (onramp) deste scaffold, que é EXCLUSIVO do Stellar e, dentro
// dele, compra **apenas XLM**. O gateway-config lista USDC e BRLP na mesma chain -
// eles ficam de fora do cash-in de propósito, não por acidente de status.
//
// A fonte é `configs/gateway-config.json`: o `assetId` que vai no
// `POST /cashin/quote` precisa ser exatamente o id do catálogo do parceiro (XLM = 100),
// e daqui ele sai determinístico, sem fetch e sem estado de carregamento.
//
// A restrição é aplicada nos dois lados: a UI (`CashinCard`) só oferece este ativo e
// a rota `app/api/partner/cashin/quote` rejeita qualquer outro `assetId`.

import { gatewayConfig } from '@/lib/gatewayConfig'
import type { AssetType } from '@/lib/types/AssetType'

/** `chain.key` da única rede ofertada. */
export const CASHIN_NETWORK_KEY = 'stellar'

/** Único símbolo comprável via cash-in neste scaffold. */
export const CASHIN_ASSET_SYMBOL = 'XLM'

/**
 * O ativo de cash-in (XLM), já com `chainName`/`chainId` injetados - ou `null` se a
 * chain ou o ativo estiverem desligados no gateway-config. `null` degrada o fluxo
 * para o cash-in legado só-valor (sem `assetId`), sem quebrar a tela.
 */
export function getCashinAsset(): AssetType | null {
  const chain = gatewayConfig().chains.find(
    (c) => c.status === true && c.key?.toLowerCase() === CASHIN_NETWORK_KEY,
  )
  if (!chain) return null

  const asset = chain.assets.find((a) => a.status && a.symbol.toUpperCase() === CASHIN_ASSET_SYMBOL)
  if (!asset) return null

  return { ...asset, chainName: chain.name, chainId: chain.id }
}

/** `assetId` aceito no cash-in, ou `null` quando a oferta está desligada. */
export function getCashinAssetId(): number | null {
  return getCashinAsset()?.id ?? null
}

/** O `assetId` informado é o único permitido? `null`/ausente é aceito (fluxo legado). */
export function isAllowedCashinAssetId(assetId: number | null | undefined): boolean {
  if (assetId == null) return true
  return assetId === getCashinAssetId()
}
