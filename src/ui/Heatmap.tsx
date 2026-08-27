import { Canvas, RoundedRect } from '@shopify/react-native-skia'
import { useState } from 'react'
import { type LayoutChangeEvent, useColorScheme, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useChartTheme } from './chartTheme'
import { Enter } from './motion'
import { radius } from './tokens'

const ROWS = 7
const GAP = 3
/**
 * Rampa secuencial de un solo tono: más series = más oscuro. Nunca dos colores.
 *
 * Dos rampas porque el riel vacío no pesa igual en los dos esquemas: en dark son las celdas vacías
 * las que dibujan la grilla y suben a `EMPTY_DARK` para separarse del fondo agrupado, así que el
 * primer escalón lleno sube con ellas. Si se tocaran, un día de entrenamiento y uno de descanso
 * quedarían a la MISMA opacidad y se distinguirían solo por el tono — justo la única pregunta que
 * contesta el mapa.
 */
const LEVELS = { light: [0.45, 0.65, 0.82, 1], dark: [0.55, 0.72, 0.86, 1] }
const EMPTY_DARK = 0.36
/**
 * Cortes por cantidad ABSOLUTA de series, no contra el máximo del período: con un día de 40 series
 * en la ventana, uno normal de 5 caía en el escalón más bajo y el mapa se aplanaba entero. Además
 * así dos capturas de meses distintos se leen con la misma escala.
 */
const CUTS = [5, 10, 15]

type Props = {
  /** Una celda por día, en orden: la columna es la semana y la fila el día. */
  days: Array<{ day: number; sets: number }>
  /** El heatmap es UN elemento accesible: acá va el resumen en palabras. */
  label: string
}

/**
 * Constancia (G09). No tiene ejes ni leyenda: la única pregunta que contesta es "¿qué tan seguido?",
 * y para eso alcanza la densidad. Los números exactos están en las cards de arriba.
 *
 * ponytail: sin etiquetas de día ni de mes. Con 12 columnas de ~24 px no entran sin rotarlas, y
 * saber que una celda cae miércoles no cambia la lectura. Techo: no se puede señalar un día.
 */
export default function Heatmap({ days, label }: Props) {
  const theme = useChartTheme()
  const dark = useColorScheme() === 'dark'
  const [width, setWidth] = useState(0)

  const cols = Math.max(1, Math.ceil(days.length / ROWS))
  const cell = width > 0 ? (width - GAP * (cols - 1)) / cols : 0
  const height = cell * ROWS + GAP * (ROWS - 1)
  const levels = dark ? LEVELS.dark : LEVELS.light
  const empty = dark ? EMPTY_DARK : theme.trackOpacity
  // `radius.xs` es el radio de diseño, pero el ancho del contenedor no es mío: por debajo de ~18 px
  // de celda un 6 fijo la deja redonda y la grilla se lee como puntos sueltos.
  const r = Math.min(radius.xs, cell / 3)

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)

  return (
    // `aspectRatio` y no la altura medida: el alto sale del primer layout, así la sección no salta
    // un frame de 0 px mientras se mide el ancho (los gaps lo dejan ~1 px alto, invisible).
    <View
      accessible
      accessibilityLabel={label}
      onLayout={onLayout}
      style={{ aspectRatio: cols / ROWS }}
    >
      {cell > 0 ? (
        // El fade va acá y no en el `View` de arriba: este bloque monta recién con el ancho medido,
        // así que la única aparición que anima es la del primer pintado. Las celdas no animan una
        // por una — 84 fades es carga, no delight (§12.4).
        <Animated.View entering={Enter.fade}>
          <Canvas style={{ width, height }}>
            {days.map(({ day, sets }, i) => {
              const level = sets > 0 ? CUTS.filter((c) => sets >= c).length : -1
              return (
                <RoundedRect
                  color={level < 0 ? theme.track : theme.tint}
                  height={cell}
                  key={day}
                  opacity={level < 0 ? empty : levels[level]}
                  r={r}
                  width={cell}
                  x={Math.floor(i / ROWS) * (cell + GAP)}
                  y={(i % ROWS) * (cell + GAP)}
                />
              )
            })}
          </Canvas>
        </Animated.View>
      ) : null}
    </View>
  )
}
