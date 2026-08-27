/**
 * Papel picado de la celebración de fin de entrenamiento (§12.4). Determinista a propósito: con una
 * semilla en vez de `Math.random` el burst se testea, y encima dos celebraciones seguidas no salen
 * iguales porque la semilla es el id de la que se muestra.
 *
 * Las unidades son RADIOS del burst, no px: el radio lo pone la pantalla, así que la misma física se
 * ve igual en cualquier tamaño. En Skia la `y` crece hacia abajo, así que `vy` negativo es subir.
 *
 * No se llama `celebration.ts` porque el disco de macOS no distingue mayúsculas: junto a
 * `Celebration.tsx`, TS resuelve `@/ui/Celebration` a este archivo y tira TS1149.
 */

export type Particle = {
  /** Offset inicial desde el centro del burst. */
  x0: number
  y0: number
  /** Velocidad, en radios por unidad de `t` (0 → 1 a lo largo de toda la celebración). */
  vx: number
  vy: number
  /** Lado del papelito, en px: es textura, no escala con el burst. */
  size: number
  /** Tono HSL, en grados. */
  hue: number
}

/** Techo de §12.4: más papelitos no se leen y cada uno es un nodo de Skia animado por frame. */
export const MAX_PARTICLES = 32

// Arco azul → índigo → magenta, no un arcoíris: arranca en el azul del sistema (211°), pasa por el
// índigo del degradado (241°) y termina en magenta. El burst sigue siendo de esta app.
const HUE_FROM = 195
const HUE_SPAN = 120

const SPEED_MIN = 0.8
const SPEED_SPAN = 0.8
const SIZE_MIN = 5
const SIZE_SPAN = 6
/** Sin esto los 32 salen del mismo punto exacto y el arranque se ve como un solo objeto. */
const ORIGIN_JITTER = 0.12

/**
 * LCG de Numerical Recipes (módulo 2³²). Cuatro líneas contra una dependencia: esto reparte
 * papelitos, no genera claves.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

export function particles(seed: number, n: number): Particle[] {
  const rand = lcg(seed)
  const count = Math.min(Math.max(Math.trunc(n), 0), MAX_PARTICLES)
  const out: Particle[] = []
  for (let i = 0; i < count; i++) {
    // Ángulo estratificado sobre el semicírculo de arriba y desordenado dentro de su franja: al azar
    // puro salen grumos y huecos, y un burst con un hueco se lee como un error de render.
    const angle = Math.PI + ((i + rand()) / count) * Math.PI
    const speed = SPEED_MIN + rand() * SPEED_SPAN
    out.push({
      x0: (rand() - 0.5) * ORIGIN_JITTER,
      y0: (rand() - 0.5) * ORIGIN_JITTER,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: SIZE_MIN + rand() * SIZE_SPAN,
      hue: HUE_FROM + rand() * HUE_SPAN,
    })
  }
  return out
}
