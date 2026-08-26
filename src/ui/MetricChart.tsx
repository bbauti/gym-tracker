import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { CartesianChart, Line } from 'victory-native'
import type { BodyKind } from '@/db/queries/body'
import { locale, t } from '@/i18n'
import { formatWeight, gToUnit, parseWeight, type Unit } from '@/lib/units'
import { useChartTheme } from './chartTheme'
import Text from './Text'
import { spacing } from './tokens'

/** Mismo motivo que en `ExerciseChart`: sin esto victory dibuja su grilla negra por default. */
const NO_GRID = [{ lineWidth: 0 }]

const HEIGHT = 180
const GUTTER = 56
const TICKS = 3
const MAX_TICKS = 4
const TICK_BOX = 40
const MM_PER_CM = 10

const dayFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
const intl = locale === 'es' ? 'es-ES' : 'en-US'
const cmFormat = new Intl.NumberFormat(intl, { maximumFractionDigits: 1 })

/** La unidad de una medida: el peso corporal sigue ajustes, los largos son siempre cm. */
export function metricUnit(kind: BodyKind, unit: Unit): string {
  return kind === 'bodyweight' ? unit : t('body.cm')
}

/** De lo guardado (g o mm) a lo que se dibuja y se lee. */
export function toDisplay(kind: BodyKind, value: number, unit: Unit): number {
  return kind === 'bodyweight' ? gToUnit(value, unit) : value / MM_PER_CM
}

export function formatMetric(kind: BodyKind, value: number, unit: Unit): string {
  if (kind === 'bodyweight') return formatWeight(value, unit, locale)
  return `${cmFormat.format(value / MM_PER_CM)} ${t('body.cm')}`
}

/** Lo tipeado a lo guardado: gramos para el peso, milímetros para un largo. `null` si no es número. */
export function parseMetric(kind: BodyKind, text: string, unit: Unit): number | null {
  if (kind === 'bodyweight') return parseWeight(text, unit)
  const cleaned = text.trim().replace(',', '.')
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return null
  const cm = Number(cleaned)
  return Number.isFinite(cm) ? Math.round(cm * MM_PER_CM) : null
}

function tickFormat(step: number): Intl.NumberFormat {
  const digits = step > 0 ? Math.min(20, Math.max(0, -Math.floor(Math.log10(step)))) : 0
  return new Intl.NumberFormat(intl, { maximumFractionDigits: digits })
}

const styles = StyleSheet.create({
  // La unidad va arriba de la columna de ticks, una sola vez (mismo criterio que `ExerciseChart`).
  head: { flexDirection: 'row', paddingBottom: spacing[2] },
  unit: { width: GUTTER, paddingRight: spacing[2], alignItems: 'flex-end' },
  chart: { flexDirection: 'row', height: HEIGHT },
  gutter: { width: GUTTER },
  tick: { position: 'absolute', right: spacing[2], height: TICK_BOX, justifyContent: 'center' },
  tickLabel: { textAlign: 'right' },
  plot: { flex: 1 },
  dates: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: GUTTER,
    paddingTop: spacing[1],
  },
})

/** d3-scale viaja adentro de victory-native y sin tipos; esto es todo lo que se le pide. */
type LinearScale = ((value: number) => number) & { ticks: (count: number) => number[] }

export type MetricPoint = { date: number; value: number }

type Props = {
  /** De la más vieja a la más nueva, ya convertida a la unidad que se muestra. */
  data: MetricPoint[]
  unit: string
  /** El gráfico es UN elemento accesible: acá va el resumen en palabras. */
  label: string
}

/**
 * I02. Una medida en el tiempo: una sola serie, sin grilla, sin marco y sin `animate` — se refresca
 * cuando cambian los datos y eso no es una transición que valga la pena (§7.5).
 *
 * El eje X es la fecha real (los extremos rotulados), no el número de medida: pesarse dos días
 * seguidos y después de un mes no puede dibujar el mismo hueco.
 */
export default function MetricChart({ data, unit, label }: Props) {
  const theme = useChartTheme()
  const [ticks, setTicks] = useState<Array<{ v: number; y: number; text: string }>>([])

  return (
    <View accessible accessibilityLabel={label}>
      <View style={styles.head}>
        <View style={styles.unit}>
          <Text color="tertiary" role="caption">
            {unit}
          </Text>
        </View>
      </View>

      <View style={styles.chart}>
        <View style={styles.gutter}>
          {ticks.map(({ v, y, text }) => (
            // Acotado al alto del gráfico: el rango de la escala es exactamente [0, HEIGHT] y un
            // tick del borde ponía la caja afuera, recortada arriba o encima de las fechas.
            <View
              key={v}
              style={[
                styles.tick,
                { top: Math.min(Math.max(0, y - TICK_BOX / 2), HEIGHT - TICK_BOX) },
              ]}
            >
              <Text
                color="tertiary"
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
                role="caption"
                style={styles.tickLabel}
                tabular
              >
                {text}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.plot}>
          <CartesianChart
            data={data}
            // Sin esto el primer y el último punto caen sobre el borde del canvas y el trazo de
            // 2 px con punta redonda se corta al medio.
            domainPadding={{ bottom: 12, left: 4, right: 4, top: 12 }}
            onScaleChange={(_x: LinearScale, y: LinearScale) => {
              // Los ticks salen de la escala real y se saltean de a un paso CONSTANTE: agarrar
              // primero/medio/último de una lista par dibuja dos saltos distintos igual de lejos.
              const values = y.ticks(TICKS)
              const stride = Math.max(1, Math.ceil(values.length / MAX_TICKS))
              const picked = values.filter((_, i) => i % stride === 0)
              const format = tickFormat(picked.length > 1 ? Math.abs(picked[0] - picked[1]) : 0)
              setTicks(picked.map((v) => ({ text: format.format(v), v, y: y(v) })))
            }}
            xKey="date"
            yAxis={NO_GRID}
            yKeys={['value']}
          >
            {({ points }) => (
              <Line
                color={theme.tint}
                points={points.value}
                strokeCap="round"
                strokeJoin="round"
                strokeWidth={2}
              />
            )}
          </CartesianChart>
        </View>
      </View>

      <View style={styles.dates}>
        <Text color="tertiary" role="caption">
          {dayFormat.format(new Date(data[0].date))}
        </Text>
        <Text color="tertiary" role="caption">
          {dayFormat.format(new Date(data[data.length - 1].date))}
        </Text>
      </View>
    </View>
  )
}
