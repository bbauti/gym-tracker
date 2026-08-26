import { useState } from 'react'
import { Easing, FadeIn, LinearTransition } from 'react-native-reanimated'

// Plan §7.2. Los defaults de Reanimated (mass 4, damping 120, stiffness 900) son pesados:
// siempre un preset. El bounce se gana con momentum real, nunca bajando el damping "porque sí".
export const Spring = {
  press: { mass: 0.7, stiffness: 900, damping: 40 }, // ζ≈0.8, ~175 ms — press/release, checkbox
  snappy: { mass: 1, stiffness: 440, damping: 42 }, // ζ=1.0, ~300 ms — default, sin overshoot
  sheet: { mass: 1, stiffness: 300, damping: 28 }, // ζ≈0.8 — releases que aterrizan en un snap point
  flick: { mass: 1, stiffness: 250, damping: 20 }, // ζ≈0.65 — solo con momentum real
} as const

export const Ease = {
  out: Easing.bezier(0.23, 1, 0.32, 1),
  inOut: Easing.bezier(0.77, 0, 0.175, 1),
  sheet: Easing.bezier(0.32, 0.72, 0, 1),
}

// Salida = 0.5–0.7 × entrada, piso 120 ms. Toast 400/200. Sheet sin gesto 500/300.
export const Timing = {
  fast: { duration: 140, easing: Ease.out },
  base: { duration: 200, easing: Ease.out },
  move: { duration: 260, easing: Ease.inOut },
  toast: { duration: 400, easing: Ease.out }, // entra el toast; sale con `base` (0.5 ×)
  sheet: { duration: 500, easing: Ease.sheet },
}

// Máximo un contenedor con RowLayout por región, y nunca en una fila que se está arrastrando.
export const RowLayout = LinearTransition.springify().mass(0.8).damping(22).stiffness(300)

/** El fade de una fila/card que aparece sola: agregarla, o que vuelva con Deshacer (§7.6). */
const EnterFade = FadeIn.duration(200)

/**
 * `entering` SOLO para lo que aparece después del primer render. Un `entering` puesto a secas
 * dispara en todas las filas al montar la pantalla: abrir un día con 4 ejercicios × 4 series son 20
 * fades a la vez sobre la transición del push, y eso se lee como carga (§7.5 — es el mismo motivo
 * por el que el tilde de `ui/SetRow` no usa `FadeIn`). Las que ya estaban entran sin animación.
 *
 * `ids` se lee una sola vez, en el montaje: lo que llegue después es nuevo y se anima.
 */
export function useEnterFade<K>(ids: Iterable<K>): (id: K) => typeof EnterFade | undefined {
  const [atMount] = useState(() => new Set(ids))
  return (id: K) => (atMount.has(id) ? undefined : EnterFade)
}
