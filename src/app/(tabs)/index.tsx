import { router, useIsFocused } from 'expo-router'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { ScrollView, StyleSheet, View } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { listRoutines, type RoutineSummary, startSessionFromDay } from '@/db/queries/routines'
import { createSession, getActiveSessionId, getSessionTree } from '@/db/queries/session'
import { useQuery } from '@/db/useQuery'
import { plural, t } from '@/i18n'
import { elapsedMs } from '@/lib/rest'
import { formatDuration } from '@/lib/units'
import { ensureNotificationPermission } from '@/notifications'
import Button from '@/ui/Button'
import Card from '@/ui/Card'
import EmptyState from '@/ui/EmptyState'
import ListRow from '@/ui/ListRow'
import PressableScale from '@/ui/PressableScale'
import { useNow } from '@/ui/RestTimer'
import Text from '@/ui/Text'
import { colors, MIN_TARGET, radius, spacing } from '@/ui/tokens'

const SESSION_TABLES = ['session']
// `session` también: la última vez y la duración estimada salen de las sesiones terminadas. Mientras
// entrenás esta tab está atrás y useQuery difiere el re-run hasta que volvés (ver db/useQuery.ts).
const ROUTINE_TABLES = ['routine', 'routine_day', 'routine_exercise', 'routine_set', 'session']

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.groupedBackground, flex: 1 },
  // La tab no tiene header propio: la fila del engranaje hace de barra y come el inset de arriba.
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing[2] },
  gear: {
    alignItems: 'center',
    minHeight: MIN_TARGET,
    justifyContent: 'center',
    width: MIN_TARGET,
  },
  content: { flexGrow: 1, gap: spacing[4], padding: spacing[4] },
  emptyBox: { justifyContent: 'center', minHeight: 240 },
  current: { gap: spacing[1] },
  sectionTitle: {
    letterSpacing: 0.4,
    paddingBottom: spacing[2],
    paddingHorizontal: spacing[2],
    textTransform: 'uppercase',
  },
  routines: { gap: spacing[3] },
  card: { gap: spacing[2] },
  cardHead: { alignItems: 'center', flexDirection: 'row', gap: spacing[2] },
  cardTitle: { flex: 1 },
  next: { flex: 1 },
  badge: {
    backgroundColor: colors.fill,
    borderRadius: radius.sm,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
  },
  // Una fila suelta con las esquinas del grupo; el último separador se recorta hacia afuera.
  rowCard: { borderRadius: radius.md, overflow: 'hidden' },
  hideSeparator: { marginBottom: -StyleSheet.hairlineWidth },
  footer: { padding: spacing[4], paddingTop: 0 },
})

/**
 * Empezar o continuar es el momento tranquilo para pedir el permiso: en Android el diálogo del
 * sistema es otra Activity y manda la app a background. Pedirlo desde el primer descanso lo hacía
 * justo mientras la fila animaba el tilde, y una animación de Reanimated que arranca con la app
 * atrás no progresa: la serie quedaba completada en la base pero sin pintar. Acá no hay ninguna
 * animación en vuelo. Es idempotente (se cachea la respuesta) y nunca tira: si dicen que no, todo
 * lo de notificaciones sigue siendo un no-op silencioso.
 */
function askNotifications() {
  void ensureNotificationPermission()
}

function activeSession() {
  const id = getActiveSessionId()
  return id === null ? null : (getSessionTree(id)?.session ?? null)
}

// ponytail: segunda copia de este helper (la otra está en app/settings.tsx). Techo: cambiar el
// formato se hace dos veces. Upgrade: `lib/time.ts` cuando aparezca la tercera.
function relativeTime(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000))
  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return t('time.minutesAgo', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('time.hoursAgo', { n: hours })
  return t('time.daysAgo', { n: Math.round(hours / 24) })
}

/** Etiqueta chiquita y NO tocable: `ui/Chip` es un control (pide onPress y vibra al tocarlo). */
function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <Text color="tint" role="caption">
        {label}
      </Text>
    </View>
  )
}

/**
 * El cuerpo de la card abre la rutina y el botón la empieza: son dos elementos accesibles separados
 * a propósito. Anidar el botón adentro del pressable del cuerpo lo escondería del lector (un
 * Pressable es `accessible` y se traga a sus hijos).
 */
function RoutineCard({ summary, busy }: { summary: RoutineSummary; busy: boolean }) {
  const { routine, nextDay, dayCount, lastDoneAt, estimatedMs } = summary
  const next = nextDay
    ? [
        nextDay.name,
        plural(
          nextDay.exerciseCount,
          t('history.exercises.one', { n: nextDay.exerciseCount }),
          t('history.exercises.other', { n: nextDay.exerciseCount }),
        ),
        // D12: sin sesiones de ese día no hay número que decir, y uno inventado miente.
        estimatedMs === null ? null : t('routine.estimated', { time: formatDuration(estimatedMs) }),
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const meta = [
    plural(
      dayCount,
      t('routine.days.one', { n: dayCount }),
      t('routine.days.other', { n: dayCount }),
    ),
    lastDoneAt === null
      ? t('routine.never')
      : t('routine.lastDone', { when: relativeTime(lastDoneAt) }),
  ].join(' · ')

  return (
    <Card style={styles.card}>
      <PressableScale
        accessibilityLabel={[routine.name, nextDay ? t('routine.next') : null, next, meta]
          .filter(Boolean)
          .join(', ')}
        onPress={() => router.push({ params: { id: routine.id }, pathname: '/routine/[id]' })}
        scale={0.98}
        style={styles.card}
      >
        <View style={styles.cardHead}>
          <Text numberOfLines={1} role="headline" style={styles.cardTitle}>
            {routine.name}
          </Text>
        </View>
        {nextDay ? (
          <View style={styles.cardHead}>
            <Badge label={t('routine.next')} />
            <Text color="secondary" numberOfLines={1} role="footnote" style={styles.next}>
              {next}
            </Text>
          </View>
        ) : null}
        <Text color="tertiary" numberOfLines={1} role="caption">
          {meta}
        </Text>
      </PressableScale>
      {/* ponytail: con una sesión abierta el botón se apaga en vez de preguntar "¿termino la otra?":
          el diálogo necesita strings que no existen en el diccionario. Techo: si te olvidaste una
          sesión abierta tenés que cerrarla desde la card de arriba. Upgrade: keys
          `routine.busyConfirm.*` + Alert con "Continuar" / "Empezar igual". */}
      <Button
        disabled={busy || nextDay === null}
        onPress={() => {
          if (!nextDay) return
          askNotifications()
          const id = startSessionFromDay(nextDay.id)
          router.push({ params: { id }, pathname: '/session/[id]' })
        }}
        title={t('routine.startShort')}
        variant="tinted"
      />
    </Card>
  )
}

export default function TrainScreen() {
  const insets = useSafeAreaInsets()
  const current = useQuery(activeSession, SESSION_TABLES)
  const routines = useQuery(listRoutines, ROUTINE_TABLES)
  // Mismo cronómetro que la pantalla de sesión: derivado del reloj, 1 Hz. No tica en pausa, sin
  // sesión, ni con la tab atrás (las tabs nativas dejan las pantallas montadas).
  const focused = useIsFocused()
  const now = useNow(
    current ? current.startedAt + current.pausedMs : 0,
    focused && current !== null && current.pausedAt === null,
  )
  const elapsed = current
    ? formatDuration(elapsedMs(current.startedAt, current.pausedMs, current.pausedAt, now))
    : ''
  const busy = current !== null

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <PressableScale
          accessibilityLabel={t('settings.title')}
          onPress={() => router.push('/settings')}
          style={styles.gear}
        >
          <SymbolView
            fallback={<Text role="title">⚙</Text>}
            name={{ ios: 'gearshape' as SFSymbol, android: 'settings' as AndroidSymbol }}
            size={24}
            tintColor={colors.label}
          />
        </PressableScale>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {current ? (
          <PressableScale
            // La card es un solo elemento para el lector: el cronómetro va en su label o no se lee.
            accessibilityLabel={[
              t('session.continue'),
              current.name ?? t('session.untitled'),
              t('session.elapsed', { time: elapsed }),
              current.pausedAt === null ? null : t('session.paused'),
            ]
              .filter(Boolean)
              .join(', ')}
            onPress={() => {
              askNotifications()
              router.push({ params: { id: current.id }, pathname: '/session/[id]' })
            }}
            scale={0.98}
          >
            <Card style={styles.current}>
              <Text role="headline">{current.name ?? t('session.untitled')}</Text>
              <Text color="secondary" role="footnote" tabular>
                {current.pausedAt === null ? elapsed : `${elapsed} · ${t('session.paused')}`}
              </Text>
              <Text color="tint" role="callout">
                {t('session.continue')}
              </Text>
            </Card>
          </PressableScale>
        ) : null}

        {routines.length === 0 ? (
          <View style={styles.emptyBox}>
            <EmptyState
              action={{ onPress: () => router.push('/routine/new'), title: t('routine.new') }}
              description={t('routine.empty.description')}
              md="event_repeat"
              sf="list.bullet.rectangle"
              title={t('routine.empty.title')}
            />
          </View>
        ) : (
          <View>
            <Text
              accessibilityRole="header"
              color="secondary"
              role="footnote"
              style={styles.sectionTitle}
            >
              {t('routine.title')}
            </Text>
            <View style={styles.routines}>
              {/* Sin animación de lista: solo el FadeIn de la card que entra (§7.5). */}
              {routines.map((summary) => (
                <Animated.View entering={FadeIn.duration(200)} key={summary.routine.id}>
                  <RoutineCard busy={busy} summary={summary} />
                </Animated.View>
              ))}
              <View style={styles.rowCard}>
                <View style={styles.hideSeparator}>
                  <ListRow
                    chevron
                    onPress={() => router.push('/routine/new')}
                    title={t('routine.new')}
                  />
                </View>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* El entrenamiento libre nunca desaparece: con rutinas baja a acción secundaria. Con una
          sesión abierta se apaga (la card de arriba es la que hay que atender). */}
      <View style={styles.footer}>
        <Button
          disabled={busy}
          onPress={() => {
            askNotifications()
            const id = createSession()
            router.push({ params: { id }, pathname: '/session/[id]' })
          }}
          title={routines.length === 0 ? t('session.start') : t('routine.freeWorkout')}
          variant={routines.length === 0 ? 'filled' : 'plain'}
        />
      </View>
    </View>
  )
}
