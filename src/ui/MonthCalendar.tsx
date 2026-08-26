import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native'
import { locale, plural, t } from '@/i18n'
import { haptic } from './haptics'
import PressableScale from './PressableScale'
import Text from './Text'
import { colors, MIN_TARGET, spacing } from './tokens'

/** Día 1 del mes de `at`, medianoche local. */
export function startOfMonth(at: number): number {
  const d = new Date(at)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Siempre desde el día 1: `setMonth` sobre un 31 desborda (31 de marzo − 1 mes = 3 de marzo). */
export function addMonths(at: number, months: number): number {
  const d = new Date(startOfMonth(at))
  d.setMonth(d.getMonth() + months)
  return d.getTime()
}

const monthFormat = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
const dayFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: 'short' })

// El 1-1-2024 fue lunes: la semana arranca lunes, igual que las semanas ISO de stats.ts, y solo los
// nombres salen del locale. Si acá empezara domingo, el calendario y el resto de análisis contarían
// semanas distintas.
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => weekdayFormat.format(new Date(2024, 0, 1 + i)))

const CIRCLE = 32
const DOT = 5
const CELL = '14.2857%'

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1 },
  arrow: {
    minWidth: MIN_TARGET,
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  week: { flexDirection: 'row', paddingTop: spacing[2] },
  weekday: { width: CELL, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL },
  day: { alignItems: 'center', minHeight: MIN_TARGET, paddingVertical: spacing[1] },
  // minWidth/minHeight y no width/height: con Dynamic Type grande el número crece y adentro de una
  // caja fija chocaría con el punto de abajo (mismo criterio que el chip de ui/Chip).
  circle: {
    minWidth: CIRCLE,
    minHeight: CIRCLE,
    borderRadius: CIRCLE / 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  today: { borderWidth: 1.5, borderColor: colors.tint },
  selected: { backgroundColor: colors.tint },
  onTint: { color: colors.onTint },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    marginTop: 2,
    backgroundColor: colors.tint,
  },
  // Ocupa el lugar igual: sin esto las filas sin entrenamientos suben 7 pt y la grilla queda dentada.
  noDot: { opacity: 0 },
})

function todayMs(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function Arrow({
  label,
  md,
  onPress,
  sf,
}: {
  label: string
  md: string
  onPress: () => void
  sf: string
}) {
  return (
    <PressableScale accessibilityLabel={label} onPress={onPress} style={styles.arrow}>
      <SymbolView
        fallback={
          <Text color="tint" role="headline">
            {sf === 'chevron.left' ? '‹' : '›'}
          </Text>
        }
        name={{ ios: sf as SFSymbol, android: md as AndroidSymbol }}
        size={17}
        tintColor={colors.tint}
      />
    </PressableScale>
  )
}

function Day({
  day,
  isToday,
  onPress,
  selected,
  sessions,
}: {
  day: number
  isToday: boolean
  onPress: (day: number) => void
  selected: boolean
  sessions: number
}) {
  const date = dayFormat.format(day)
  // Un día vacío se anuncia solo con la fecha: "0 entrenamientos" en 20 celdas seguidas es ruido.
  // "Hoy" adelante porque es la única orientación que da la grilla, y en pantalla es solo color.
  const label = [
    isToday ? t('history.today') : null,
    sessions === 0
      ? date
      : plural(
          sessions,
          t('history.calendarDay.one', { date, n: sessions }),
          t('history.calendarDay.other', { date, n: sessions }),
        ),
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <View style={styles.cell}>
      <PressableScale
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        onPress={() => {
          haptic('selection')
          onPress(day)
        }}
        style={styles.day}
      >
        <View style={[styles.circle, isToday && styles.today, selected && styles.selected]}>
          <Text
            color={isToday && !selected ? 'tint' : 'primary'}
            style={selected ? styles.onTint : undefined}
            tabular
          >
            {new Date(day).getDate()}
          </Text>
        </View>
        <View style={[styles.dot, sessions === 0 && styles.noDot]} />
      </PressableScale>
    </View>
  )
}

type Props = {
  /** Mes visible (medianoche del día 1). El estado vive afuera porque es la ventana de la consulta. */
  month: number
  onMonthChange: (month: number) => void
  /** Salida de `trainingDays` acotada al mes: solo trae los días que tuvieron algo. */
  days: Array<{ day: number; sessions: number }>
  selected: number | null
  onSelect: (day: number) => void
}

/**
 * D09. Cambiar de mes es instantáneo a propósito (§7.5): una grilla entera animándose en cada tap de
 * la flecha es exactamente el tipo de movimiento frecuente que el plan rechaza.
 *
 * ponytail: sin gesto de swipe entre meses ni scroll infinito. Techo: solo se navega con las
 * flechas, de a un mes. Upgrade: un pager horizontal con tres meses montados.
 */
export default function MonthCalendar({ month, onMonthChange, days, selected, onSelect }: Props) {
  // Cambiar de mes deja el foco en la flecha: sin esto no hay forma de saber a dónde se llegó.
  // `accessibilityLiveRegion` es de Android; en iOS el anuncio se empuja a mano (ui/RestTimer).
  const goTo = (next: number) => {
    onMonthChange(next)
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(monthFormat.format(next))
  }
  const first = new Date(month)
  const year = first.getFullYear()
  const index = first.getMonth()
  // getDay(): 0 = domingo. Cuántas celdas vacías van antes del 1 con la semana arrancando en lunes.
  const lead = (first.getDay() + 6) % 7
  const total = new Date(year, index + 1, 0).getDate()
  const today = todayMs()
  const sessions = new Map(days.map((d) => [d.day, d.sessions]))
  // Las celdas de relleno son los días reales del mes anterior: sirven de key sin usar el índice.
  const cells = Array.from({ length: lead + total }, (_, i) =>
    new Date(year, index, i + 1 - lead).getTime(),
  )

  return (
    <View>
      <View style={styles.head}>
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="header"
          role="headline"
          style={styles.title}
        >
          {monthFormat.format(month)}
        </Text>
        <Arrow
          label={t('history.prevMonth')}
          md="chevron_left"
          onPress={() => goTo(addMonths(month, -1))}
          sf="chevron.left"
        />
        <Arrow
          label={t('history.nextMonth')}
          md="chevron_right"
          onPress={() => goTo(addMonths(month, 1))}
          sf="chevron.right"
        />
      </View>
      {/* Decorativa: cada día ya se anuncia con su fecha completa, leer "lun mar mié…" es ruido. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.week}>
          {WEEKDAYS.map((w) => (
            <Text color="tertiary" key={w} role="caption" style={styles.weekday}>
              {w}
            </Text>
          ))}
        </View>
      </View>
      <View style={styles.grid}>
        {cells.map((day, i) =>
          i < lead ? (
            <View key={day} style={styles.cell} />
          ) : (
            <Day
              day={day}
              isToday={day === today}
              key={day}
              onPress={onSelect}
              selected={day === selected}
              sessions={sessions.get(day) ?? 0}
            />
          ),
        )}
      </View>
    </View>
  )
}
