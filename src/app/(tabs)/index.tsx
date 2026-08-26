import { router, useIsFocused } from 'expo-router'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { ScrollView, StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { listFolders } from '@/db/queries/folders'
import { deloadState, dismissDeload, endDeload, startDeload } from '@/db/queries/progression'
import { listRoutines, type RoutineSummary, startSessionFromDay } from '@/db/queries/routines'
import { createSession, getActiveSessionId, getSessionTree } from '@/db/queries/session'
import { useQuery } from '@/db/useQuery'
import { plural, t } from '@/i18n'
import { elapsedMs } from '@/lib/rest'
import { formatDuration } from '@/lib/units'
import { ensureNotificationPermission } from '@/notifications'
import Button from '@/ui/Button'
import Card from '@/ui/Card'
import DeloadCard from '@/ui/DeloadCard'
import EmptyState from '@/ui/EmptyState'
import { haptic } from '@/ui/haptics'
import ListRow from '@/ui/ListRow'
import { useEnterFade } from '@/ui/motion'
import PressableScale from '@/ui/PressableScale'
import { useNow } from '@/ui/RestTimer'
import Text from '@/ui/Text'
import { colors, MIN_TARGET, radius, spacing } from '@/ui/tokens'

const SESSION_TABLES = ['session']
// `session` y `set_entry` también: la última vez y la duración estimada salen de las sesiones
// terminadas, y terminar una borra las series vacías en la misma transacción. Mientras entrenás esta
// tab está atrás y useQuery difiere el re-run hasta que volvés (ver db/useQuery.ts): al volver del
// entrenamiento la rotación, la estimación y el "última vez" se recalculan de una sola pasada.
const ROUTINE_TABLES = [
  'folder',
  'routine',
  'routine_day',
  'routine_exercise',
  'routine_set',
  'session',
  'set_entry',
]
// El consejo sale de los ajustes (los tres relojes del deload) y de lo entrenado en las dos semanas.
const DELOAD_TABLES = ['settings', 'session', 'set_entry', 'session_exercise']

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
  sectionRow: { alignItems: 'center', flexDirection: 'row', minHeight: MIN_TARGET },
  sectionTitle: {
    flex: 1,
    letterSpacing: 0.4,
    paddingHorizontal: spacing[2],
    textTransform: 'uppercase',
  },
  // El hitSlop de PressableScale no alcanza: en Android el toque se recorta a los límites del
  // padre. La fila mide 44 pt (igual en TODOS los encabezados) y el botón la llena.
  sectionAction: { justifyContent: 'center', minHeight: MIN_TARGET, paddingHorizontal: spacing[2] },
  folderEmpty: { paddingBottom: spacing[1], paddingHorizontal: spacing[2] },
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
  footerRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[2] },
  // PressableScale aplica `style` a su vista INTERNA: el flex tiene que ir en la que envuelve.
  grow: { flex: 1 },
  textButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    paddingHorizontal: spacing[3],
  },
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

/**
 * Abrir el entrenamiento: el que ya está abierto o el que arranca `start`.
 *
 * La sesión abierta se lee de la base en el toque y no de `useQuery`, que difiere la invalidación un
 * `setTimeout(0)` (db/useQuery.ts): en un doble toque el segundo veía la pantalla todavía "sin
 * sesión" y arrancaba una segunda. La primera quedaba abierta para siempre, invisible en el
 * historial (que solo lista las terminadas) y con el día de rutina entero precargado adentro.
 */
function openSession(start: () => number) {
  askNotifications()
  router.push({ params: { id: getActiveSessionId() ?? start() }, pathname: '/session/[id]' })
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

/**
 * La estimación se dice en minutos, no en `formatDuration`: "~45:00" se lee como un cronómetro
 * corriendo y esto es una duración aproximada.
 */
function estimatedLabel(ms: number) {
  const min = Math.round(ms / 60_000)
  return min < 60
    ? t('routine.estimatedMin', { n: min })
    : t('routine.estimatedHour', { h: Math.floor(min / 60), m: min % 60 })
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

/** Encabezado de sección: el de ROUTINES lleva además el acceso a las carpetas (D02). */
function SectionHeader({
  title,
  action,
}: {
  title: string
  action?: { title: string; onPress: () => void }
}) {
  return (
    <View style={styles.sectionRow}>
      <Text
        accessibilityRole="header"
        color="secondary"
        numberOfLines={1}
        role="footnote"
        style={styles.sectionTitle}
      >
        {title}
      </Text>
      {action ? (
        <PressableScale
          accessibilityLabel={action.title}
          onPress={action.onPress}
          style={styles.sectionAction}
        >
          <Text color="tint" role="footnote">
            {action.title}
          </Text>
        </PressableScale>
      ) : null}
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
  // D05: en un programa de varias semanas el nombre del día no alcanza — "Push" está en las dos.
  const weekDay =
    nextDay && (routine.weeks ?? 1) > 1
      ? t('routine.weekDay', { day: nextDay.orderIndex + 1, week: (nextDay.weekIndex ?? 0) + 1 })
      : null
  const next = nextDay
    ? [
        weekDay,
        nextDay.name,
        plural(
          nextDay.exerciseCount,
          t('history.exercises.one', { n: nextDay.exerciseCount }),
          t('history.exercises.other', { n: nextDay.exerciseCount }),
        ),
        // D12: sin sesiones de ese día no hay número que decir, y uno inventado miente.
        estimatedMs === null ? null : estimatedLabel(estimatedMs),
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
      {/* Con un entrenamiento abierto no hay botón: la regla de las dos pantallas es que haya
          exactamente UN control vivo para esa sesión y ninguno muerto. Acá ese control es la card de
          "Continuar" que está arriba de todo; en `routine/[id]`, que no la tiene, el botón se
          convierte en ella. Un botón apagado no dice por qué lo está (el lector solo oye
          "atenuado") y cinco cards con "Continuar entrenamiento" serían cinco veces el mismo botón.
          Sin días tampoco hay botón: la card abre la rutina, que es donde se agrega el primero.
          El label lleva el nombre de la rutina: el cuerpo de la card es otro elemento accesible, así
          que sin eso son cinco "Empezar, botón" idénticos seguidos. */}
      {nextDay && !busy ? (
        <Button
          accessibilityLabel={`${routine.name}, ${t('routine.start', { day: nextDay.name })}`}
          onPress={() => openSession(() => startSessionFromDay(nextDay.id))}
          title={t('routine.startShort')}
          variant="tinted"
        />
      ) : null}
    </Card>
  )
}

export default function TrainScreen() {
  const insets = useSafeAreaInsets()
  const current = useQuery(activeSession, SESSION_TABLES)
  const { folders, routines } = useQuery(
    () => ({ folders: listFolders(), routines: listRoutines() }),
    ROUTINE_TABLES,
  )
  // La ventana del deload la corre el reloj, no una escritura: si vence con la app abierta el cartel
  // se queda hasta la próxima serie. Un timer a 1 Hz para eso sería el peor cambio de la app.
  const deload = useQuery(() => deloadState(Date.now()), DELOAD_TABLES)
  // Solo la rutina recién creada entra con fade: la tab queda montada, así que "recién" es de verdad.
  const fadeIn = useEnterFade(routines.map((s) => s.routine.id))
  // Mismo criterio para el deload: el consejo que ya estaba al abrir la app no aparece, y esta es la
  // pantalla de arranque — animarlo en cada cold start de la semana sería puro ruido (§7.5).
  const deloadFade = useEnterFade(deload.advise || deload.active ? ['deload'] : [])
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

  // D02: las carpetas son cajones para mirar, no cambian en qué orden se entrena. Una rutina sin
  // carpeta (o cuya carpeta se borró: el FK dejó null) cae en el grupo de siempre.
  const byFolder = new Map<number, RoutineSummary[]>()
  const loose: RoutineSummary[] = []
  for (const summary of routines) {
    const folderId = summary.routine.folderId
    if (folderId === null) loose.push(summary)
    else {
      const list = byFolder.get(folderId)
      if (list) list.push(summary)
      else byFolder.set(folderId, [summary])
    }
  }
  const cards = (list: RoutineSummary[]) =>
    // Sin animación de lista: solo el FadeIn de la rutina que entra (§7.5) — las que ya estaban al
    // abrir la tab no animan, o volver del entrenamiento se lee como carga.
    list.map((summary) => (
      <Animated.View entering={fadeIn(summary.routine.id)} key={summary.routine.id}>
        <RoutineCard busy={busy} summary={summary} />
      </Animated.View>
    ))

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

        {deload.advise || deload.active ? (
          <DeloadCard
            entering={deloadFade('deload')}
            onDismiss={() => dismissDeload(Date.now())}
            onEnd={() => endDeload(Date.now())}
            onStart={() => {
              haptic('success')
              startDeload(Date.now())
            }}
            state={deload}
          />
        ) : null}

        {/* El dibujo solo cuando no hay nada, y sin botón propio: las dos filas de abajo son las
            acciones, y una de ellas es la única puerta a importar (D08) — en una instalación
            recién hecha, que es justo cuando pegar la rutina del entrenador importa más. */}
        {routines.length === 0 ? (
          <View style={styles.emptyBox}>
            <EmptyState
              description={t('routine.empty.description')}
              md="event_repeat"
              sf="list.bullet.rectangle"
              title={t('routine.empty.title')}
            />
          </View>
        ) : null}

        {folders.map((folder) => {
          const list = byFolder.get(folder.id) ?? []
          return (
            <View key={folder.id}>
              <SectionHeader title={folder.name} />
              {/* Una carpeta vacía se sigue mostrando: es dónde soltar la próxima rutina. */}
              {list.length === 0 ? (
                <Text color="tertiary" role="footnote" style={styles.folderEmpty}>
                  {t('folders.empty')}
                </Text>
              ) : (
                <View style={styles.routines}>{cards(list)}</View>
              )}
            </View>
          )
        })}

        <View>
          <SectionHeader
            action={{ onPress: () => router.push('/folders'), title: t('folders.manage') }}
            title={t('routine.title')}
          />
          <View style={styles.routines}>
            {cards(loose)}
            <View style={styles.rowCard}>
              <ListRow
                chevron
                onPress={() => router.push('/routine/new')}
                title={t('routine.new')}
              />
              <View style={styles.hideSeparator}>
                <ListRow
                  chevron
                  onPress={() => router.push('/routine-import')}
                  title={t('import.title')}
                />
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* El entrenamiento libre baja a acción secundaria cuando hay rutinas, y con una sesión
          abierta no está: misma regla que el botón de la card — el único control de esa sesión es la
          card de "Continuar". Esta barra está fija abajo, así que un botón apagado acá sería el
          control muerto más visible de la app. */}
      {busy ? null : (
        <View style={[styles.footer, styles.footerRow]}>
          <View style={styles.grow}>
            <Button
              onPress={() => openSession(createSession)}
              title={routines.length === 0 ? t('session.start') : t('routine.freeWorkout')}
              variant={routines.length === 0 ? 'filled' : 'plain'}
            />
          </View>
          {/* C11: al lado y no en su propia fila — es una herramienta, no una forma de entrenar. */}
          <PressableScale
            accessibilityLabel={t('intervals.title')}
            onPress={() => router.push('/intervals')}
            style={styles.textButton}
          >
            <Text color="tint" role="headline">
              {t('intervals.title')}
            </Text>
          </PressableScale>
        </View>
      )}
    </View>
  )
}
