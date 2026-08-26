/**
 * C11/C12. El timer de intervalos, derivado del reloj igual que el descanso (§2.6): nada corre en
 * background y nada guarda en qué fase iba. Se le pregunta a qué hora arrancó y qué hora es, y
 * siempre contesta lo mismo — volver de bloquear la pantalla no lo desincroniza.
 */

/** C12: los 3-2-1 antes de la primera ronda. */
export const PREP_MS = 3000

export type IntervalConfig = {
  prepMs: number
  workMs: number
  restMs: number
  rounds: number
}

export type IntervalPhase = 'prep' | 'work' | 'rest' | 'done'

export type IntervalState = {
  phase: IntervalPhase
  /** 1-based. En 'rest' es la ronda que acaba de terminar; en 'done', la última. */
  round: number
  phaseEndsAt: number
  /** Lo que queda de ESTA fase (0 en 'done'), no de la sesión entera. */
  remainingMs: number
  /** Lo que dura ESTA fase: la barra es `remainingMs / totalMs`, como el descanso. 0 en 'done'. */
  totalMs: number
}

/** Sin descanso después de la última ronda: se termina al terminar de trabajar. */
function durationMs(c: IntervalConfig): number {
  if (c.rounds < 1 || c.workMs <= 0) return 0
  return c.prepMs + c.rounds * c.workMs + (c.rounds - 1) * Math.max(0, c.restMs)
}

export function phaseAt(config: IntervalConfig, startedAt: number, now: number): IntervalState {
  const { prepMs, rounds, workMs } = config
  const restMs = Math.max(0, config.restMs)
  const prep = Math.max(0, prepMs)
  const done = (): IntervalState => ({
    phase: 'done',
    phaseEndsAt: startedAt + durationMs(config),
    remainingMs: 0,
    round: Math.max(1, rounds),
    totalMs: 0,
  })
  // Una configuración imposible no se cuelga en un bucle infinito: ya está terminada.
  if (rounds < 1 || workMs <= 0) return done()

  // Antes del arranque (reloj corrido) el tiempo transcurrido es cero, no negativo.
  let at = Math.max(0, now - startedAt)
  let base = startedAt
  if (at < prep) {
    return {
      phase: 'prep',
      phaseEndsAt: base + prep,
      remainingMs: prep - at,
      round: 1,
      totalMs: prep,
    }
  }
  at -= prep
  base += prep

  for (let round = 1; round <= rounds; round++) {
    if (at < workMs) {
      return {
        phase: 'work',
        phaseEndsAt: base + workMs,
        remainingMs: workMs - at,
        round,
        totalMs: workMs,
      }
    }
    at -= workMs
    base += workMs
    if (round === rounds) break
    // Con `restMs` en 0 esta rama nunca entra: se encadenan las rondas de trabajo.
    if (at < restMs) {
      return {
        phase: 'rest',
        phaseEndsAt: base + restMs,
        remainingMs: restMs - at,
        round,
        totalMs: restMs,
      }
    }
    at -= restMs
    base += restMs
  }
  return done()
}
