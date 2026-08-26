import { nearestLoadable } from './plates'

export type WarmupStep = { weightG: number; reps: number }

/**
 * J06. Rampa fija: porcentaje del peso de trabajo y repeticiones que van bajando.
 *
 * ponytail: una sola tabla, sin RPE ni tipo de ejercicio. Techo: para una serie de 20 reps la
 * entrada en calor queda corta. Upgrade: elegir la rampa por rango de reps del ejercicio.
 */
export const RAMP: readonly { pct: number; reps: number }[] = [
  { pct: 0.4, reps: 10 },
  { pct: 0.6, reps: 5 },
  { pct: 0.8, reps: 3 },
  { pct: 0.9, reps: 1 },
]

/**
 * Las series de entrada en calor hasta `workG`, de la más liviana a la más pesada.
 *
 * Con menos pasos se recortan los del medio, nunca el primero: la primera serie liviana es la que
 * entra en calor de verdad, las de arriba solo acercan al peso de trabajo.
 *
 * Cada peso cae en algo que se pueda cargar con esa barra y esos discos, así que dos pasos pueden
 * terminar en el mismo número (o en el peso de trabajo): esos se descartan.
 */
export function warmupRamp(
  workG: number,
  { barG, platesG, steps = RAMP.length }: { barG: number; platesG: number[]; steps?: number },
): WarmupStep[] {
  const n = Math.min(Math.max(Math.round(steps), 1), RAMP.length)
  const chosen = [RAMP[0], ...RAMP.slice(RAMP.length - (n - 1))]

  const out: WarmupStep[] = []
  for (const { pct, reps } of chosen) {
    const weightG = nearestLoadable(workG * pct, barG, platesG)
    if (weightG >= workG) continue
    if (out.some((s) => s.weightG === weightG)) continue
    out.push({ weightG, reps })
  }
  return out
}
