import type {AssetType} from "@/lib/types/AssetType";

export type BlockchainType = {
    id: number;
    evmChainId?: number;
    name: string;
    symbol: string;
    icon: string;
    explorer: string;
    status?: boolean;
    assets: AssetType[];
    key?: string;
    family?: string;
    order?: number;
};
