/**
 * Delay de aparición del tile/fila `i` de una grilla que se monta entera (§12.4).
 *
 * El cap es lo que hace que esto no se lea como carga: sin él, el tile 12 entra medio segundo
 * después del primero y la pantalla parece estar buscando los datos. Con `cap` los últimos entran
 * juntos, que es exactamente lo que el ojo espera de una cascada que termina.
 */
export function staggerDelay(i: number, step = 40, cap = 7): number {
  return Math.min(Math.max(i, 0), cap) * step
}
