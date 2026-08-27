import { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { t } from '@/i18n'
import type { PrKind } from '@/lib/prs'
import GradientSurface from './GradientSurface'
import { Spring, Timing } from './motion'
import Text from './Text'
import { colors, radius, spacing } from './tokens'

/**
 * "Peso máximo, 1RM estimado". El peso va sustituido en el de reps: "12 reps" sin decir a cuánto no
 * es un récord, es un número suelto (mismo criterio que la fila de `personal_record`).
 */
export function prKindsLabel(kinds: PrKind[], weight: string): string {
  return kinds.map((kind) => t(`pr.kind.${kind}`, { w: weight })).join(', ')
}

type Props = {
  /** Vacío = se sabe que hubo récord pero no de qué tipo (una serie de una sesión ya guardada). */
  kinds: PrKind[]
  /** Ya formateado, para "Reps a {w}". */
  weight?: string
  /** `false` cuando el badge ya estaba puesto al montar: aparece sin entrar (ver `ui/SetRow`). */
  animate?: boolean
  /** Sube al volver del background: re-apunta la animación que nunca corrió (ver `ui/SetRow`). */
  resumeKey?: number
}

const styles = StyleSheet.create({
  // `overflow: hidden` recorta el degradado al radio; el mismo alto y ancho que la pastilla plana.
  pill: {
    borderCurve: 'continuous',
    borderRadius: radius.sm,
    overflow: 'hidden',
    paddingHorizontal: spacing[1],
  },
  // El color de lo que va ENCIMA del tint, como el tilde de la serie.
  text: { color: colors.onTint, fontWeight: '600' },
})

/**
 * Tier 1 de la celebración (§7.5): una pastilla que aparece en 200 ms y nada más. Sin confetti —
 * el delight es inversamente proporcional a la frecuencia, y en una sesión buena esto sale seguido.
 */
export default function PrBadge({ kinds, weight = '', animate = true, resumeKey = 0 }: Props) {
  const shown = useSharedValue(animate ? 0 : 1)
  const scale = useSharedValue(animate ? 0.9 : 1)

  // biome-ignore lint/correctness/useExhaustiveDependencies: el efecto reacciona a `resumeKey`, no lo lee
  useEffect(() => {
    shown.set(withTiming(1, Timing.base))
    scale.set(withSpring(1, Spring.press))
  }, [scale, shown, resumeKey])

  const style = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ scale: scale.get() }],
  }))

  return (
    <Animated.View
      accessible
      accessibilityLabel={kinds.length === 0 ? t('pr.badge') : prKindsLabel(kinds, weight)}
      style={[styles.pill, style]}
    >
      <GradientSurface style={StyleSheet.absoluteFill} />
      {/* Dos letras dentro de una columna de 34 pt: a 1.6× se desbordarían sobre la columna de al lado. */}
      <Text maxFontSizeMultiplier={1.3} role="caption" style={styles.text}>
        {t('pr.badge')}
      </Text>
    </Animated.View>
  )
}
