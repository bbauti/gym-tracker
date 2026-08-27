import { useState } from 'react'
import {
  type BaseAnimationBuilder,
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useReducedMotion,
} from 'react-native-reanimated'
import { staggerDelay } from './stagger'

export { useReducedMotion }

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

/**
 * Política de reduce-motion (§12.7). `ui` es el default de todo lo que entra, sale o celebra; `data`
 * es la excepción: donde la animación ES el dato (barra de descanso, intervalos, Ring), saltarla
 * borra la información, así que esa corre igual.
 */
export const MotionPolicy = { ui: ReduceMotion.System, data: ReduceMotion.Never } as const

// Fábricas, no constantes, porque los builders de Reanimated son MUTABLES: `.delay()` escribe
// `delayV` sobre la instancia y devuelve `this` (BaseAnimationBuilder.js), y `build()` recién corre
// en el commit — un builder compartido entre los índices de un stagger termina con el último delay
// en todas las filas. `Enter`/`Exit` exponen una instancia cada uno para el uso directo, que no
// encadena nada.
const fadeIn = () => FadeIn.duration(200).easing(Ease.out).reduceMotion(MotionPolicy.ui)
const riseIn = () =>
  FadeInDown.duration(200)
    .easing(Ease.out)
    .withInitialValues({ transform: [{ translateY: 8 }] })
    .reduceMotion(MotionPolicy.ui)

/** Lo que aparece después del primer render: `fade` para una fila suelta, `rise` para un tile. */
export const Enter = { fade: fadeIn(), rise: riseIn() }

/** Salida = 0.7 × entrada (§7.2): 140 ms contra los 200 de la entrada. */
export const Exit = { fade: FadeOut.duration(140).easing(Ease.out).reduceMotion(MotionPolicy.ui) }

/**
 * `entering` SOLO para lo que aparece después del primer render. Un `entering` puesto a secas
 * dispara en todas las filas al montar la pantalla: abrir un día con 4 ejercicios × 4 series son 20
 * fades a la vez sobre la transición del push, y eso se lee como carga (§7.5 — es el mismo motivo
 * por el que el tilde de `ui/SetRow` no usa `FadeIn`). Las que ya estaban entran sin animación.
 *
 * `ids` se lee una sola vez, en el montaje: lo que llegue después es nuevo y se anima.
 */
export function useEnterFade<K>(ids: Iterable<K>): (id: K) => typeof Enter.fade | undefined {
  const [atMount] = useState(() => new Set(ids))
  return (id: K) => (atMount.has(id) ? undefined : Enter.fade)
}

/**
 * Cascada de aparición de una grilla que se monta entera (bento, resultados de una calculadora).
 * Solo corre en el montaje, porque `entering` solo corre en el montaje: las tabs quedan montadas,
 * así que es una vez por lanzamiento.
 *
 * `base` es una fábrica por lo dicho arriba: cada índice necesita su propia instancia.
 */
export function useStagger(
  base: () => BaseAnimationBuilder = riseIn,
): (index: number) => BaseAnimationBuilder | undefined {
  const reduced = useReducedMotion()
  // Con reduce-motion los tiles aparecen ya puestos: sin fade y, sobre todo, sin la espera del delay.
  return (index) => (reduced ? undefined : base().delay(staggerDelay(index)))
}
