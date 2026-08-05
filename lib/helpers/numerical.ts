// Expande notação científica ("1e-7") para decimal pleno, evitando o formato
// exponencial que BN.js/bigint não aceitam. Ref: https://github.com/indutny/bn.js/issues/209
export function toPlainString(num: string) {
  return `${num}`.replace(/(-?)(\d*)\.?(\d+)e([+-]\d+)/, (a, b, c, d, e) =>
    e < 0
      ? `${b}0.${Array(1 - e - c.length).join('0')}${c}${d}`
      : b + c + d + Array(e - d.length + 1).join('0'),
  )
}

/**
 * Converte um valor decimal para unidades inteiras (on-chain) como bigint.
 */
export function calcAmountBigInt(amount: string, decimals: number): bigint {
  // normaliza: "1.23"
  const [intPart, fracRaw = ''] = amount.split('.')
  const fracPart = fracRaw.padEnd(decimals, '0').slice(0, decimals) // trunca ou completa
  return BigInt(intPart || '0') * 10n ** BigInt(decimals) + BigInt(fracPart || '0')
}

/**
 * Converte um valor decimal para inteiro (number).
 */
export function calcAmountNumber(amount: number, decimals: number): number {
  return Math.floor(amount * 10 ** decimals)
}

/**
 * Versão genérica - escolha "bigint" ou "number" dinamicamente.
 */
export function calcAmount<T extends 'number' | 'bigint'>(
  amount: number,
  decimals: number,
  type: T,
): T extends 'number' ? number : bigint {
  const raw = amount * 10 ** decimals
  return (type === 'number' ? Math.floor(raw) : BigInt(Math.floor(raw))) as any
}

export function calcAmountDecimals(amount: number, decimals: number) {
  return Math.round(amount * Math.pow(10, decimals))
}

export function roundUp(num: number, decimalPlaces: number): number {
  return Math.ceil(num * 10 ** decimalPlaces) / 10 ** decimalPlaces
}

export function roundDown(num: number, decimalPlaces: number): number {
  return Math.floor(num * 10 ** decimalPlaces) / 10 ** decimalPlaces
}

export function prettifyDecimal(num: number, decimalPlaces: number): string {
  if (num === 0) {
    return decimalPlaces === 0 ? '0' : `0.${'0'.repeat(decimalPlaces)}`
  }

  if (num < 0.01) return '<0.01'

  if (num >= 1e9) return `${roundDown(num / 1e9, decimalPlaces)}B`

  if (num >= 1e6) return `${roundDown(num / 1e6, decimalPlaces)}M`

  // https://stackoverflow.com/questions/2901102/how-to-print-a-number-with-commas-as-thousands-separators-in-javascript
  return `${roundDown(num, decimalPlaces)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

/**
 * Format number with thousands and decimal separator
 * @param num
 * @param thousand
 * @param decimal
 */
export function formatNumber(num: number | string, thousand = ',', decimal = '.'): string {
  // Converter para número e verificar validade
  const parsedNum = typeof num === 'string' ? parseFloat(num) : num
  if (isNaN(parsedNum)) {
    return '0'
  }

  // Separar a parte inteira e decimal
  const [integerPart, fractionalPart] = parsedNum
    .toFixed(2) // Arredondar para duas casas decimais
    .split('.')

  // Adicionar separadores de milhares
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousand)

  // Retornar número formatado com parte decimal
  return fractionalPart ? `${formattedInteger}${decimal}${fractionalPart}` : formattedInteger
}

export function calcPercent(percent: number, total: number): number {
  if (total === 0 || isNaN(total)) {
    throw new Error('Total cannot be zero or NaN')
  }
  return (percent / 100) * total
}

// Prevenir divisões por zero ou resultados inválidos
export const safeDivide = (numerator: number, denominator: number) => {
  if (denominator === 0 || !isFinite(denominator)) {
    throw new Error('Erro ao calcular: Divisão por zero ou valor infinito detectado.')
  }
  return numerator / denominator
}
