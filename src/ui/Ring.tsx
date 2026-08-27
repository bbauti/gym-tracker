import { Canvas, Circle, Path, Skia } from '@shopify/react-native-skia'
import { type ReactNode, useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import {
  type SharedValue,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { ringPath, ringRadius, ringSweep } from './arc'
import { useChartTheme } from './chartTheme'
import { Timing, useReducedMotion } from './motion'

type Props = {
  /**
   * 0..1. Un número lo anima este anillo (`Timing.move`, el primer trazo de §12.6); un SharedValue
   * lo maneja el consumidor —intervalos ya cronometra el suyo contra el reloj— y se lee tal cual.
   */
  progress: number | SharedValue<number>
  /** Lado del canvas: el anillo lo llena. */
  size: number
  stroke?: number
  /** Color del arco. Hex, NUNCA `PlatformColor`: adentro de Skia no resuelve (ver `chartTheme.ts`). */
  color?: string
  /** El canvas es UN elemento accesible: acá va el resumen en palabras. */
  label: string
  /** Centrado adentro del anillo (un `BigNumber`). Se lee aparte del canvas, no lo tapa. */
  children?: ReactNode
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
})

/**
 * Arco de progreso (§12.4). El barrido se dibuja con el trim de `Path`, así que el anillo entero
 * vive en el UI thread: ni el número ni el SharedValue pasan por un `setState` por frame (§12.9).
 *
 * Sin `accessibilityRole="progressbar"`: el valor de un ring alimentado por el reloj cambia por
 * frame y no hay anuncio que lo siga. El dato va en palabras, en `label`.
 */
export default function Ring({ progress, size, stroke = 8, color, label, children }: Props) {
  const theme = useChartTheme()
  const reduced = useReducedMotion()
  // Arranca en 0 para que el primer trazo se dibuje (§12.6). Sin uso si el driver es de afuera.
  const own = useSharedValue(0)
  const value = typeof progress === 'number' ? progress : null

  useEffect(() => {
    if (value === null) return
    own.set(reduced ? ringSweep(value) : withTiming(ringSweep(value), Timing.move))
  }, [value, own, reduced])

  // El SharedValue de afuera pasa derecho y NO lo topea reduce-motion: ahí la animación es el dato
  // (§12.7). Lo único que se salta es el trazo inicial del caso número, que es decoración.
  const driver = value === null ? (progress as SharedValue<number>) : own
  const end = useDerivedValue(() => ringSweep(driver.get()))

  const path = useMemo(() => Skia.Path.MakeFromSVGString(ringPath(size, stroke)), [size, stroke])
  const radius = ringRadius(size, stroke)
  const center = size / 2

  return (
    <View style={{ height: size, width: size }}>
      <View accessible accessibilityLabel={label}>
        <Canvas style={{ height: size, width: size }}>
          <Circle
            color={theme.track}
            cx={center}
            cy={center}
            opacity={theme.trackOpacity}
            r={radius}
            strokeWidth={stroke}
            style="stroke"
          />
          {path ? (
            <Path
              color={color ?? theme.tint}
              end={end}
              path={path}
              strokeCap="round"
              strokeWidth={stroke}
              style="stroke"
            />
          ) : null}
        </Canvas>
      </View>
      {children ? (
        // `box-none`: el overlay no come toques y los hijos siguen recibiendo los suyos.
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.center]}>
          {children}
        </View>
      ) : null}
    </View>
  )
}
