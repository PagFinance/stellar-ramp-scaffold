// lib/processor/tokenVariantType.ts
//
// Scaffold exclusivo do Stellar: variantes de ativo suportadas na rede Stellar.
export type TokenVariant =
  | 'native' // Moeda nativa (XLM)
  | 'credit_alphanum4' // Ativo emitido (código <= 4 chars)
  | 'credit_alphanum12' // Ativo emitido (código 5-12 chars)
  | 'issued' // Ativo emitido (genérico)
  | 'unknown' // Fallback para casos não identificados
