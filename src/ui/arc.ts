// 'arc' y no 'ring': macOS resuelve rutas sin distinguir mayúsculas, así que un `ring.ts` al lado
// de `Ring.tsx` se pisan — bun prueba la extensión .tsx primero y el test terminaba importando el
// componente. Mismo motivo que `confetti.ts` junto a `Celebration.tsx`.

/**
 * Barrido del arco, 0..1: es el `end` del trim de `Path`.
 *
 * Worklet porque `Ring` lo llama adentro de un `useDerivedValue` — cuando el progreso lo maneja el
 * consumidor (intervalos), el clamp tiene que correr en el UI thread, en el mismo frame.
 */
export function ringSweep(progress: number): number {
  'worklet'
  return Math.min(1, Math.max(0, progress))
}

/**
 * Radio del círculo para que un trazo de `stroke` entre completo en `size`: el stroke se dibuja
 * CENTRADO sobre el path, así que se va medio ancho para afuera y medio para adentro.
 */
export function ringRadius(size: number, stroke: number): number {
  return Math.max(0, (size - stroke) / 2)
}

/**
 * El círculo como path SVG, arrancando a las 12 y girando en sentido horario (flag de barrido 1):
 * el trim mide desde el principio del contorno, así que el punto de arranque del path ES el 0 % del
 * anillo. Dos arcos de media vuelta porque un arco SVG de 360° es ambiguo (mismo punto inicial y
 * final) y no dibuja nada.
 */
export function ringPath(size: number, stroke: number): string {
  const r = ringRadius(size, stroke)
  const c = size / 2
  return `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c} ${c + r} A ${r} ${r} 0 1 1 ${c} ${c - r}`
}
