import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import type { ReactNode } from 'react'
import { Dimensions, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { t } from '@/i18n'
import { project, rubberband } from '@/lib/gesture'
import { haptic } from './haptics'
import { Spring, Timing } from './motion'
import Text from './Text'
import { colors, radius, spacing } from './tokens'

type Props = {
  children: ReactNode
  onDelete: () => void
  enabled?: boolean
}

// §7.3: umbrales OR (80 px de posición proyectada O 500 px/s), 1:1 hasta MAX y rubberband después.
const THRESHOLD = 80
const VELOCITY = 500
const MAX = 120
// Portrait-only (app.json), así que el ancho de ventana a nivel módulo no se queda viejo.
const OFF_SCREEN = -Dimensions.get('window').width

// La fila no es un elemento accesible (adentro hay celdas enfocables): la acción custom solo la ve
// VoiceOver cuando el hijo es un único elemento (ListRow). ponytail: el camino accesible de verdad
// para borrar una serie es el menú de la fila (session.set.menu.*). Techo: en filas con celdas
// enfocables el swipe no tiene equivalente accesible. Upgrade: pasar la acción al hijo.
const A11Y_ACTIONS = [{ label: t('common.delete'), name: 'delete' }]

const styles = StyleSheet.create({
  // El radio va acá (con overflow hidden) para que la zona destructiva de atrás no asome en esquina
  // cuadrada por debajo de una fila redondeada.
  wrap: { borderRadius: radius.sm, overflow: 'hidden' },
  action: {
    ...StyleSheet.absoluteFill,
    alignItems: 'flex-end',
    backgroundColor: colors.destructive,
    justifyContent: 'center',
    paddingRight: spacing[5],
  },
  content: { backgroundColor: colors.secondaryGroupedBackground },
  fallbackIcon: { color: colors.onTint },
})

export default function SwipeRow({ children, onDelete, enabled = true }: Props) {
  const tx = useSharedValue(0)
  const opacity = useSharedValue(1)
  // Solo mientras el dedo manda: la salida a la izquierda también cruza el umbral y no debe vibrar.
  const armed = useSharedValue(false)

  useAnimatedReaction(
    () => armed.get() && tx.get() <= -THRESHOLD,
    (crossed, previous) => {
      if (previous === null || crossed === previous || !armed.get()) return
      scheduleOnRN(haptic, crossed ? 'thresholdIn' : 'thresholdOut')
    },
  )

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([-12, 12])
    .failOffsetY([-14, 14])
    .maxPointers(1)
    .onBegin(() => {
      armed.set(true)
    })
    .onUpdate((e) => {
      const dx = e.translationX
      // Derecha: borde duro (c = 0.3). Izquierda: 1:1 hasta MAX y después resistencia.
      tx.set(dx > 0 ? rubberband(dx, MAX, 0.3) : dx > -MAX ? dx : -MAX + rubberband(dx + MAX, MAX))
    })
    // Un solo handler: onEnd + cancelación. `success` false = el gesto se canceló, nunca commitea.
    .onFinalize((e, success) => {
      armed.set(false)
      const projected = tx.get() + project(e.velocityX)
      if (success && (projected <= -THRESHOLD || e.velocityX <= -VELOCITY)) {
        // §7.1: el háptico va en el frame del commit, y el commit de un swipe es soltar — no el
        // final de los 200 ms de salida. El gate por evento (300 ms) se come el `delete` que dispara
        // quien borra cuando llega la animación, así que suena una sola vez.
        scheduleOnRN(haptic, 'delete')
        // §7.6 pide 200 ms exactos de salida hacia el mismo lado del swipe: acá el valor deja de ser
        // del dedo y pasa a ser una salida, por eso es withTiming y no un release con velocity.
        opacity.set(withTiming(0, Timing.base))
        tx.set(
          withTiming(OFF_SCREEN, Timing.base, (done) => {
            if (done) scheduleOnRN(onDelete)
          }),
        )
        return
      }
      tx.set(withSpring(0, { ...Spring.snappy, velocity: e.velocityX }))
    })

  const content = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateX: tx.get() }],
  }))

  // Android no recorta el fondo del underlay con el `borderRadius` del wrap: a fila quieta asomaban
  // cuatro arcos rojos en las esquinas. Binario, así que el reveal sigue siendo 1:1.
  const underlay = useAnimatedStyle(() => ({ opacity: tx.get() < 0 ? 1 : 0 }))

  const icon = useAnimatedStyle(() => {
    const progress = interpolate(-tx.get(), [0, THRESHOLD], [0, 1], Extrapolation.CLAMP)
    return { opacity: progress, transform: [{ scale: 0.7 + 0.3 * progress }] }
  })

  return (
    <View
      accessibilityActions={A11Y_ACTIONS}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'delete') onDelete()
      }}
      style={styles.wrap}
    >
      <Animated.View
        // Decorativo siempre: la acción accesible es la del wrap (`A11Y_ACTIONS`), y así el ícono
        // tampoco se anuncia mientras el underlay está apagado.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[styles.action, underlay]}
      >
        <Animated.View style={icon}>
          <SymbolView
            fallback={<Text style={styles.fallbackIcon}>✕</Text>}
            name={{ ios: 'trash.fill' as SFSymbol, android: 'delete' as AndroidSymbol }}
            size={22}
            tintColor="#FFFFFF"
          />
        </Animated.View>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.content, content]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  )
}
