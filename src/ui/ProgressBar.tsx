import { useEffect } from 'react'
import { type ColorValue, StyleSheet, View, type ViewProps } from 'react-native'
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { Timing, useReducedMotion } from './motion'
import { colors } from './tokens'

type Props = Omit<ViewProps, 'children'> & {
  /**
   * 0..1. Un número lo anima esta barra (`Timing.move`); un SharedValue lo maneja el consumidor
   * —RestTimer e intervalos ya cronometran el suyo contra el reloj— y acá se lee tal cual.
   */
  progress: number | SharedValue<number>
  height?: 4 | 6 | 8
  color?: ColorValue
  trackColor?: ColorValue
  /** Marcas fijas en 0..1 (MEV/MAV/MRV, 3-2-1): quedan quietas, no las mueve el relleno. */
  ticks?: number[]
  /** Punta redondeada del lado del dato, como las barras de Progreso. */
  roundedEnd?: boolean
}

const clamp = (v: number) => {
  'worklet'
  return Math.min(1, Math.max(0, v))
}

const styles = StyleSheet.create({
  track: { overflow: 'hidden' },
  // scaleX y no width: el ancho animado pasa por layout en cada frame (§7.5).
  fill: { height: '100%', transformOrigin: 'left', width: '100%' },
  // Del color de la superficie: se leen igual sobre el relleno y sobre la pista vacía.
  tick: {
    backgroundColor: colors.secondaryGroupedBackground,
    bottom: 0,
    marginLeft: -1,
    position: 'absolute',
    top: 0,
    width: 2,
  },
})

/**
 * Barra de progreso. El relleno vive en el UI thread y se dibuja con `scaleX`, así que ni el número
 * ni el SharedValue pasan por layout.
 *
 * Rol `progressbar` con valor solo cuando el progreso es un número: con un SharedValue cambia por
 * frame y no hay anuncio que lo siga (el consumidor pone el label — ver `RestTimer`).
 */
export default function ProgressBar({
  progress,
  height = 6,
  color = colors.tint,
  trackColor = colors.fill,
  ticks,
  roundedEnd,
  style,
  ...rest
}: Props) {
  const reduced = useReducedMotion()
  // Arranca en 0 para que el primer trazo se dibuje (§12.6). Sin uso si el driver es de afuera.
  const own = useSharedValue(0)
  const value = typeof progress === 'number' ? progress : null

  useEffect(() => {
    if (value === null) return
    own.set(reduced ? clamp(value) : withTiming(clamp(value), Timing.move))
  }, [value, own, reduced])

  const driver = typeof progress === 'number' ? own : progress
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: clamp(driver.get()) }] }))
  // Radio = mitad del alto: la pista es una cápsula. `roundedEnd` se lo pasa al relleno, donde el
  // `scaleX` lo achata (radio × progreso) — a 4–8 pt no se ve.
  const round = height / 2

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={
        value === null ? undefined : { max: 100, min: 0, now: Math.round(clamp(value) * 100) }
      }
      {...rest}
      style={[styles.track, { backgroundColor: trackColor, borderRadius: round, height }, style]}
    >
      <Animated.View
        style={[
          styles.fill,
          { backgroundColor: color },
          roundedEnd ? { borderRadius: round } : null,
          fill,
        ]}
      />
      {ticks?.map((at, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lista posicional que nunca se reordena, y dos marcas pueden caer en el mismo valor (MEV = MAV)
        <View key={i} style={[styles.tick, { left: `${clamp(at) * 100}%` }]} />
      ))}
    </View>
  )
}
