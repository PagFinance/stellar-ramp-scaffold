// lib/server/cors.ts
//
// Headers CORS travados por origem. Antes os proxies usavam
// `Access-Control-Allow-Origin: *`, o que permitia qualquer site ler as
// respostas cross-origin. As chamadas da app são same-origin, então:
//  - se `NEXT_PUBLIC_PROJECT_URL` estiver definido, liberamos SÓ essa origem;
//  - senão, não emitimos ACAO (same-origin não precisa; cross-origin é negado).

const ORIGIN = process.env.NEXT_PUBLIC_PROJECT_URL?.replace(/\/+$/, '') || ''

export function corsHeaders(): Record<string, string> {
  const h: Record<string, string> = { Vary: 'Origin' }
  if (ORIGIN) h['Access-Control-Allow-Origin'] = ORIGIN
  return h
}

export function corsPreflightHeaders(): Record<string, string> {
  return {
    ...corsHeaders(),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
  }
}
