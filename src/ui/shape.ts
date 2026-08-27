// = `radius.xs`. Duplicado a propósito: `tokens.ts` importa react-native y este módulo tiene test.
const MIN = 6

/**
 * Radio del hijo para que quede concéntrico con el padre: mismo centro de curvatura, así el borde
 * interno no "aprieta" contra el externo (§12.3). `inset` es el padding entre los dos.
 *
 * El piso evita que un inset grande devuelva 0 o negativo: una esquina viva adentro de una card
 * redondeada se lee como un error de render, no como una decisión.
 */
export function concentric(outer: number, inset: number): number {
  return Math.max(MIN, outer - inset)
}
