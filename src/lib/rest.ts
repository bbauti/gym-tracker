/**
 * Rest timer and session stopwatch, derivados del reloj de pared (plan §2.6): nada corre en
 * background, todo sale de `Date.now()` contra un epoch guardado en la fila. Volver a los 3 minutos
 * da el número correcto sin haber ejecutado un solo tick.
 *
 * Funciones puras a propósito: la pantalla las llama a 1 Hz y los tests, sin db ni React.
 */

/** Nunca negativo: pasado el final, el descanso "queda" en 0 hasta que alguien lo limpia. */
export function restRemainingMs(endsAt: number, now: number): number {
  return Math.max(0, endsAt - now)
}

/**
 * Fracción **restante** (1 al empezar → 0 al terminar), que es lo que la barra dibuja: `scaleX`
 * arrancando lleno y vaciándose. Un descanso sin duración (o al revés) ya está terminado.
 */
export function restProgress(startedAt: number, endsAt: number, now: number): number {
  const total = endsAt - startedAt
  if (!(total > 0)) return 0
  return Math.min(1, Math.max(0, (endsAt - now) / total))
}

/**
 * ±15 s con piso: restar nunca deja el final en el pasado ni exactamente en `now` — quedaría un
 * segundo visible antes del cero, con tiempo para volver a tocar. Sumar no tiene techo.
 */
export function adjustRestEndsAt(endsAt: number, deltaMs: number, now: number): number {
  return Math.max(endsAt + deltaMs, now + 1000)
}

/**
 * Cronómetro de la sesión: tiempo de reloj menos lo pausado. `pausedMs` es lo ya acumulado por las
 * pausas cerradas; `pausedAt` (si hay) es la pausa abierta.
 *
 * Con una pausa abierta el número **no depende de `now`**: quedó congelado en `pausedAt`. Importa
 * porque el que llama deja de ticar al pausar, así que su `now` puede ser viejísimo (la tab de
 * entrenar congela el reloj al perder el foco); restarlo daría un número más chico que el real y se
 * quedaría ahí hasta reanudar.
 */
export function elapsedMs(
  startedAt: number,
  pausedMs: number,
  pausedAt: number | null,
  now: number,
): number {
  if (pausedAt !== null) return Math.max(0, pausedAt - startedAt - pausedMs)
  return Math.max(0, now - startedAt - pausedMs)
}
