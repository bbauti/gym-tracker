import { router, useIsFocused } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { listFolders } from '@/db/queries/folders'
import { deloadState, dismissDeload, endDeload, startDeload } from '@/db/queries/progression'
import { listRoutines, type RoutineSummary, startSessionFromDay } from '@/db/queries/routines'
import { createSession, getActiveSessionId, getSessionTree } from '@/db/queries/session'
import { addDays, startOfDay, streakWeeks, thisAndLastWeek, trainingDays } from '@/db/queries/stats'
import { useQuery } from '@/db/useQuery'
import { plural, t } from '@/i18n'
import { elapsedMs } from '@/lib/rest'
import { formatDuration } from '@/lib/units'
import { ensureNotificationPermission } from '@/notifications'
import Badge from '@/ui/Badge'
import Bento from '@/ui/Bento'
import BigNumber from '@/ui/BigNumber'
import Button from '@/ui/Button'
import Card from '@/ui/Card'
import DeloadCard from '@/ui/DeloadCard'
import EmptyState from '@/ui/EmptyState'
import GlassCTA from '@/ui/GlassCTA'
import { haptic } from '@/ui/haptics'
import IconButton from '@/ui/IconButton'
import ListRow from '@/ui/ListRow'
import { useEnterFade, useStagger } from '@/ui/motion'
import PressableScale from '@/ui/PressableScale'
import { useNow } from '@/ui/RestTimer'
import SectionHeader from '@/ui/SectionHeader'
import Sparkline from '@/ui/Sparkline'
import Text from '@/ui/Text'
import Tile from '@/ui/Tile'
import { colors, opacity, Press, radius, spacing } from '@/ui/tokens'

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
// Los tres tiles del hero: sesiones (session), series y su fecha (set_entry) y el join que las
// cuelga de la sesión (session_exercise).
const HERO_TABLES = ['session', 'set_entry', 'session_exercise']

const SPARK_DAYS = 7
/** El hero y las primeras cards entran en cascada; el resto ya está abajo del pliegue (§12.5). */
const STAGGER_CARDS = 4

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.groupedBackground, flex: 1 },
  // La tab no tiene header propio: la fila del engranaje hace de barra y come el inset de arriba.
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing[2] },
  content: { flexGrow: 1, gap: spacing[4], padding: spacing[4] },
  emptyBox: { justifyContent: 'center', minHeight: 240 },
  // `colors.tint` es un PlatformColor: no se le baja el alpha, se lava con una capa encima (Tile).
  wash: { backgroundColor: colors.tint, borderRadius: radius.lg, opacity: opacity.wash },
  hero: { gap: spacing[2] },
  heroHead: { alignItems: 'center', flexDirection: 'row', gap: spacing[2] },
  grow: { flex: 1 },
  group: { gap: spacing[2] },
  routines: { gap: spacing[3] },
  card: { gap: spacing[2] },
  next: { flex: 1 },
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

/**
 * Los tres datos del bento, agregados acá con lo que ya exportan las queries (§12.2): no hay
 * ninguna función nueva en `db/`.
 */
function heroStats() {
  const now = Date.now()
  const from = addDays(startOfDay(now), -(SPARK_DAYS - 1))
  // `trainingDays` solo devuelve los días con algo: la serie se completa con ceros o la sparkline
  // dibujaría siete días seguidos de entrenamiento donde hubo dos.
  const byDay = new Map(trainingDays(from, now + 1).map((d) => [d.day, d.sets]))
  const sets = Array.from({ length: SPARK_DAYS }, (_, i) => byDay.get(addDays(from, i)) ?? 0)
  const week = thisAndLastWeek(now)
  return {
    sessions: week.current.sessions,
    sessionsDelta: week.current.sessions - week.previous.sessions,
    sets,
    setsTotal: sets.reduce((a, b) => a + b, 0),
    streak: streakWeeks(now),
  }
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

/**
 * El hero sin sesión abierta (§12.5): racha, semana y ritmo de las últimas series. Tres tiles y no
 * una pantalla de estadísticas — el detalle vive en Progreso.
 */
function HeroTiles({
  rise,
  stats,
}: {
  rise: ReturnType<typeof useStagger>
  stats: ReturnType<typeof heroStats>
}) {
  const delta = stats.sessionsDelta
  const sessionsUnit = plural(stats.sessions, t('train.sessions.one'), t('train.sessions.other'))
  const setsLabel = t('train.setsLast7A11y', { n: stats.setsTotal })
  return (
    <Bento.Row>
      <Tile
        entering={rise(0)}
        title={t('train.streak')}
        unit={plural(stats.streak, t('progress.weeks.one'), t('progress.weeks.other'))}
        value={String(stats.streak)}
      />
      <Tile
        // La etiqueta automática diría "+1" sin decir contra qué: la comparación es la mitad del dato.
        accessibilityLabel={[
          t('train.thisWeek'),
          `${stats.sessions} ${sessionsUnit}`,
          delta === 0
            ? null
            : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} ${t('progress.lastWeek')}`,
        ]
          .filter(Boolean)
          .join(', ')}
        delta={
          delta === 0 ? undefined : { sign: delta > 0 ? 1 : -1, text: String(Math.abs(delta)) }
        }
        entering={rise(1)}
        title={t('train.thisWeek')}
        unit={sessionsUnit}
        value={String(stats.sessions)}
      />
      <Tile
        accessibilityLabel={setsLabel}
        entering={rise(2)}
        title={t('train.setsLast7')}
        value={String(stats.setsTotal)}
      >
        {(size) => (
          <Sparkline
            endDot
            height={size.height}
            label={setsLabel}
            values={stats.sets}
            width={size.width}
          />
        )}
      </Tile>
    </Bento.Row>
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
    <Card style={styles.card} variant="raised">
      <PressableScale
        accessibilityLabel={[routine.name, nextDay ? t('routine.next') : null, next, meta]
          .filter(Boolean)
          .join(', ')}
        accessibilityRole="button"
        onPress={() => router.push({ params: { id: routine.id }, pathname: '/routine/[id]' })}
        scale={Press.row}
        style={styles.card}
      >
        <Text numberOfLines={1} role="headline">
          {routine.name}
        </Text>
        {nextDay ? (
          <View style={styles.heroHead}>
            <Badge label={t('routine.next')} tone="tint" />
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
          onPress={() => {
            // El golpe va en el mismo bloque que el push (§7.1): empezar es lo que se está sintiendo.
            haptic('sessionStart')
            openSession(() => startSessionFromDay(nextDay.id))
          }}
          size="lg"
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
  const stats = useQuery(heroStats, HERO_TABLES)
  // La ventana del deload la corre el reloj, no una escritura: si vence con la app abierta el cartel
  // se queda hasta la próxima serie. Un timer a 1 Hz para eso sería el peor cambio de la app.
  const deload = useQuery(() => deloadState(Date.now()), DELOAD_TABLES)
  // Solo la rutina recién creada entra con fade: la tab queda montada, así que "recién" es de verdad.
  const fadeIn = useEnterFade(routines.map((s) => s.routine.id))
  // Cascada del montaje y nada más: las tabs quedan montadas, así que corre una vez por lanzamiento.
  const rise = useStagger()
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
  // Instalación recién hecha: tres tiles en cero no son un resumen, son una pantalla vacía con
  // números. Ahí el hero es el dibujo de abajo y el CTA.
  const tiles = !busy && (stats.streak > 0 || stats.sessions > 0 || stats.setsTotal > 0)
  const staggerOffset = busy ? 1 : tiles ? 3 : 0

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
  // El orden de aparición es el de la pantalla (carpetas y después sueltas), no el de `routines`:
  // la cascada tiene que bajar, y `cards` se llama una vez por grupo.
  const order = new Map<number, number>()
  for (const folder of folders)
    for (const summary of byFolder.get(folder.id) ?? []) order.set(summary.routine.id, order.size)
  for (const summary of loose) order.set(summary.routine.id, order.size)

  const cards = (list: RoutineSummary[]) =>
    // Fuera de la cascada del montaje, solo el FadeIn de la rutina que entra (§7.5) — las que ya
    // estaban al abrir la tab no animan, o volver del entrenamiento se lee como carga.
    list.map((summary) => {
      const index = order.get(summary.routine.id) ?? 0
      return (
        <Animated.View
          entering={
            fadeIn(summary.routine.id) ??
            (index < STAGGER_CARDS ? rise(staggerOffset + index) : undefined)
          }
          key={summary.routine.id}
        >
          <RoutineCard busy={busy} summary={summary} />
        </Animated.View>
      )
    })

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton
          fallback="⚙"
          label={t('settings.title')}
          md="settings"
          onPress={() => router.push('/settings')}
          sf="gearshape"
        />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {current ? (
          <Animated.View entering={rise(0)}>
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
              accessibilityRole="button"
              onPress={() => {
                askNotifications()
                router.push({ params: { id: current.id }, pathname: '/session/[id]' })
              }}
              scale={Press.row}
            >
              <Card style={styles.hero} variant="raised">
                <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wash]} />
                {/* El lector ya tiene la frase entera arriba: adentro hay un BigNumber y un Badge
                    que en Android serían dos paradas más de TalkBack (un `accessible` no tapa a sus
                    hijos ahí, ver ui/Tile). */}
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.hero}
                >
                  <View style={styles.heroHead}>
                    <Text numberOfLines={1} role="titleEmphasized" style={styles.grow}>
                      {current.name ?? t('session.untitled')}
                    </Text>
                    {current.pausedAt === null ? null : (
                      <Badge label={t('session.paused')} tone="warning" />
                    )}
                  </View>
                  <BigNumber role="displaySmall" value={elapsed} />
                </View>
              </Card>
            </PressableScale>
          </Animated.View>
        ) : null}

        {tiles ? <HeroTiles rise={rise} stats={stats} /> : null}

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
            <View key={folder.id} style={styles.group}>
              <SectionHeader title={folder.name} />
              {/* Una carpeta vacía se sigue mostrando: es dónde soltar la próxima rutina. */}
              {list.length === 0 ? (
                <Text color="tertiary" role="footnote">
                  {t('folders.empty')}
                </Text>
              ) : (
                <View style={styles.routines}>{cards(list)}</View>
              )}
            </View>
          )
        })}

        <View style={styles.group}>
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

      {/* La barra no se va con un entrenamiento abierto: muta a "Continuar" (§12.5). Sigue siendo un
          solo control vivo para esa sesión —el mismo destino que la card de arriba— y el rótulo se
          cruza en vez de que la barra desaparezca de abajo de la pantalla.
          El entrenamiento libre baja de rótulo cuando hay rutinas: ahí empezar es tocar una card. */}
      <View style={styles.footer}>
        <GlassCTA
          mode={busy ? 'continue' : 'start'}
          primary={{
            md: 'play_arrow',
            onPress: () => {
              // Mismo bloque que el push (§7.1). Continuar es navegar y la transición ya es el
              // feedback: ahí no vibra nada (HIG).
              if (!busy) haptic('sessionStart')
              openSession(createSession)
            },
            sf: 'play.fill',
            title: busy
              ? t('session.continue')
              : routines.length === 0
                ? t('session.start')
                : t('routine.freeWorkout'),
          }}
          // C11: al lado y no en su propia fila — es una herramienta, no una forma de entrenar.
          secondary={{ onPress: () => router.push('/intervals'), title: t('intervals.title') }}
        />
      </View>
    </View>
  )
}
