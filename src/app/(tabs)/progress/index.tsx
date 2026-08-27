import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { latest } from '@/db/queries/body'
import { exerciseName, listExercises, recentExercises } from '@/db/queries/exercises'
import { listSessions } from '@/db/queries/history'
import { landmarks, recentMuscleLoad, weeklyHardSets } from '@/db/queries/progression'
import { currentBests } from '@/db/queries/prs'
import { getSettings } from '@/db/queries/settings'
import {
  addDays,
  exerciseSeries,
  neglectedMuscles,
  pushPullBalance,
  startOfDay,
  startOfWeek,
  streakWeeks,
  thisAndLastWeek,
  totalTonnageG,
  trainingDays,
  volumeByMuscle,
  weekSummary,
} from '@/db/queries/stats'
import { useQuery } from '@/db/useQuery'
import { locale, plural, t } from '@/i18n'
import { formatDuration, formatWeight, type Unit } from '@/lib/units'
import { shareChart } from '@/share'
import Bento from '@/ui/Bento'
import BigNumber from '@/ui/BigNumber'
import Card from '@/ui/Card'
import Chip from '@/ui/Chip'
import EmptyState from '@/ui/EmptyState'
import ExerciseChart, { type ChartPoint } from '@/ui/ExerciseChart'
import Heatmap from '@/ui/Heatmap'
import { haptic } from '@/ui/haptics'
import ListRow from '@/ui/ListRow'
import MuscleMap, { topLoaded } from '@/ui/MuscleMap'
import { useStagger } from '@/ui/motion'
import ProgressBar from '@/ui/ProgressBar'
import Ring from '@/ui/Ring'
import SectionHeader from '@/ui/SectionHeader'
import Sparkline from '@/ui/Sparkline'
import Text from '@/ui/Text'
import Tile from '@/ui/Tile'
import { toast } from '@/ui/Toast'
import { colors, radius, spacing } from '@/ui/tokens'
import VolumeLandmarks from '@/ui/VolumeLandmarks'

/** Las tablas reales: `useQuery` escucha el hook de sqlite, que no ve la vista `v_work_set`. */
const TABLES = ['session', 'set_entry', 'session_exercise', 'exercise'] as const
/** `exerciseSeries` calcula el 1RM con la fórmula de ajustes: si cambia, la línea tiene que rehacerse. */
const SERIES_TABLES = [...TABLES, 'settings'] as const
/** Los landmarks viven en `settings.volume_landmarks`: editarlos tiene que redibujar las barras. */
const VOLUME_TABLES = [...TABLES, 'settings'] as const
const WEEKS = 12
const MUSCLE_ROWS = 8
const NEGLECTED_ROWS = 5
const RECENTS = 6
const SERIES_SESSIONS = 30
const EMPTY = '—'
/** Alto de la sparkline del tile de volumen: el resto del tile es el número, que es el dato. */
const SPARK_H = 56
/** Fijo y no medido: el anillo adentro de un tile `sm` no puede depender del alto que él mismo pide. */
const RING = 76

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { padding: spacing[4], gap: spacing[3] },
  section: { gap: spacing[2] },
  // Aire extra donde arranca un tema nuevo: entre tiles del mismo bloque alcanza con el gap.
  top: { marginTop: spacing[2] },
  // La tira de chips llega a los bordes de la pantalla; el contenido sigue alineado al padding.
  bleed: { marginHorizontal: -spacing[4] },
  chips: { flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[4] },
  card: { borderRadius: radius.xl, gap: spacing[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  grow: { flex: 1 },
  bar: { gap: spacing[1] },
  volume: { flexGrow: 1, gap: spacing[2], justifyContent: 'flex-end' },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  // El marginBottom se come la última hairline de ListRow, que adentro del grupo se ve suelta.
  group: { borderRadius: radius.lg, overflow: 'hidden', marginBottom: -StyleSheet.hairlineWidth },
})

/** Una marca: 82,5 kg redondeado a 83 kg deja de ser la marca. */
const weight = (g: number, unit: Unit) => formatWeight(g, unit, locale)
/** Una suma de gramos: en lb sin redondear salía "12.480,01 lb" (mismo criterio que Historial). */
const bulk = (g: number, unit: Unit) => formatWeight(g, unit, locale, { maxFractionDigits: 0 })

const dayFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })

/**
 * G19: el gráfico que se está viendo, en un PNG. No bloquea nada — se dispara y sigue; si el
 * dispositivo no puede compartir (o Skia no da superficie), el aviso va al toast.
 */
function shareExerciseChart(data: ChartPoint[], name: string, unit: Unit): void {
  shareChart({
    context: { label: t('progress.maxWeight'), values: data.map((p) => p.maxWeightG) },
    footer: t('share.footer'),
    format: (g) => formatWeight(g, unit, locale, { withUnit: false }),
    from: dayFormat.format(new Date(data[0].date)),
    main: { label: t('progress.e1rm'), values: data.map((p) => p.e1rmG) },
    title: name,
    to: dayFormat.format(new Date(data[data.length - 1].date)),
    unit,
  }).catch(() => toast.show({ text: t('share.unavailable') }))
}

function days(n: number): string {
  return plural(n, t('progress.days.one', { n }), t('progress.days.other', { n }))
}

/** G11. Con 0 no se dibuja nada: "sin cambios" no merece una línea. */
function delta(diff: number, text: string): { text: string; sign: 1 | 0 | -1 } | undefined {
  return diff === 0 ? undefined : { sign: diff > 0 ? 1 : -1, text }
}

/**
 * La base de comparación, en cada tile con delta: cuatro números firmados sin decir contra qué son
 * cuatro números sueltos, y el subtítulo de la sección no viaja con el foco del rotor.
 */
function statLabel(label: string, value: string, diff: number, text: string): string {
  return diff === 0
    ? `${label}: ${value}`
    : `${label}: ${value}, ${diff > 0 ? '+' : '−'}${text} ${t('progress.lastWeek')}`
}

function useStats() {
  return useQuery(() => {
    const now = Date.now()
    const to = now + 1
    const first = addDays(startOfWeek(now), -7 * (WEEKS - 1))
    const week = thisAndLastWeek(now)

    // `trainingDays` solo devuelve los días con algo: la grilla se arma acá y los huecos son ceros.
    const byDay = new Map(trainingDays(first, to).map((d) => [d.day, d.sets]))
    const grid = Array.from({ length: WEEKS * 7 }, (_, i) => {
      const day = addDays(first, i)
      return { day, sets: byDay.get(day) ?? 0 }
    })

    const last7 = addDays(startOfDay(now), -6)
    return {
      balance: pushPullBalance(last7, to),
      current: week.current,
      grid,
      // Con una sola sesión no hay ni tendencia ni comparación: la pantalla todavía no dice nada.
      hasData: listSessions({ limit: 2 }).length >= 2,
      load: recentMuscleLoad(now),
      // Ordenado por series, que es lo que dibuja la barra: la lista viene por volumen y las
      // barras salían desordenadas, que se lee como un gráfico roto.
      muscles: volumeByMuscle(last7, to)
        .sort((a, b) => b.sets - a.sets || b.volumeG - a.volumeG)
        .slice(0, MUSCLE_ROWS),
      // Fuera lo que se entrenó hoy; "nunca" se queda, que también es información.
      neglected: neglectedMuscles(now)
        .filter((m) => m.daysSince !== 0)
        .slice(0, NEGLECTED_ROWS),
      previous: week.previous,
      streak: streakWeeks(now),
      tonnageG: totalTonnageG(),
    }
  }, TABLES)
}

export default function ProgressScreen() {
  const unit = useQuery(() => getSettings().unit, ['settings'])
  const stats = useStats()
  // La forma de las 12 semanas para la sparkline: `weekSummary` ya recorta la semana en curso a hoy.
  const weekly = useQuery(() => {
    const now = Date.now()
    const first = addDays(startOfWeek(now), -7 * (WEEKS - 1))
    return Array.from({ length: WEEKS }, (_, i) => weekSummary(addDays(first, i * 7), now).volumeG)
  }, TABLES)
  const bodyweight = useQuery(() => latest('bodyweight'), ['body_metric'])
  // Recientes primero y después los favoritos que no estén: un ejercicio que no tocás hace dos
  // meses es justo el que querés mirar acá, y por recientes no aparece nunca.
  const pickable = useQuery(() => {
    const recents = recentExercises(RECENTS)
    const seen = new Set(recents.map((e) => e.id))
    return [
      ...recents,
      ...listExercises({ favoritesOnly: true, locale }).filter((e) => !seen.has(e.id)),
    ]
  }, TABLES)

  const [picked, setPicked] = useState<number | null>(null)
  const selected = pickable.find((e) => e.id === picked) ?? pickable[0] ?? null

  const series = useQuery(
    () => (selected ? exerciseSeries(selected.id, SERIES_SESSIONS) : []),
    SERIES_TABLES,
    [selected?.id],
  )
  const bests = useQuery(
    () => (selected ? currentBests(selected.id) : null),
    ['personal_record'],
    [selected?.id],
  )
  // Fuera los músculos sin techo (`full_body` es 0/0/0: no es un músculo) y los que no entrenaste
  // y encima no piden mínimo — una fila en cero de aductores no es un hueco, es la semana normal.
  const volume = useQuery(() => {
    const lm = landmarks()
    return weeklyHardSets(startOfWeek(Date.now()))
      .filter((m) => lm[m.muscle].mrv > 0 && (m.sets > 0 || lm[m.muscle].mev > 0))
      .map((m) => ({ landmark: lm[m.muscle], muscle: m.muscle, sets: m.sets }))
  }, VOLUME_TABLES)

  // Una sola cascada, al montar: los gráficos nunca se re-animan al refrescarse (§12.6).
  const enter = useStagger()

  if (!stats.hasData) {
    return (
      <View style={styles.screen}>
        <EmptyState
          description={t('progress.empty.description')}
          md="trending_up"
          sf="chart.line.uptrend.xyaxis"
          title={t('progress.empty.title')}
        />
      </View>
    )
  }

  const { current, previous } = stats
  const avg = (w: { durationMs: number; sessions: number }) =>
    w.sessions > 0 ? w.durationMs / w.sessions : 0
  const trained = stats.grid.filter((d) => d.sets > 0).length
  // 'Series' es la etiqueta de una card; en medio de una frase va en minúscula ("12 series").
  const setsWord = t('progress.sets').toLocaleLowerCase(locale)
  const maxSets = Math.max(...stats.muscles.map((m) => m.sets), 1)
  // El mapa es una sola parada del rotor: sin este resumen, un canvas de siluetas no dice nada.
  // Sin series en la ventana no hay "lo más cargado" — el cuerpo gris entero es el dato.
  const top = topLoaded(stats.load)
  const mapLabel =
    top.length === 0
      ? t('muscleMap.a11yEmpty')
      : t('muscleMap.a11yTop', { muscles: top.map((m) => t(`muscle.${m}`)).join(', ') })

  const sessionsDiff = current.sessions - previous.sessions
  const setsDiff = current.sets - previous.sets
  const volumeDiff = current.volumeG - previous.volumeG
  const durationDiff = avg(current) - avg(previous)
  const volumeText = bulk(current.volumeG, unit)
  const volumeLabel = statLabel(
    t('progress.volume'),
    volumeText,
    volumeDiff,
    bulk(Math.abs(volumeDiff), unit),
  )
  // "Empuje / tracción: 12 / 9" no se puede leer en voz alta: la barra del título y la del valor
  // suenan igual (o se caen), y no queda forma de saber cuál número es cuál. Cada mitad tiene su
  // propia key, así que la traducción decide cómo se dice sin depender de dónde cae la barra.
  const balance = stats.balance.push + stats.balance.pull
  const balanceLabel = t('progress.pushPullRing', {
    pull: stats.balance.pull,
    push: stats.balance.push,
  })

  // Solo las sesiones con peso: un ejercicio de peso corporal daría una línea plana en cero.
  const points = series.filter((p) => p.e1rmG > 0)
  const chart =
    selected && points.length >= 2
      ? (() => {
          const last = points[points.length - 1]
          const diff = last.e1rmG - points[0].e1rmG
          const name = exerciseName(selected, locale)
          return {
            data: points,
            // El nombre también titula la imagen compartida (G19).
            name,
            label: t('progress.chartA11y', {
              delta: `${diff < 0 ? '−' : '+'}${weight(Math.abs(diff), unit)}`,
              last: weight(last.e1rmG, unit),
              n: points.length,
              name,
            }),
          }
        })()
      : null

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <Animated.View entering={enter(0)} style={styles.section}>
          <SectionHeader subtitle={t('progress.lastWeek')} title={t('progress.thisWeek')} />
          <Bento.Row>
            <Tile
              accessibilityLabel={plural(
                stats.streak,
                t('progress.streak.one', { n: stats.streak }),
                t('progress.streak.other', { n: stats.streak }),
              )}
              title={t('train.streak')}
              unit={plural(stats.streak, t('progress.weeks.one'), t('progress.weeks.other'))}
              value={String(stats.streak)}
            />
            <Tile
              accessibilityLabel={statLabel(
                t('progress.sessions'),
                String(current.sessions),
                sessionsDiff,
                String(Math.abs(sessionsDiff)),
              )}
              delta={delta(sessionsDiff, String(Math.abs(sessionsDiff)))}
              title={t('progress.sessions')}
              value={String(current.sessions)}
            />
          </Bento.Row>
        </Animated.View>

        <Tile
          accessibilityLabel={volumeLabel}
          entering={enter(1)}
          height="md"
          span={2}
          title={t('progress.volume')}
        >
          {(size) => (
            <View style={styles.volume}>
              <BigNumber role="displaySmall" value={volumeText} />
              {/* La forma de las 12 semanas; el número exacto es el de arriba. */}
              <Sparkline
                fill
                height={SPARK_H}
                label={volumeLabel}
                values={weekly}
                width={size.width}
              />
            </View>
          )}
        </Tile>

        <Animated.View entering={enter(2)}>
          <Bento.Row>
            <Tile
              accessibilityLabel={statLabel(
                t('progress.sets'),
                String(current.sets),
                setsDiff,
                String(Math.abs(setsDiff)),
              )}
              delta={delta(setsDiff, String(Math.abs(setsDiff)))}
              title={t('progress.sets')}
              value={String(current.sets)}
            />
            <Tile
              accessibilityLabel={statLabel(
                t('progress.avgDuration'),
                formatDuration(avg(current)),
                durationDiff,
                formatDuration(Math.abs(durationDiff)),
              )}
              delta={delta(durationDiff, formatDuration(Math.abs(durationDiff)))}
              title={t('progress.avgDuration')}
              value={formatDuration(avg(current))}
            />
          </Bento.Row>
        </Animated.View>

        <Tile
          accessibilityLabel={t('progress.consistencyA11y', { days: trained })}
          entering={enter(3)}
          span={2}
          title={t('progress.consistency')}
        >
          {() => (
            <Heatmap days={stats.grid} label={t('progress.consistencyA11y', { days: trained })} />
          )}
        </Tile>

        {volume.length > 0 ? (
          <Animated.View entering={enter(4)} style={[styles.section, styles.top]}>
            <SectionHeader subtitle={t('landmarks.subtitle')} title={t('landmarks.title')} />
            <VolumeLandmarks rows={volume} />
          </Animated.View>
        ) : null}

        {selected ? (
          <>
            <Animated.View entering={enter(5)} style={[styles.section, styles.top]}>
              {/* Compartir vive acá y no en el gráfico: adentro de un `Tile` (un solo elemento
                  accesible, con los hijos ocultos) VoiceOver no alcanzaría el botón. */}
              <SectionHeader
                action={
                  chart
                    ? {
                        onPress: () => {
                          haptic('sheetOpen')
                          shareExerciseChart(chart.data, chart.name, unit)
                        },
                        title: t('share.chart'),
                      }
                    : undefined
                }
                title={t('progress.exercise')}
              />
              <ScrollView
                contentContainerStyle={styles.chips}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.bleed}
              >
                {pickable.map((e) => (
                  <Chip
                    key={e.id}
                    label={exerciseName(e, locale)}
                    onPress={() => setPicked(e.id)}
                    selected={e.id === selected.id}
                  />
                ))}
              </ScrollView>
            </Animated.View>

            <Tile
              accessibilityLabel={
                chart
                  ? chart.label
                  : `${exerciseName(selected, locale)}: ${t('progress.exerciseEmpty')}`
              }
              entering={enter(6)}
              height={chart ? 'lg' : 'sm'}
              span={2}
              title={exerciseName(selected, locale)}
            >
              {() =>
                chart ? (
                  <ExerciseChart data={chart.data} label={chart.label} unit={unit} />
                ) : (
                  <Text color="secondary">{t('progress.exerciseEmpty')}</Text>
                )
              }
            </Tile>

            {bests ? (
              <Animated.View entering={enter(7)} style={styles.section}>
                <SectionHeader title={t('progress.bests')} />
                <Bento.Row>
                  <Tile
                    title={t('pr.kind.weight')}
                    value={bests.weightG === null ? EMPTY : weight(bests.weightG, unit)}
                  />
                  <Tile
                    title={t('pr.kind.e1rm')}
                    value={bests.e1rmG === null ? EMPTY : weight(bests.e1rmG, unit)}
                  />
                  <Tile
                    title={t('pr.kind.volume')}
                    value={bests.volumeG === null ? EMPTY : bulk(bests.volumeG, unit)}
                  />
                </Bento.Row>
              </Animated.View>
            ) : null}
          </>
        ) : null}

        <Tile
          accessibilityLabel={mapLabel}
          entering={enter(8)}
          height="lg"
          span={2}
          title={t('muscleMap.title')}
        >
          {() => <MuscleMap label={mapLabel} load={stats.load} />}
        </Tile>

        <Animated.View entering={enter(9)}>
          <Bento.Row>
            <Tile accessibilityLabel={balanceLabel} title={t('progress.pushPull')}>
              {() => (
                <View style={styles.center}>
                  <Ring
                    label={balanceLabel}
                    progress={balance > 0 ? stats.balance.push / balance : 0}
                    size={RING}
                  >
                    <Text role="label" tabular>
                      {`${stats.balance.push} / ${stats.balance.pull}`}
                    </Text>
                  </Ring>
                </View>
              )}
            </Tile>
            <Tile title={t('progress.tonnage')} value={bulk(stats.tonnageG, unit)} />
          </Bento.Row>
        </Animated.View>

        {stats.muscles.length > 0 ? (
          <Animated.View entering={enter(10)} style={[styles.section, styles.top]}>
            <SectionHeader title={t('progress.muscles')} />
            <Card style={styles.card} variant="raised">
              {stats.muscles.map((m) => {
                const name = t(`muscle.${m.muscle}`)
                const vol = bulk(m.volumeG, unit)
                return (
                  <View
                    accessible
                    accessibilityLabel={`${name}: ${m.sets} ${setsWord}, ${vol}`}
                    key={m.muscle}
                    style={styles.bar}
                  >
                    <View style={styles.row}>
                      <Text numberOfLines={1} role="callout" style={styles.grow}>
                        {name}
                      </Text>
                      <Text color="secondary" role="footnote" tabular>
                        {m.sets}
                      </Text>
                      {/* El volumen es el otro lado de G02/G03; va en terciario para que la barra y
                          el conteo de series sigan siendo lo que se lee primero. */}
                      <Text color="tertiary" role="footnote" tabular>
                        {vol}
                      </Text>
                    </View>
                    {/* Decorativa: la fila ya se anuncia con las series y el volumen en palabras. */}
                    <ProgressBar
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                      progress={m.sets / maxSets}
                      roundedEnd
                    />
                  </View>
                )
              })}
            </Card>
          </Animated.View>
        ) : null}

        {stats.neglected.length > 0 ? (
          <Animated.View entering={enter(11)} style={[styles.section, styles.top]}>
            <SectionHeader title={t('progress.neglected')} />
            <View style={styles.group}>
              {stats.neglected.map((m) => {
                const name = t(`muscle.${m.muscle}`)
                const since = m.daysSince === null ? t('progress.never') : days(m.daysSince)
                return (
                  <ListRow
                    key={m.muscle}
                    label={`${name}, ${t('progress.neglected')} ${since}`}
                    title={name}
                    trailing={
                      <Text color="secondary" tabular>
                        {since}
                      </Text>
                    }
                  />
                )
              })}
            </View>
          </Animated.View>
        ) : null}

        {/* I01. La puerta a Medidas vive acá y no en su propio tab: se carga cada tanto y lo que
            se mira seguido es el peso corporal, que ya es un número de esta pantalla. */}
        <Animated.View entering={enter(12)} style={[styles.group, styles.top]}>
          <ListRow
            chevron
            label={`${t('body.title')}, ${bodyweight ? weight(bodyweight.value, unit) : t('body.empty')}`}
            onPress={() => router.push('/body')}
            subtitle={bodyweight ? undefined : t('body.empty')}
            title={t('body.title')}
            trailing={
              bodyweight ? (
                <Text color="secondary" tabular>
                  {weight(bodyweight.value, unit)}
                </Text>
              ) : null
            }
          />
        </Animated.View>
      </ScrollView>
    </View>
  )
}
