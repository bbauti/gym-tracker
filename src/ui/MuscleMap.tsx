import { Canvas, Group, interpolateColors, Path, RoundedRect } from '@shopify/react-native-skia'
import { useState } from 'react'
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native'
import type { Muscle } from '@/db/schema'
import { t } from '@/i18n'
import { type ChartTheme, useChartTheme } from './chartTheme'
import Text from './Text'
import { spacing } from './tokens'

/** Caja de diseño de UNA figura: los paths van a mano en estas unidades y se escalan al ancho. */
const FIG_W = 120
/** Dos figuras (120 c/u) con margen y hueco: 260 / 420 = 0,62 de alto. */
const DESIGN_W = 420
const DESIGN_H = 260
const FRONT_X = 55
const BACK_X = 245

type Pt = { x: number; y: number; w: number }

const pt = (x: number, y: number, w: number): Pt => ({ x, y, w })

/**
 * Bloque muscular: tapa redondeada arriba y abajo, lados curvados por el nodo del medio.
 *
 * Siempre se dibuja en el mismo sentido (el borde de arriba va de izquierda a derecha). Con la
 * regla `nonzero` dos contornos del mismo sentido se UNEN, así que el par izquierdo/derecho de un
 * músculo se pinta como una sola silueta: sin eso, el alpha de los dos se sumaba donde se tocan y
 * dejaba una costura más oscura al medio del cuerpo.
 */
function blob(a: Pt, m: Pt, b: Pt): string {
  return (
    `M${a.x - a.w} ${a.y}` +
    `Q${a.x} ${a.y - a.w * 0.55} ${a.x + a.w} ${a.y}` +
    `Q${m.x + m.w} ${m.y} ${b.x + b.w} ${b.y}` +
    `Q${b.x} ${b.y + b.w * 0.55} ${b.x - b.w} ${b.y}` +
    `Q${m.x - m.w} ${m.y} ${a.x - a.w} ${a.y}Z`
  )
}

/** Espejo en coordenadas, no con un `scaleX`: un transform negativo invierte el sentido del trazo. */
const flip = (p: Pt): Pt => ({ ...p, x: FIG_W - p.x })

/** El músculo de los dos lados, en un único path. */
const pair = (a: Pt, m: Pt, b: Pt): string => blob(a, m, b) + blob(flip(a), flip(m), flip(b))

const TORSO =
  'M31 56Q60 48 89 56Q93 92 84 128Q87 152 87 174Q60 184 33 174Q33 152 36 128Q27 92 31 56Z'

/**
 * Cabeza, cuello, torso, brazos y piernas: lo que NO es una región muscular. Va en un solo path
 * (mismo motivo que `pair`) para que los solapes hombro-torso y cadera-pierna no se oscurezcan.
 */
const BASE =
  blob(pt(60, 8, 9), pt(60, 24, 15), pt(60, 40, 9)) +
  blob(pt(60, 36, 8), pt(60, 44, 9), pt(60, 53, 10)) +
  TORSO +
  pair(pt(27, 54, 11), pt(21, 108, 9), pt(16, 168, 6)) +
  pair(pt(45, 174, 14), pt(44, 212, 13), pt(45, 254, 8))

const ARM_UPPER = pair(pt(22, 88, 8), pt(20, 104, 8), pt(19, 122, 6))
const FOREARMS = pair(pt(19, 128, 6), pt(17, 146, 7), pt(16, 164, 5))
const CALVES = pair(pt(45, 236, 8), pt(43, 244, 8), pt(45, 255, 5))

const FRONT: Array<[Muscle, string]> = [
  ['shoulders_side', pair(pt(29, 57, 8), pt(25, 68, 9), pt(27, 78, 6))],
  ['shoulders_front', pair(pt(45, 56, 6), pt(43, 64, 7), pt(43, 70, 5))],
  ['chest', pair(pt(50, 78, 9), pt(47, 88, 11), pt(50, 99, 9))],
  ['biceps', ARM_UPPER],
  ['forearms', FOREARMS],
  ['obliques', pair(pt(44, 110, 5), pt(42, 128, 5), pt(46, 148, 4))],
  ['abs', blob(pt(60, 110, 11), pt(60, 130, 12), pt(60, 150, 9))],
  ['quads', pair(pt(42, 180, 9), pt(40, 200, 9), pt(41, 220, 8))],
  ['adductors', pair(pt(55, 182, 4), pt(54, 197, 4), pt(54, 214, 3))],
  ['calves', CALVES],
]

const BACK: Array<[Muscle, string]> = [
  ['shoulders_rear', pair(pt(29, 57, 8), pt(25, 68, 9), pt(27, 78, 6))],
  ['traps', blob(pt(60, 58, 9), pt(60, 70, 26), pt(60, 80, 11))],
  ['back_upper', blob(pt(60, 96, 16), pt(60, 102, 17), pt(60, 108, 14))],
  ['back_lats', pair(pt(38, 100, 6), pt(39, 116, 6), pt(43, 132, 5))],
  ['triceps', ARM_UPPER],
  ['forearms', FOREARMS],
  ['lower_back', blob(pt(60, 124, 12), pt(60, 136, 12), pt(60, 148, 10))],
  ['glutes', pair(pt(48, 162, 12), pt(47, 171, 13), pt(50, 180, 10))],
  ['hamstrings', pair(pt(44, 194, 11), pt(42, 210, 10), pt(42, 226, 8))],
  ['calves', CALVES],
]

/** Del riel al tinte. El alpha sube con la carga: en 0 el músculo queda igual que la silueta. */
const fillColor = (load: number, theme: ChartTheme) =>
  interpolateColors(load, [0, 1], [theme.track, theme.tint])
const fillOpacity = (load: number, theme: ChartTheme) =>
  theme.trackOpacity + (1 - theme.trackOpacity) * load

const LEGEND_STEPS = [0, 0.25, 0.5, 0.75, 1]
const SWATCH = 14
const SWATCH_GAP = 2
const SWATCH_R = 3
const LEGEND_W = LEGEND_STEPS.length * SWATCH + (LEGEND_STEPS.length - 1) * SWATCH_GAP

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingTop: spacing[2],
  },
  swatch: { width: LEGEND_W, height: SWATCH },
})

type Props = {
  /** Carga reciente por músculo, 0 a 1 (E08). */
  load: Record<Muscle, number>
  /** El mapa es UN elemento accesible: acá va el resumen en palabras. */
  label: string
}

/** Los `n` músculos más cargados, de mayor a menor. Los que están en cero no cuentan. */
export function topLoaded(load: Record<Muscle, number>, n = 3): Muscle[] {
  return (Object.keys(load) as Muscle[])
    .filter((m) => m !== 'full_body' && load[m] > 0)
    .sort((a, b) => load[b] - load[a])
    .slice(0, n)
}

function Figure({
  x,
  regions,
  load,
  theme,
}: {
  x: number
  regions: Array<[Muscle, string]>
  load: Record<Muscle, number>
  theme: ChartTheme
}) {
  return (
    <Group transform={[{ translateX: x }]}>
      <Path color={theme.track} opacity={theme.trackOpacity} path={BASE} />
      {regions.map(([muscle, path]) => (
        <Path
          color={fillColor(load[muscle], theme)}
          key={muscle}
          opacity={fillOpacity(load[muscle], theme)}
          path={path}
        />
      ))}
    </Group>
  )
}

/**
 * E08: qué tan cargado está cada músculo en los últimos 7 días, de frente y de espalda.
 *
 * No mide fatiga: es "cuánto y hace cuánto", con el decaimiento que hace `muscleLoad`. Por eso no
 * lleva números ni escala — la pregunta que contesta es "¿a qué le doy hoy?", y para eso alcanza
 * con ver qué zona está apagada.
 *
 * ponytail: siluetas a mano, sin detalle anatómico ni assets. Techo: no se puede tocar un músculo
 * para filtrar, y las regiones son bloques simétricos (no distingue izquierda de derecha).
 */
export default function MuscleMap({ load, label }: Props) {
  const theme = useChartTheme()
  const [width, setWidth] = useState(0)

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)
  const height = (width * DESIGN_H) / DESIGN_W

  return (
    <View>
      {/* `aspectRatio` y no la altura medida: el alto sale del primer layout, así la sección no
          salta un frame de 0 px mientras se mide el ancho. */}
      <View
        accessible
        accessibilityLabel={label}
        accessibilityRole="image"
        onLayout={onLayout}
        style={{ aspectRatio: DESIGN_W / DESIGN_H }}
      >
        {width > 0 ? (
          <Canvas style={{ width, height }}>
            <Group transform={[{ scale: width / DESIGN_W }]}>
              <Figure load={load} regions={FRONT} theme={theme} x={FRONT_X} />
              <Figure load={load} regions={BACK} theme={theme} x={BACK_X} />
            </Group>
          </Canvas>
        ) : null}
      </View>

      {/* Un solo elemento: sueltos, los dos rótulos daban dos paradas de VoiceOver que sin ver la
          rampa no dicen nada. */}
      <View
        accessible
        accessibilityLabel={`${t('muscleMap.legendFresh')} – ${t('muscleMap.legendLoaded')}`}
        style={styles.legend}
      >
        <Text color="tertiary" role="caption">
          {t('muscleMap.legendFresh')}
        </Text>
        <Canvas style={styles.swatch}>
          {LEGEND_STEPS.map((step, i) => (
            <RoundedRect
              color={fillColor(step, theme)}
              height={SWATCH}
              key={step}
              opacity={fillOpacity(step, theme)}
              r={SWATCH_R}
              width={SWATCH}
              x={i * (SWATCH + SWATCH_GAP)}
              y={0}
            />
          ))}
        </Canvas>
        <Text color="tertiary" role="caption">
          {t('muscleMap.legendLoaded')}
        </Text>
      </View>
    </View>
  )
}
