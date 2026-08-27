import { Circle, LinearGradient, vec } from '@shopify/react-native-skia'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Area, CartesianChart, Line } from 'victory-native'
import { locale, t } from '@/i18n'
import { gToUnit, type Unit } from '@/lib/units'
import { useChartTheme } from './chartTheme'
import { haptic } from './haptics'
import IconButton from './IconButton'
import Text from './Text'
import { radius, spacing } from './tokens'

/**
 * Sin `yAxis` victory NO se queda sin eje: `buildChartAxis` cae en `[{ ...YAxisDefaults, yKeys }]`
 * y `CartesianChart` dibuja el eje igual, con su default `lineColor: 'hsla(0,0%,0%,0.25)'` — cinco
 * hairlines negras, invisibles en dark y de más en light. `lineWidth: 0` es la única forma de
 * apagarlas. El eje X sí depende de que le pases el prop, y por eso no aparece.
 */
const NO_GRID = [{ lineWidth: 0 }]

const HEIGHT = 180
/** Ancho de la columna de etiquetas del eje Y: entran 4 dígitos (lb) con Dynamic Type al tope. */
const GUTTER = 56
const TICKS = 3
/** Techo duro: más etiquetas que esto en 180 px se pisan entre sí. */
const MAX_TICKS = 4
const DOT = 8
const TICK_BOX = 40
/** Radio del punto que cierra la serie del tinte: apenas más ancho que el trazo de 2,5. */
const POINT = 3.5
// El relleno bajo la línea es el MISMO tinte con alfa (`#RRGGBBAA`, 9 chars, que el parser CSS de
// Skia entiende): no entra un color nuevo, solo el degradado que muere contra el eje (§12.4).
const FILL_TOP = '2E'
const FILL_BOTTOM = '00'

const dayFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })

/**
 * Los decimales salen del paso entre ticks, no fijos en 0: d3 no restringe los ticks a enteros y un
 * dominio angosto (20–21 kg, típico de mancuernas) daba `21 / 21 / 20` — dos alturas distintas con
 * el mismo número escrito.
 */
function tickFormat(step: number): Intl.NumberFormat {
  const digits = step > 0 ? Math.min(20, Math.max(0, -Math.floor(Math.log10(step)))) : 0
  return new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-US', {
    maximumFractionDigits: digits,
  })
}

const styles = StyleSheet.create({
  legend: { alignItems: 'center', flexDirection: 'row', paddingBottom: spacing[2] },
  keys: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing[4] },
  // El target de 44 pt lo pone `IconButton`; acá solo se devuelve la mitad del aire al layout (el
  // área de toque no se achica) para que la leyenda no se despegue del dibujo.
  share: { marginVertical: -spacing[2] },
  // La unidad va arriba de la columna de ticks: los números del eje quedan pelados y no hay que
  // repetir "kg" tres veces ni arriesgar que se corte con Dynamic Type grande.
  unit: { width: GUTTER, paddingRight: spacing[2], alignItems: 'flex-end' },
  key: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  dot: { width: DOT, height: DOT, borderRadius: radius.pill },
  chart: { flexDirection: 'row', height: HEIGHT },
  gutter: { width: GUTTER },
  // Caja de alto fijo centrada en el tick: la etiqueta queda alineada aunque Dynamic Type la crezca.
  tick: {
    position: 'absolute',
    right: spacing[2],
    height: TICK_BOX,
    justifyContent: 'center',
  },
  tickLabel: { textAlign: 'right' },
  plot: { flex: 1 },
  dates: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: GUTTER,
    paddingTop: spacing[1],
  },
})

export type ChartPoint = { date: number; e1rmG: number; maxWeightG: number }

/** d3-scale viaja adentro de victory-native y sin tipos; esto es todo lo que se le pide. */
type LinearScale = ((value: number) => number) & { ticks: (count: number) => number[] }

type Props = {
  /** De la sesión más vieja a la más nueva. */
  data: ChartPoint[]
  unit: Unit
  /** El gráfico es UN elemento accesible: acá va el resumen en palabras. */
  label: string
  /** G19. Sin esto no se dibuja el botón: no todos los gráficos se comparten. */
  onShare?: () => void
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.key}>
      {/* El punto lleva el color; el texto va con tokens de texto, nunca con el color de la serie. */}
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text color="secondary" role="caption">
        {label}
      </Text>
    </View>
  )
}

/**
 * G04: 1RM estimado por sesión, con el peso máximo de contexto.
 *
 * Es énfasis, no dos categorías: la serie que importa va en el tinte y la otra en gris. Las dos
 * miden lo mismo (peso), así que comparten eje — nunca un segundo eje Y.
 *
 * El eje X es la FECHA real, no el número de sesión: los extremos están rotulados con días, y con
 * el ordinal dos sesiones a tres meses de distancia dibujaban el mismo hueco que dos seguidas —
 * la pendiente decía una cosa y las etiquetas otra.
 *
 * Sin grilla (`NO_GRID`), sin marco y sin `animate`: `animate` volvería a dibujar la línea en cada
 * refresh, y el gráfico se refresca cuando cambian los datos, que no es una transición que valga la
 * pena (§7.5). Las etiquetas del eje Y son `Text` de RN y no de Skia: así siguen los tokens y el
 * Dynamic Type, y las posiciones salen de la escala real del gráfico, no de una copia que se
 * desalinea. La unidad va una sola vez, arriba de la columna.
 */
export default function ExerciseChart({ data, unit, label, onShare }: Props) {
  const theme = useChartTheme()
  const [ticks, setTicks] = useState<Array<{ v: number; y: number; text: string }>>([])

  const points = data.map((p) => ({
    date: p.date,
    e1rm: gToUnit(p.e1rmG, unit),
    top: gToUnit(p.maxWeightG, unit),
  }))

  return (
    <View>
      {/* La leyenda queda FUERA del bloque accesible porque el botón de compartir vive acá y adentro
          de un `accessible` VoiceOver no lo alcanza. Sus textos se ocultan a mano: sueltos daban tres
          paradas ("kg", "1RM est.", "Peso máx.") que sin las marcas no dicen nada, y el resumen del
          gráfico ya los cuenta. */}
      <View style={styles.legend}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.keys}
        >
          <View style={styles.unit}>
            <Text color="tertiary" role="caption">
              {unit}
            </Text>
          </View>
          <Key color={theme.tint} label={t('progress.e1rm')} />
          <Key color={theme.muted} label={t('progress.maxWeight')} />
        </View>
        {onShare ? (
          <View style={styles.share}>
            <IconButton
              fallback="↑"
              label={t('share.chart')}
              md="share"
              onPress={() => {
                haptic('sheetOpen')
                onShare()
              }}
              sf="square.and.arrow.up"
              tint="tint"
            />
          </View>
        ) : null}
      </View>

      {/* Dibujo y fechas son UN elemento accesible: el resumen en palabras es `label`. */}
      <View accessible accessibilityLabel={label}>
        <View style={styles.chart}>
          <View style={styles.gutter}>
            {ticks.map(({ v, y, text }) => (
              // Acotado al alto del gráfico: el rango de la escala es exactamente [0, HEIGHT]
              // (`domainPadding` corre el dominio, no el rango), así que un tick en el borde ponía la
              // caja 20 px afuera — recortada arriba, encima de la fila de fechas abajo.
              <View
                key={v}
                style={[
                  styles.tick,
                  { top: Math.min(Math.max(0, y - TICK_BOX / 2), HEIGHT - TICK_BOX) },
                ]}
              >
                {/* Tope 1,3 y no el 1,6 del rol: la columna es de ancho fijo y un tick recortado
                  ("1.10…") es peor que uno un punto más chico. */}
                <Text
                  color="tertiary"
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={1}
                  role="label"
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
              data={points}
              // left/right: sin eso el primer y el último punto caen justo sobre el borde del canvas
              // y el trazo con punta redonda se corta al medio. La derecha lleva el doble porque ahí
              // además va el punto final.
              domainPadding={{ bottom: 12, left: 4, right: 8, top: 12 }}
              onScaleChange={(_x: LinearScale, y: LinearScale) => {
                // d3 ya redondeó el dominio: `ticks` devuelve valores lindos y `y(v)` su píxel exacto.
                // Se saltean de a un paso CONSTANTE — agarrar primero/medio/último de una lista par
                // (120/100/80/60 → 120/80/60) dibuja saltos de 40 y de 20 con la misma separación.
                const values = y.ticks(TICKS)
                const stride = Math.max(1, Math.ceil(values.length / MAX_TICKS))
                const picked = values.filter((_, i) => i % stride === 0)
                const format = tickFormat(picked.length > 1 ? Math.abs(picked[0] - picked[1]) : 0)
                setTicks(picked.map((v) => ({ text: format.format(v), v, y: y(v) })))
              }}
              xKey="date"
              yAxis={NO_GRID}
              yKeys={['top', 'e1rm']}
            >
              {({ chartBounds, points: p }) => {
                const last = p.e1rm[p.e1rm.length - 1]
                return (
                  <>
                    {/* El relleno va PRIMERO: e1RM siempre queda arriba del peso máximo (Epley
                        nunca resta), así que pintarlo después lavaría la serie de contexto. */}
                    <Area points={p.e1rm} y0={chartBounds.bottom}>
                      <LinearGradient
                        colors={[`${theme.tint}${FILL_TOP}`, `${theme.tint}${FILL_BOTTOM}`]}
                        end={vec(0, chartBounds.bottom)}
                        start={vec(0, chartBounds.top)}
                      />
                    </Area>
                    {/* Medio punto menos de trazo que la serie del tinte: la jerarquía se lee sin
                        cambiar el color. */}
                    <Line
                      color={theme.muted}
                      points={p.top}
                      strokeCap="round"
                      strokeJoin="round"
                      strokeWidth={2}
                    />
                    <Line
                      color={theme.tint}
                      points={p.e1rm}
                      strokeCap="round"
                      strokeJoin="round"
                      strokeWidth={2.5}
                    />
                    {/* La última sesión, marcada: sin esto una serie de dos puntos parece un tramo
                        cortado y no se ve dónde termina. */}
                    {last?.y == null ? null : (
                      <Circle color={theme.tint} cx={last.x} cy={last.y} r={POINT} />
                    )}
                  </>
                )
              }}
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
    </View>
  )
}
