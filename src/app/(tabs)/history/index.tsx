import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list'
import { router } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { listSessions, type SessionSummary } from '@/db/queries/history'
import { getSettings } from '@/db/queries/settings'
import { useQuery } from '@/db/useQuery'
import { locale, plural, t } from '@/i18n'
import { formatDuration, formatWeight, type Unit } from '@/lib/units'
import EmptyState from '@/ui/EmptyState'
import ListRow from '@/ui/ListRow'
import Text from '@/ui/Text'
import { colors, spacing } from '@/ui/tokens'

const PAGE = 50

const dayFormat = new Intl.DateTimeFormat(locale, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})
// Sin año, "mié, 20 ago" de hace dos temporadas es indistinguible del de este mes.
const oldDayFormat = new Intl.DateTimeFormat(locale, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'session'; key: string; summary: SessionSummary }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  list: { backgroundColor: colors.groupedBackground },
  day: {
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[5],
    paddingBottom: spacing[2],
  },
})

function startOfDay(ts: number): Date {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d
}

/** Ayer se calcula con `setDate(-1)`, no restando 86.400.000 ms: los días de cambio de hora duran 23 o 25 h. */
function buildRows(list: SessionSummary[]): Row[] {
  const today = startOfDay(Date.now())
  const yesterday = startOfDay(Date.now())
  yesterday.setDate(yesterday.getDate() - 1)

  const rows: Row[] = []
  let currentDay = ''
  for (const summary of list) {
    const day = startOfDay(summary.session.startedAt)
    const key = String(day.getTime())
    if (key !== currentDay) {
      currentDay = key
      let label: string
      if (day.getTime() === today.getTime()) label = t('history.today')
      else if (day.getTime() === yesterday.getTime()) label = t('history.yesterday')
      else if (day.getFullYear() === today.getFullYear()) label = dayFormat.format(day)
      else label = oldDayFormat.format(day)
      rows.push({ kind: 'day', key: `d${key}`, label })
    }
    rows.push({ kind: 'session', key: String(summary.session.id), summary })
  }
  return rows
}

const keyExtractor = (row: Row) => row.key
// Cabeceras y filas reciclan por separado: sin esto FlashList reusa una celda de fecha como sesión.
const getItemType = (row: Row) => row.kind

const empty = (
  <EmptyState
    description={t('history.empty.description')}
    md="history"
    sf="clock.arrow.circlepath"
    title={t('history.empty.title')}
  />
)

function SessionRow({ summary, unit }: { summary: SessionSummary; unit: Unit }) {
  const { session, exerciseCount, setCount, volumeG, durationMs } = summary
  const title = session.name ?? t('session.untitled')
  // Una sesión de un ejercicio decía "1 ejercicios": el subtítulo se arma por partes contables.
  const subtitle = [
    plural(
      exerciseCount,
      t('history.exercises.one', { n: exerciseCount }),
      t('history.exercises.other', { n: exerciseCount }),
    ),
    plural(
      setCount,
      t('history.sets.one', { n: setCount }),
      t('history.sets.other', { n: setCount }),
    ),
    // El volumen es una suma de gramos: en lb sin redondear salía "480,01 lb".
    formatWeight(volumeG, unit, locale, { maxFractionDigits: 0 }),
  ].join(' · ')
  const duration = formatDuration(durationMs)
  return (
    <ListRow
      chevron
      // La fila es un solo elemento accesible: la duración se anuncia por el label, no sola.
      label={`${title}, ${subtitle}, ${t('history.duration')}: ${duration}`}
      onPress={() => router.push({ pathname: '/session/[id]', params: { id: session.id } })}
      subtitle={subtitle}
      title={title}
      trailing={
        <Text color="secondary" role="footnote" tabular>
          {duration}
        </Text>
      }
    />
  )
}

export default function HistoryScreen() {
  const [limit, setLimit] = useState(PAGE)
  const unit = useQuery(() => getSettings().unit, ['settings'])
  const page = useQuery(
    () => listSessions({ limit }),
    ['session', 'session_exercise', 'set_entry'],
    [limit],
  )
  const rows = buildRows(page)

  const renderItem = ({ item }: ListRenderItemInfo<Row>) =>
    item.kind === 'day' ? (
      <Text accessibilityRole="header" color="secondary" role="footnote" style={styles.day}>
        {item.label}
      </Text>
    ) : (
      <SessionRow summary={item.summary} unit={unit} />
    )

  if (page.length === 0) return <View style={styles.screen}>{empty}</View>

  // Sin layout animations: el historial solo crece por el final y animar filas mientras se
  // scrollea es exactamente lo que §7.5 rechaza.
  return (
    <FlashList
      contentInsetAdjustmentBehavior="automatic"
      data={rows}
      extraData={unit}
      getItemType={getItemType}
      keyExtractor={keyExtractor}
      // Sin esto el historial se queda en las 50 más nuevas para siempre.
      onEndReached={() => {
        if (page.length >= limit) setLimit(limit + PAGE)
      }}
      renderItem={renderItem}
      style={styles.list}
    />
  )
}
