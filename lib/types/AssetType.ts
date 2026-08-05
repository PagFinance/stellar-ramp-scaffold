// lib/types/AssetType.ts

import type {TokenVariant} from "@/lib/processor/tokenVariantType";

export type AssetType = {
    id: number;
    symbol: string;
    name: string;
    icon: string | null;
    address: string;
    decimals: number;
    order: number;
    status: boolean;
    wrappedKey?: string | null;
    chainName: string;
    oracleId?: string | null;
    coinGeckoId?: string | null;
    tokenVariant?: TokenVariant | null;
    chainId?: number | null;

    // Campos opcionais (preços/metadados)
    price?: number | null;
    color?: string | null;
    fixedRate?: number | null;
    metadataUri?: string | null;
    metadata?: {
        wrappedKey?: string;
        name?: string;
        symbol?: string;
        description?: string;
        image?: string;
        external_url?: string;
    } | null;
};
