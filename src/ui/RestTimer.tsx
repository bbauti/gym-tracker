import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, AppState, Platform, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  type EntryAnimationsValues,
  type ExitAnimationsValues,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { t } from '@/i18n'
import { restProgress, restRemainingMs } from '@/lib/rest'
import { formatDuration } from '@/lib/units'
import { haptic } from './haptics'
import { Spring, Timing } from './motion'
import PressableScale from './PressableScale'
import Text from './Text'
import { colors, MIN_TARGET, radius, spacing } from './tokens'

type Props = {
  /** Cuándo arrancó el descanso (MAX(completed_at) de la sesión): la barra es remaining / total. */
  startedAt: number
  endsAt: number
  onAdjust: (deltaMs: number) => void
  onSkip: () => void
  /** Se llama una sola vez, cuando el remaining llega a 0. */
  onDone: () => void
}

const ADJUST_MS = 15_000
const TRACK_HEIGHT = 4
/** Lo que tarda `Spring.snappy` en asentar (ζ=1, ~300 ms según ui/motion.ts). Ver `retarget`. */
const SNAPPY_MS = 300

/**
 * `Date.now()` refrescado a 1 Hz, alineado a la fase de `anchor`: el label cambia en el milisegundo
 * en que cambia el número, no medio segundo después. Cada tic vuelve a leer el reloj y calcula el
 * siguiente desde ahí — no acumula: un timeout que llega tarde (o la app que vuelve de background)
 * no atrasa la cuenta. `active` en false congela el valor sin dejar timers colgados.
 *
 * ponytail: vive en este archivo y no en uno propio porque el timer es su primer consumidor y son
 * veinte líneas. Techo: la tab de entrenar importa su cronómetro desde `@/ui/RestTimer`, que se lee
 * raro. Upgrade: `ui/useNow.ts` cuando aparezca el cuarto consumidor.
 */
export function useNow(anchor: number, active = true): number {
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    if (!active) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      const at = Date.now()
      setNow(at)
      // 1..1000 ms hasta el próximo cruce de segundo relativo a `anchor` (nunca 0: sería un tic al
      // pedo en el mismo milisegundo).
      timer = setTimeout(run, 1000 - ((((at - anchor) % 1000) + 1000) % 1000))
    }
    run()
    // En background los timeouts de JS se frenan: al volver se reengancha con el reloj, no con el
    // tic viejo. Y fuera de 'active' no queda nada corriendo.
    const sub = AppState.addEventListener('change', (state) => {
      clearTimeout(timer)
      if (state === 'active') run()
    })
    return () => {
      clearTimeout(timer)
      sub.remove()
    }
  }, [anchor, active])

  return now
}

/** Entra desde su propio alto con Spring.sheet: nada aparece de la nada (§7.1). */
function enter(values: EntryAnimationsValues) {
  'worklet'
  return {
    animations: {
      opacity: withTiming(1, Timing.base),
      transform: [{ translateY: withSpring(0, Spring.sheet) }],
    },
    initialValues: { opacity: 0, transform: [{ translateY: values.targetHeight }] },
  }
}

/** Sale por donde entró, en 0.7 × la entrada (§7.2, y §7.5 rechaza misma duración enter/exit). */
function exit(values: ExitAnimationsValues) {
  'worklet'
  return {
    animations: {
      opacity: withTiming(0, Timing.fast),
      transform: [{ translateY: withTiming(values.currentHeight, Timing.fast) }],
    },
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
  }
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.secondaryGroupedBackground,
    borderTopColor: colors.separator,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
  },
  head: { alignItems: 'baseline', flexDirection: 'row', gap: spacing[2] },
  title: { flex: 1 },
  track: {
    backgroundColor: colors.fill,
    borderRadius: TRACK_HEIGHT / 2,
    height: TRACK_HEIGHT,
    overflow: 'hidden',
  },
  // scaleX y no width: el ancho animado pasa por layout en cada frame (§7.5).
  fill: { backgroundColor: colors.tint, height: '100%', transformOrigin: 'left', width: '100%' },
  // `flexWrap`: con Dynamic Type AX los tres labels no entran en una línea de 393 pt y sin esto
  // el spacer colapsa y los controles se cortan. El spacer tiene flex-basis 0, así que no decide
  // el corte de línea: envuelve "Saltar" solo.
  actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
    paddingHorizontal: spacing[2],
  },
  spacer: { flex: 1 },
})

/**
 * Barra de descanso. Todo lo que muestra es derivado de `Date.now()` — nada corre en background y
 * nada se acumula: bloquear el teléfono tres minutos y volver muestra el número correcto (§2.6).
 * El label lo mueve React a 1 Hz (barato y legible); la barra vive en el UI thread.
 */
export default function RestTimer({ startedAt, endsAt, onAdjust, onSkip, onDone }: Props) {
  const insets = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const progress = useSharedValue(1)
  // El descanso que la barra está corriendo: si cambia, es otro descanso y la fracción se pisa.
  const running = useRef(0)
  const fired = useRef(false)
  const announced = useRef(0)

  // A propósito sin `useIsFocused` (el cronómetro de la sesión y la card de la tab sí lo usan): con
  // un formSheet encima —una nota, cambiar de ejercicio— el descanso tiene que seguir contando para
  // que el háptico caiga en el cero. La notificación no lo cubre: en foreground el handler la calla.
  // ponytail: el costo es un setState por segundo detrás de la sheet, y que la barra se quede
  // dibujada en 0:00 hasta que la sheet se cierre (la pantalla está stale, ver db/useQuery). Techo:
  // sheets muy largas. Upgrade: `AppState` ya frena en background; para el blur haría falta que la
  // pantalla de sesión se entere del cierre, que hoy es justo cuando `useQuery` la revalida.
  const now = useNow(endsAt)
  const remaining = restRemainingMs(endsAt, now)
  const seconds = Math.ceil(remaining / 1000)
  const label = formatDuration(seconds * 1000)

  useEffect(() => {
    // `reduceMotion` explícito: por default Reanimated manda cualquier `withTiming` al target en el
    // primer frame si el sistema tiene Reduce Motion, y acá la animación ES el dato (§7.2: la única
    // lineal legítima de la app). Sin esto la barra queda vacía todo el descanso.
    const drain = (ms: number) =>
      withTiming(0, { duration: ms, easing: Easing.linear, reduceMotion: ReduceMotion.Never })
    const retarget = (snap: boolean) => {
      const at = Date.now()
      const target = restProgress(startedAt, endsAt, at)
      const remainingMs = restRemainingMs(endsAt, at)
      // Descanso nuevo, vuelta de background o Reduce Motion (§7.6: "salta al target solo"): se pisa
      // la fracción y se re-cronometra. El `set` crudo, además, cancela la animación anterior — hace
      // falta: un `withTiming` arriba de otro con el mismo `toValue` HEREDA su `startTime` y su
      // `startValue` (animation/timing.js, `onStart`), o sea que se re-cronometraría mal.
      if (snap || reduced) {
        progress.set(target)
        progress.set(drain(remainingMs))
        return
      }
      // ±15 s: cambia el total, así que la fracción da un escalón (60 s a la mitad, −15 s → 0.5 pasa
      // a 0.33). Lo absorbe Spring.snappy y recién después sigue la carrera lineal (§7.6). El
      // `withSequence` también corta la herencia del timing anterior, así que cada toque pisa al de
      // antes desde donde está: tres taps rápidos = tres retargets, cero cola.
      // ponytail: al lineal se le descuentan los ~300 ms que tarda el spring en asentar en vez de
      // medirlos. Techo: la barra llega a 0 hasta ~100 ms antes que el label — invisible en 4 pt de
      // alto. Upgrade: un shared value aparte para el escalón, con el spring encima del lineal.
      progress.set(
        withSequence(
          withSpring(target, Spring.snappy),
          drain(Math.max(0, remainingMs - SNAPPY_MS)),
        ),
      )
    }
    retarget(running.current !== startedAt)
    running.current = startedAt
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') retarget(true)
    })
    return () => sub.remove()
  }, [startedAt, endsAt, progress, reduced])

  useEffect(() => {
    if (remaining > 0 || fired.current) return
    // El háptico en el mismo bloque que el aviso; el colapso lo dispara el padre al limpiar la fila.
    fired.current = true
    haptic('success')
    onDone()
  }, [remaining, onDone])

  // `accessibilityLiveRegion` es Android-only: en iOS (la plataforma primaria) hay que empujar el
  // anuncio a mano o VoiceOver no dice nada del descanso — y la barra es el último elemento del
  // árbol, así que tampoco se la encuentra barriendo. Al aparecer y en los minutos redondos; a 1 Hz
  // el lector no dejaría hablar a nadie.
  useEffect(() => {
    const fresh = announced.current !== startedAt
    announced.current = startedAt
    if (Platform.OS !== 'ios' || (!fresh && seconds % 60 !== 0)) return
    AccessibilityInfo.announceForAccessibility(
      `${t('rest.title')}: ${t('rest.remaining', { time: label })}`,
    )
  }, [startedAt, seconds, label])

  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.get() }] }))

  const adjust = (deltaMs: number) => {
    haptic('selection')
    onAdjust(deltaMs)
  }

  return (
    <Animated.View
      entering={enter}
      exiting={exit}
      style={[styles.bar, { paddingBottom: insets.bottom + spacing[3] }]}
    >
      <View style={styles.head}>
        <Text color="secondary" numberOfLines={1} role="footnote" style={styles.title}>
          {t('rest.title')}
        </Text>
        <Text
          accessibilityLabel={t('rest.remaining', { time: label })}
          // Solo en los minutos redondos: a 1 Hz el lector de pantalla no dejaría hablar a nadie.
          accessibilityLiveRegion={seconds % 60 === 0 ? 'polite' : 'none'}
          role="title"
          tabular
        >
          {label}
        </Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, fill]} />
      </View>
      <View style={styles.actions}>
        <PressableScale
          accessibilityLabel={t('rest.minus15')}
          onPress={() => adjust(-ADJUST_MS)}
          style={styles.action}
        >
          <Text color="tint" role="headline" tabular>
            {t('rest.minus15')}
          </Text>
        </PressableScale>
        <PressableScale
          accessibilityLabel={t('rest.plus15')}
          onPress={() => adjust(ADJUST_MS)}
          style={styles.action}
        >
          <Text color="tint" role="headline" tabular>
            {t('rest.plus15')}
          </Text>
        </PressableScale>
        <View style={styles.spacer} />
        <PressableScale accessibilityLabel={t('rest.skip')} onPress={onSkip} style={styles.action}>
          <Text color="secondary" role="headline">
            {t('rest.skip')}
          </Text>
        </PressableScale>
      </View>
    </Animated.View>
  )
}
