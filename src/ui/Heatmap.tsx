import { Canvas, RoundedRect } from '@shopify/react-native-skia'
import { useState } from 'react'
import { type LayoutChangeEvent, View } from 'react-native'
import { useChartTheme } from './chartTheme'

const ROWS = 7
const GAP = 3
const RADIUS = 3
/**
 * Rampa secuencial de un solo tono: más series = más oscuro. Nunca dos colores.
 *
 * El primer escalón arranca alto a propósito: la celda vacía se dibuja con `trackOpacity` (0,3 en
 * dark), así que un 0,3 acá hacía que un día de entrenamiento y uno de descanso tuvieran la MISMA
 * opacidad y se distinguieran solo por el tono — justo la única pregunta que contesta el mapa.
 */
const LEVELS = [0.45, 0.65, 0.82, 1]
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
  const [width, setWidth] = useState(0)

  const cols = Math.max(1, Math.ceil(days.length / ROWS))
  const cell = width > 0 ? (width - GAP * (cols - 1)) / cols : 0
  const height = cell * ROWS + GAP * (ROWS - 1)

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
        <Canvas style={{ width, height }}>
          {days.map(({ day, sets }, i) => {
            const level = sets > 0 ? CUTS.filter((c) => sets >= c).length : -1
            return (
              <RoundedRect
                color={level < 0 ? theme.track : theme.tint}
                height={cell}
                key={day}
                opacity={level < 0 ? theme.trackOpacity : LEVELS[level]}
                r={RADIUS}
                width={cell}
                x={Math.floor(i / ROWS) * (cell + GAP)}
                y={(i % ROWS) * (cell + GAP)}
              />
            )
          })}
        </Canvas>
      ) : null}
    </View>
  )
}
