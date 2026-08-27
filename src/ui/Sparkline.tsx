import { Canvas, Circle, LinearGradient, Path, Skia, vec } from '@shopify/react-native-skia'
import { useMemo } from 'react'
import { View } from 'react-native'
import { useChartTheme } from './chartTheme'
import { sparklinePoints } from './spark'

const STROKE = 2
const DOT = 3
/** Techo del degradado. Más que esto compite con la línea, que es lo que se lee. */
const FILL_ALPHA = 0.22

type Props = {
  /** De la más vieja a la más nueva. */
  values: number[]
  /** Del `onLayout` del Tile: el canvas no se mide solo (§12.9). */
  width: number
  height: number
  /** El canvas es UN elemento accesible: acá va el resumen en palabras. */
  label: string
  /** `muted` es la serie de contexto (gris); `tint` la que importa. */
  tone?: 'tint' | 'muted'
  /** Relleno degradado bajo la línea. Solo en un tile grande: en 40 px de alto es ruido. */
  fill?: boolean
  /** Punto sobre el último valor: marca "hasta hoy". */
  endDot?: boolean
}

/**
 * Serie sin ejes ni escala (§12.4): contesta "¿para dónde viene?", nada más. El número exacto vive
 * en el `BigNumber` del mismo tile, así que acá no hay grilla, ni ticks, ni marco.
 *
 * Estática por definición: los paths se arman en `useMemo` y no hay `entering` — un gráfico que se
 * redibuja animado cada vez que cambian los datos se lee como carga (§7.5).
 */
export default function Sparkline({
  values,
  width,
  height,
  label,
  tone = 'tint',
  fill,
  endDot,
}: Props) {
  const theme = useChartTheme()
  const color = tone === 'muted' ? theme.muted : theme.tint
  // El punto final es lo que más sobresale del path: si está, el margen lo fija él.
  const pad = endDot ? DOT : STROKE / 2

  const paths = useMemo(() => {
    if (width <= 0 || height <= 0) return null
    const { points } = sparklinePoints(values, width, height, pad)
    if (points.length === 0) return null

    const builder = Skia.PathBuilder.Make()
    builder.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < points.length; i++) builder.lineTo(points[i][0], points[i][1])
    // Un solo valor: un `lineTo` sobre sí mismo, que con punta redonda Skia dibuja como un punto.
    // Sin esto el path es un `moveTo` suelto, no dibuja nada y el tile queda en blanco sin motivo.
    if (points.length === 1) builder.lineTo(points[0][0], points[0][1])
    const line = builder.build()

    // `build()` no resetea el builder: el área es la MISMA línea, bajada al piso y cerrada. Así el
    // borde superior del relleno y el trazo son el mismo path y no se despegan por medio píxel.
    const last = points[points.length - 1]
    builder.lineTo(last[0], height)
    builder.lineTo(points[0][0], height)
    return { area: builder.close().detach(), last, line }
  }, [values, width, height, pad])

  const stops = useMemo(() => {
    // Mismo RGB con alpha 0 en vez de 'transparent': interpolar hacia transparente-NEGRO ensucia el
    // medio del degradado. `Skia.Color` devuelve [r,g,b,a] en 0..1, así que el hex no se parsea acá.
    const [r, g, b] = Skia.Color(color)
    return [Float32Array.of(r, g, b, FILL_ALPHA), Float32Array.of(r, g, b, 0)]
  }, [color])

  return (
    <View accessible accessibilityLabel={label} style={{ height, width }}>
      {paths ? (
        <Canvas style={{ height, width }}>
          {fill ? (
            <Path path={paths.area} style="fill">
              <LinearGradient colors={stops} end={vec(0, height)} start={vec(0, 0)} />
            </Path>
          ) : null}
          <Path
            color={color}
            path={paths.line}
            strokeCap="round"
            strokeJoin="round"
            strokeWidth={STROKE}
            style="stroke"
          />
          {endDot ? <Circle color={color} cx={paths.last[0]} cy={paths.last[1]} r={DOT} /> : null}
        </Canvas>
      ) : null}
    </View>
  )
}
