import { useEffect, useRef, useSyncExternalStore } from 'react'
import { AccessibilityInfo, AppState, Dimensions, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'
import { project, rubberband } from '@/lib/gesture'
import { Spring, Timing } from './motion'
import PressableScale from './PressableScale'
import Text from './Text'
import { colors, MIN_TARGET, radius, spacing } from './tokens'

type ToastOptions = {
  text: string
  actionLabel?: string
  onAction?: () => void
  duration?: number
}
type ToastItem = ToastOptions & { id: number }

const DEFAULT_MS = 4000
/** Con lector de pantalla el reloj se triplica: encontrar el botón barriendo no entra en 4 s. */
const SCREEN_READER_FACTOR = 3
const OFFSET = 120 // arranca (y sale) por abajo, fuera de su lugar de reposo
const DISMISS_PX = 45 // §7.3: 45 px O 110 px/s, sobre la posición proyectada
const DISMISS_V = 110
const EDGE = 80 // dimensión del rubberband para arriba/izquierda (no se descarta por ahí)
// Portrait-only (app.json): el ancho de ventana a nivel módulo no se queda viejo.
const OFF_RIGHT = Dimensions.get('window').width

// Un solo toast a la vez: el nuevo reemplaza al viejo (§ contrato). El estado vive en el módulo para
// que `clear` sea llamable desde un worklet y desde el gesto sin pasar por props.
let seq = 0
let visible: ToastItem | null = null
let hideNow: (() => void) | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function clear(id: number) {
  if (visible?.id !== id) return // ya lo reemplazó otro toast
  visible = null
  emit()
}

export const toast = {
  show(options: ToastOptions): void {
    seq += 1
    visible = { ...options, id: seq }
    emit()
  },
}

const styles = StyleSheet.create({
  host: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end' },
  toast: {
    alignItems: 'center',
    backgroundColor: colors.secondaryGroupedBackground,
    borderRadius: radius.lg,
    elevation: 4,
    flexDirection: 'row',
    gap: spacing[2],
    marginHorizontal: spacing[4],
    minHeight: 52,
    paddingLeft: spacing[4],
    paddingRight: spacing[2],
    paddingVertical: spacing[2],
    shadowColor: '#000000',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  text: { flex: 1 },
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    paddingHorizontal: spacing[3],
  },
})

/**
 * Pose de reposo: abajo y apagado. La salida por gesto termina donde el dedo la dejó, así que sin
 * esto el toast siguiente ya estaría opaco y en su lugar — y entraría sin entrar (§7.1).
 */
function rest(
  tx: SharedValue<number>,
  ty: SharedValue<number>,
  opacity: SharedValue<number>,
  id: number,
) {
  'worklet'
  tx.set(0)
  ty.set(OFFSET)
  opacity.set(0)
  scheduleOnRN(clear, id)
}

/** Salida sin gesto: baja y se apaga en 200 ms, y recién ahí se desmonta. */
function hide(ty: SharedValue<number>, opacity: SharedValue<number>, id: number) {
  opacity.set(withTiming(0, Timing.base))
  ty.set(
    withTiming(OFFSET, Timing.base, (done) => {
      if (done) scheduleOnRN(clear, id)
    }),
  )
}

/** Se monta una sola vez, en el layout raíz y adentro del GestureHandlerRootView. */
export function ToastHost() {
  const item = useSyncExternalStore(subscribe, () => visible)
  const insets = useSafeAreaInsets()
  const tx = useSharedValue(0)
  const ty = useSharedValue(OFFSET)
  const opacity = useSharedValue(0)
  // La acción sigue siendo tocable los 200 ms que tarda en irse, y `restoreSet` no es idempotente:
  // el segundo toque reventaría con UNIQUE constraint en medio del entrenamiento.
  const fired = useRef(false)

  useEffect(() => {
    if (!item) return
    const id = item.id
    // Si ya estaba puesto, esto es un no-op: el toast nuevo solo reinicia el reloj, no re-entra.
    fired.current = false
    tx.set(0)
    ty.set(withTiming(0, Timing.toast))
    opacity.set(withTiming(1, Timing.toast))

    let remaining = item.duration ?? DEFAULT_MS
    let startedAt = Date.now()
    let paused = false
    let gone = false
    const close = () => hide(ty, opacity, id)
    let timer = setTimeout(close, remaining)
    hideNow = close

    // `accessibilityLiveRegion` es solo de Android (ViewAccessibility.d.ts lo marca @platform
    // android). Sin diálogo para borrar (§7.5) este toast es el único camino de vuelta, así que en
    // iOS se anuncia a mano y el reloj se estira si hay lector de pantalla.
    AccessibilityInfo.announceForAccessibility(
      item.actionLabel ? `${item.text}. ${item.actionLabel}` : item.text,
    )
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => {
        if (!on || gone || paused) return
        clearTimeout(timer)
        remaining = (item.duration ?? DEFAULT_MS) * SCREEN_READER_FACTOR
        startedAt = Date.now()
        timer = setTimeout(close, remaining)
      })
      .catch(() => {})

    // El reloj se pausa con la app en background: volver y encontrar el "deshacer" ya vencido es
    // perder datos sin pedirlo.
    const appState = AppState.addEventListener('change', (state) => {
      const active = state === 'active'
      if (active === !paused) return // ya estaba en ese estado ('inactive' + 'background' seguidos)
      paused = !active
      if (active) {
        startedAt = Date.now()
        timer = setTimeout(close, remaining)
      } else {
        clearTimeout(timer)
        remaining = Math.max(0, remaining - (Date.now() - startedAt))
      }
    })

    return () => {
      gone = true
      clearTimeout(timer)
      appState.remove()
      if (hideNow === close) hideNow = null
    }
  }, [item, ty, tx, opacity])

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }],
  }))

  const id = item?.id ?? 0
  const pan = Gesture.Pan()
    .maxPointers(1)
    // Sin umbral de activación el pan se come el tap sobre "deshacer".
    .activeOffsetX([-12, 12])
    .activeOffsetY([-12, 12])
    .onUpdate((e) => {
      tx.set(e.translationX > 0 ? e.translationX : rubberband(e.translationX, EDGE, 0.3))
      ty.set(e.translationY > 0 ? e.translationY : rubberband(e.translationY, EDGE, 0.3))
    })
    .onFinalize((e, success) => {
      const px = tx.get() + project(e.velocityX)
      const py = ty.get() + project(e.velocityY)
      const out =
        px >= DISMISS_PX || py >= DISMISS_PX || e.velocityX >= DISMISS_V || e.velocityY >= DISMISS_V
      if (success && out) {
        // Sale por donde lo tiraron y con su propia velocidad: lo que venía del dedo se suelta con
        // spring + velocity, nunca con una duración.
        opacity.set(withTiming(0, Timing.base))
        if (px > py) {
          tx.set(
            withSpring(OFF_RIGHT, { ...Spring.flick, velocity: e.velocityX }, (done) => {
              if (done) rest(tx, ty, opacity, id)
            }),
          )
        } else {
          ty.set(
            withSpring(OFFSET * 2, { ...Spring.flick, velocity: e.velocityY }, (done) => {
              if (done) rest(tx, ty, opacity, id)
            }),
          )
        }
        return
      }
      tx.set(withSpring(0, { ...Spring.snappy, velocity: e.velocityX }))
      ty.set(withSpring(0, { ...Spring.snappy, velocity: e.velocityY }))
    })

  if (!item) return null

  return (
    <View pointerEvents="box-none" style={styles.host}>
      <GestureDetector gesture={pan}>
        <Animated.View
          accessibilityLiveRegion="polite"
          style={[styles.toast, { marginBottom: insets.bottom + spacing[3] }, animated]}
        >
          <Text numberOfLines={2} style={styles.text}>
            {item.text}
          </Text>
          {item.actionLabel ? (
            <PressableScale
              accessibilityLabel={item.actionLabel}
              onPress={() => {
                if (fired.current) return
                fired.current = true
                item.onAction?.()
                hideNow?.()
              }}
              style={styles.action}
            >
              <Text color="tint" role="headline">
                {item.actionLabel}
              </Text>
            </PressableScale>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  )
}
