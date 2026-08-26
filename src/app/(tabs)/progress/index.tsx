import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { exerciseName, listExercises, recentExercises } from '@/db/queries/exercises'
import { listSessions } from '@/db/queries/history'
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
} from '@/db/queries/stats'
import { useQuery } from '@/db/useQuery'
import { locale, plural, t } from '@/i18n'
import { formatDuration, formatWeight, type Unit } from '@/lib/units'
import Card from '@/ui/Card'
import Chip from '@/ui/Chip'
import EmptyState from '@/ui/EmptyState'
import ExerciseChart from '@/ui/ExerciseChart'
import Heatmap from '@/ui/Heatmap'
import ListRow from '@/ui/ListRow'
import Text from '@/ui/Text'
import { colors, radius, spacing } from '@/ui/tokens'

/** Las tablas reales: `useQuery` escucha el hook de sqlite, que no ve la vista `v_work_set`. */
const TABLES = ['session', 'set_entry', 'session_exercise', 'exercise'] as const
/** `exerciseSeries` calcula el 1RM con la fórmula de ajustes: si cambia, la línea tiene que rehacerse. */
const SERIES_TABLES = [...TABLES, 'settings'] as const
const WEEKS = 12
const MUSCLE_ROWS = 8
const NEGLECTED_ROWS = 5
const RECENTS = 6
const SERIES_SESSIONS = 30
const EMPTY = '—'

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { padding: spacing[4], gap: spacing[5] },
  section: { gap: spacing[2] },
  sectionHead: { paddingHorizontal: spacing[2] },
  sectionTitle: { textTransform: 'uppercase', letterSpacing: 0.4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  stat: { flexGrow: 1, flexBasis: '46%', gap: spacing[1] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[2] },
  card: { gap: spacing[3] },
  bar: { gap: spacing[1] },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.fill, overflow: 'hidden' },
  // Punta redondeada del lado del dato, cuadrada contra la línea de base.
  fill: {
    height: 6,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: colors.tint,
  },
  divider: {
    gap: spacing[2],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  // El marginBottom se come la última hairline de ListRow, que adentro del card se ve suelta.
  group: { borderRadius: radius.md, overflow: 'hidden', marginBottom: -StyleSheet.hairlineWidth },
})

/** Una marca: 82,5 kg redondeado a 83 kg deja de ser la marca. */
const weight = (g: number, unit: Unit) => formatWeight(g, unit, locale)
/** Una suma de gramos: en lb sin redondear salía "12.480,01 lb" (mismo criterio que Historial). */
const bulk = (g: number, unit: Unit) => formatWeight(g, unit, locale, { maxFractionDigits: 0 })

function days(n: number): string {
  return plural(n, t('progress.days.one', { n }), t('progress.days.other', { n }))
}

/** `header` como en el resto de la app: Progreso es el scroll más largo y el rotor tiene que pararse. */
function SectionTitle({ children, subtitle }: { children: string; subtitle?: string }) {
  return (
    <View style={styles.sectionHead}>
      <Text
        accessibilityRole="header"
        color="secondary"
        role="footnote"
        style={styles.sectionTitle}
      >
        {children}
      </Text>
      {/* La base de comparación, una sola vez: cuatro deltas firmados sin decir contra qué son
          cuatro números sueltos, y hasta ahora eso solo lo sabía VoiceOver. */}
      {subtitle ? (
        <Text color="tertiary" role="caption">
          {subtitle}
        </Text>
      ) : null}
    </View>
  )
}

/**
 * G11. El delta va firmado y en terciario: la comparación es contexto, el número de esta semana es
 * el dato. Con 0 no se dibuja nada — "sin cambios" no merece una línea.
 */
function Stat({
  label,
  value,
  delta,
  deltaText,
}: {
  label: string
  value: string
  delta: number
  deltaText: string
}) {
  const a11y =
    delta === 0
      ? `${label}: ${value}`
      : `${label}: ${value}, ${delta > 0 ? '+' : '−'}${deltaText} ${t('progress.lastWeek')}`
  return (
    <Card style={styles.stat}>
      <View accessible accessibilityLabel={a11y}>
        <Text color="secondary" role="footnote">
          {label}
        </Text>
        {/* Figuras proporcionales, no tabulares: un número grande y solo, no una columna. */}
        <Text role="title">{value}</Text>
        {delta === 0 ? null : (
          <Text color="tertiary" role="caption" tabular>
            {`${delta > 0 ? '▲' : '▼'} ${deltaText}`}
          </Text>
        )}
      </View>
    </Card>
  )
}

function BestRow({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.row}>
      <Text color="secondary" style={styles.grow}>
        {label}
      </Text>
      <Text tabular>{value}</Text>
    </View>
  )
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
  // "Empuje / tracción: 12 / 9" no se puede leer en voz alta: la barra del título y la del valor
  // suenan igual (o se caen), y no queda forma de saber cuál número es cuál. Cada mitad tiene su
  // propia key, así que la traducción decide cómo se dice sin depender de dónde cae la barra.
  const balanceLabel = `${t('progress.push')} ${stats.balance.push}, ${t('progress.pull')} ${stats.balance.pull}`
  const maxSets = Math.max(...stats.muscles.map((m) => m.sets), 1)

  // Solo las sesiones con peso: un ejercicio de peso corporal daría una línea plana en cero.
  const points = series.filter((p) => p.e1rmG > 0)
  const chart =
    selected && points.length >= 2
      ? (() => {
          const last = points[points.length - 1]
          const diff = last.e1rmG - points[0].e1rmG
          return {
            data: points,
            label: t('progress.chartA11y', {
              delta: `${diff < 0 ? '−' : '+'}${weight(Math.abs(diff), unit)}`,
              last: weight(last.e1rmG, unit),
              n: points.length,
              name: exerciseName(selected, locale),
            }),
          }
        })()
      : null

  return (
    // Un solo FadeIn, en el contenedor y al montar: los gráficos nunca se re-animan al refrescarse.
    <Animated.View entering={FadeIn.duration(200)} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.section}>
          <SectionTitle subtitle={t('progress.lastWeek')}>{t('progress.thisWeek')}</SectionTitle>
          <View style={styles.grid}>
            <Stat
              delta={current.sessions - previous.sessions}
              deltaText={String(Math.abs(current.sessions - previous.sessions))}
              label={t('progress.sessions')}
              value={String(current.sessions)}
            />
            <Stat
              delta={current.sets - previous.sets}
              deltaText={String(Math.abs(current.sets - previous.sets))}
              label={t('progress.sets')}
              value={String(current.sets)}
            />
            <Stat
              delta={current.volumeG - previous.volumeG}
              deltaText={bulk(Math.abs(current.volumeG - previous.volumeG), unit)}
              label={t('progress.volume')}
              value={bulk(current.volumeG, unit)}
            />
            <Stat
              delta={avg(current) - avg(previous)}
              deltaText={formatDuration(Math.abs(avg(current) - avg(previous)))}
              label={t('progress.avgDuration')}
              value={formatDuration(avg(current))}
            />
          </View>
          <Card style={styles.card}>
            {/* "0 semanas seguidas" es correcto y es la lectura más fría posible de la sección más
                cálida: el que vuelve después de un parate ve el tonelaje, que siempre suma. */}
            {stats.streak > 0 ? (
              <Text role="headline">
                {plural(
                  stats.streak,
                  t('progress.streak.one', { n: stats.streak }),
                  t('progress.streak.other', { n: stats.streak }),
                )}
              </Text>
            ) : null}
            <BestRow label={t('progress.tonnage')} value={bulk(stats.tonnageG, unit)} />
          </Card>
        </View>

        <View style={styles.section}>
          <SectionTitle>{t('progress.consistency')}</SectionTitle>
          <Card>
            <Heatmap days={stats.grid} label={t('progress.consistencyA11y', { days: trained })} />
          </Card>
        </View>

        {selected ? (
          <View style={styles.section}>
            <SectionTitle>{t('progress.exercise')}</SectionTitle>
            <ScrollView
              contentContainerStyle={styles.chips}
              horizontal
              showsHorizontalScrollIndicator={false}
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
            <Card style={styles.card}>
              {chart ? (
                <ExerciseChart data={chart.data} label={chart.label} unit={unit} />
              ) : (
                <Text color="secondary">{t('progress.exerciseEmpty')}</Text>
              )}
              {bests ? (
                <View style={styles.divider}>
                  <Text accessibilityRole="header" color="secondary" role="footnote">
                    {t('progress.bests')}
                  </Text>
                  <BestRow
                    label={t('pr.kind.weight')}
                    value={bests.weightG === null ? EMPTY : weight(bests.weightG, unit)}
                  />
                  <BestRow
                    label={t('pr.kind.e1rm')}
                    value={bests.e1rmG === null ? EMPTY : weight(bests.e1rmG, unit)}
                  />
                  <BestRow
                    label={t('pr.kind.volume')}
                    value={bests.volumeG === null ? EMPTY : bulk(bests.volumeG, unit)}
                  />
                </View>
              ) : null}
            </Card>
          </View>
        ) : null}

        {stats.muscles.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle>{t('progress.muscles')}</SectionTitle>
            <Card style={styles.card}>
              {stats.muscles.map((m) => {
                const name = t(`muscle.${m.muscle}`)
                const volume = bulk(m.volumeG, unit)
                return (
                  <View
                    accessible
                    accessibilityLabel={`${name}: ${m.sets} ${setsWord}, ${volume}`}
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
                        {volume}
                      </Text>
                    </View>
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${(m.sets / maxSets) * 100}%` }]} />
                    </View>
                  </View>
                )
              })}
              <View
                accessible
                accessibilityLabel={balanceLabel}
                style={[styles.row, styles.divider]}
              >
                <Text color="secondary" style={styles.grow}>
                  {t('progress.pushPull')}
                </Text>
                <Text tabular>{`${stats.balance.push} / ${stats.balance.pull}`}</Text>
              </View>
            </Card>
          </View>
        ) : null}

        {stats.neglected.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle>{t('progress.neglected')}</SectionTitle>
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
          </View>
        ) : null}
      </ScrollView>
    </Animated.View>
  )
}
