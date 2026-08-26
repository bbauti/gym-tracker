import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { Stack } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, AppState, ScrollView, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { type TKey, t } from '@/i18n'
import { type IntervalPhase, PREP_MS, phaseAt } from '@/lib/intervals'
import { formatDuration } from '@/lib/units'
import { cancelScheduled, INTERVALS_CHANNEL_ID, scheduleAt } from '@/notifications'
import Button from '@/ui/Button'
import Card from '@/ui/Card'
import { haptic } from '@/ui/haptics'
import { useNow } from '@/ui/RestTimer'
import Stepper from '@/ui/Stepper'
import Text from '@/ui/Text'
import { colors, spacing } from '@/ui/tokens'

const KEEP_AWAKE_TAG = 'gym-intervals'
/** Id fijo: hay un solo intervalo a la vez y así se cancela aunque el proceso se haya muerto. */
const NOTIFICATION_ID = 'intervals-phase'
const TRACK_HEIGHT = 6

const PHASE_LABEL: Record<IntervalPhase, TKey> = {
  prep: 'intervals.prep',
  work: 'intervals.work',
  rest: 'intervals.rest',
  done: 'intervals.done',
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.groupedBackground, flex: 1 },
  content: { gap: spacing[4], padding: spacing[4] },
  timer: { alignItems: 'center', gap: spacing[3] },
  readout: { alignItems: 'center', alignSelf: 'stretch', gap: spacing[1] },
  count: { fontSize: 64, lineHeight: 72 },
  track: {
    alignSelf: 'stretch',
    backgroundColor: colors.fill,
    borderRadius: TRACK_HEIGHT / 2,
    height: TRACK_HEIGHT,
    overflow: 'hidden',
  },
  // scaleX y no width: el ancho animado pasa por layout en cada frame (§7.5).
  fill: { backgroundColor: colors.tint, height: '100%', transformOrigin: 'left', width: '100%' },
  config: { gap: spacing[2] },
  locked: { opacity: 0.4 },
  footer: { flexDirection: 'row', gap: spacing[3], paddingHorizontal: spacing[4] },
  // PressableScale le pone el `style` a su vista INTERNA: el flex va en el envoltorio.
  grow: { flex: 1 },
})

/**
 * C11/C12. Todo lo que se ve sale de `phaseAt(config, startedAt, now)`: no hay una máquina de
 * estados que avance sola, así que volver de bloquear la pantalla —o de tres minutos en
 * background— muestra la fase correcta sin haber ejecutado un tick. Pausar corre `startedAt` hacia
 * adelante; el resto es el mismo reloj de siempre (§2.6).
 */
export default function IntervalsScreen() {
  const insets = useSafeAreaInsets()
  const [workS, setWorkS] = useState(30)
  const [restS, setRestS] = useState(15)
  const [rounds, setRounds] = useState(8)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [pausedAt, setPausedAt] = useState<number | null>(null)
  const progress = useSharedValue(1)
  const marked = useRef('')

  const config = { prepMs: PREP_MS, workMs: workS * 1000, restMs: restS * 1000, rounds }
  // El label lo mueve React a 1 Hz, alineado a `startedAt`: como las fases duran segundos enteros,
  // el tic cae justo en el cambio de fase. En pausa el reloj es `pausedAt`, congelado.
  const tick = useNow(startedAt ?? 0, startedAt !== null && pausedAt === null)
  const now = pausedAt ?? tick
  // Parado, `startedAt = now`: la pantalla muestra lo que va a pasar al tocar Empezar (los 3-2-1).
  const state = phaseAt(config, startedAt ?? now, now)
  const { phaseEndsAt, round, totalMs } = state
  const phase = state.phase
  const finished = phase === 'done'
  const paused = startedAt !== null && pausedAt !== null
  const running = startedAt !== null && pausedAt === null && !finished
  const locked = startedAt !== null && !finished

  const seconds = Math.ceil(state.remainingMs / 1000)
  // C12: la preparación se cuenta pelada (3, 2, 1), no como "0:03".
  const countdown = phase === 'prep' ? String(seconds) : formatDuration(seconds * 1000)
  const phaseLabel = t(PHASE_LABEL[phase])
  const roundLabel = t('intervals.round', { round, total: rounds })

  // Qué toca cuando termine esta fase: se lo pregunto a `phaseAt` en el instante del cambio en vez
  // de repetir las reglas (con descanso en 0 encadena trabajo, y la última ronda no descansa).
  const next = startedAt === null ? 'done' : phaseAt(config, startedAt, phaseEndsAt).phase
  const notice = t(
    next === 'work'
      ? 'intervals.notifWork'
      : next === 'rest'
        ? 'intervals.notifRest'
        : 'intervals.notifDone',
  )

  const stop = () => {
    setStartedAt(null)
    setPausedAt(null)
  }

  const start = () => {
    setStartedAt(Date.now())
    setPausedAt(null)
  }

  const pause = () => setPausedAt(Date.now())

  const resume = () => {
    if (pausedAt === null) return
    const owed = Date.now() - pausedAt
    setStartedAt((at) => (at === null ? at : at + owed))
    setPausedAt(null)
  }

  // C12: un háptico por cada número de la cuenta atrás. Lo dispara `seconds` porque ES el número
  // que se ve — en preparación nunca es cero: en el cero ya cambió la fase.
  useEffect(() => {
    if (running && phase === 'prep' && seconds > 0) haptic('selection')
  }, [running, phase, seconds])

  // Cada cambio de fase: háptico y el anuncio a mano, en las dos plataformas — es el único que se
  // dice mientras corre, y uno por fase es exactamente lo que hace falta oír.
  // El marcador lleva la ronda porque con descanso en 0 la fase no cambia entre rondas.
  const marker = startedAt === null ? '' : `${phase}${round}`
  useEffect(() => {
    const prev = marked.current
    marked.current = marker
    if (!prev || !marker || prev === marker) return
    if (phase !== 'prep') haptic('success')
    AccessibilityInfo.announceForAccessibility(
      phase === 'done'
        ? t('intervals.done')
        : `${t(PHASE_LABEL[phase])}. ${t('intervals.round', { round, total: rounds })}`,
    )
  }, [marker, phase, round, rounds])

  // Una sola notificación, la del final de ESTA fase; el efecto se rearma en cada cambio y el
  // cleanup la cancela al pausar, parar, terminar y al desmontar.
  useEffect(() => {
    if (!running) return
    scheduleAt(NOTIFICATION_ID, phaseEndsAt, t('intervals.title'), notice, INTERVALS_CHANNEL_ID)
    return () => {
      cancelScheduled(NOTIFICATION_ID)
    }
  }, [running, phaseEndsAt, notice])

  useEffect(() => {
    if (!running) return
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {})
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {})
    }
  }, [running])

  // La barra vive en el UI thread: se apunta a la fracción real y se vacía lineal hasta el final de
  // la fase. `reduceMotion` explícito porque acá la animación ES el dato (§7.2), y el `set` crudo de
  // antes corta la herencia del `withTiming` anterior (ver ui/RestTimer).
  useEffect(() => {
    if (startedAt === null || totalMs <= 0) {
      progress.set(startedAt === null ? 1 : 0)
      return
    }
    const paint = (at: number) => {
      const remaining = Math.max(0, Math.min(totalMs, phaseEndsAt - at))
      progress.set(remaining / totalMs)
      return remaining
    }
    if (pausedAt !== null) {
      paint(pausedAt)
      return
    }
    const drain = () => {
      progress.set(
        withTiming(0, {
          duration: paint(Date.now()),
          easing: Easing.linear,
          reduceMotion: ReduceMotion.Never,
        }),
      )
    }
    drain()
    // En background las animaciones no progresan: al volver se re-cronometra contra el reloj.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') drain()
    })
    return () => sub.remove()
  }, [pausedAt, phaseEndsAt, progress, startedAt, totalMs])

  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.get() }] }))

  const primary = finished || startedAt === null ? start : paused ? resume : pause
  const primaryTitle = t(
    finished || startedAt === null
      ? 'intervals.start'
      : paused
        ? 'intervals.resume'
        : 'intervals.pause',
  )

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: t('intervals.title') }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.timer}>
          {/* Un solo elemento accesible: la fase, el número y la ronda se leen juntos. La región
              viva solo durante la preparación (C12: el 3-2-1 es el único conteo que se quiere oír
              número por número); a 1 Hz el resto del tiempo el lector no dejaría hablar a nadie
              —mismo criterio que ui/RestTimer—. Los cambios de fase los anuncia el efecto de
              `marker`. */}
          <View
            accessibilityLabel={`${phaseLabel}, ${countdown}, ${roundLabel}`}
            accessibilityLiveRegion={phase === 'prep' ? 'polite' : 'none'}
            accessible
            style={styles.readout}
          >
            <Text color="secondary" role="headline">
              {phaseLabel}
            </Text>
            <Text
              adjustsFontSizeToFit
              numberOfLines={1}
              role="largeTitle"
              style={styles.count}
              tabular
            >
              {countdown}
            </Text>
            <Text color="secondary" role="footnote" tabular>
              {roundLabel}
            </Text>
          </View>
          <View style={styles.track}>
            <Animated.View style={[styles.fill, fill]} />
          </View>
        </Card>
        {/* Corriendo o en pausa la config no se toca (cambiarla movería la fase bajo los pies), y
            para el lector de pantalla directamente no está. */}
        <View
          accessibilityElementsHidden={locked}
          importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}
          pointerEvents={locked ? 'none' : 'auto'}
          style={locked ? styles.locked : null}
        >
          <Card style={styles.config}>
            {/* Tocar la config borra la corrida terminada: si no, `phaseAt` recalcularía la vieja
                `startedAt` con las rondas nuevas y el timer reviviría a mitad. */}
            <Stepper
              format={(v) => formatDuration(v * 1000)}
              label={t('intervals.work')}
              max={600}
              min={5}
              onChange={(v) => {
                stop()
                setWorkS(v)
              }}
              step={5}
              value={workS}
            />
            <Stepper
              format={(v) => formatDuration(v * 1000)}
              label={t('intervals.rest')}
              max={600}
              min={0}
              onChange={(v) => {
                stop()
                setRestS(v)
              }}
              step={5}
              value={restS}
            />
            <Stepper
              label={t('intervals.rounds')}
              max={30}
              min={1}
              onChange={(v) => {
                stop()
                setRounds(v)
              }}
              value={rounds}
            />
          </Card>
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing[4] }]}>
        <View style={styles.grow}>
          <Button onPress={primary} title={primaryTitle} />
        </View>
        {startedAt !== null ? (
          <View style={styles.grow}>
            <Button destructive onPress={stop} title={t('intervals.stop')} variant="tinted" />
          </View>
        ) : null}
      </View>
    </View>
  )
}
