import { type ComponentProps, type ReactNode, useState } from 'react'
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { Spring } from './motion'
import Text from './Text'
import { colors, opacity, outline, Press, radius, shadow, spacing, TILE } from './tokens'

type Size = { width: number; height: number }
/** `sign` decide flecha y color; el texto ya viene formateado (unidades, signo, plural). */
type Delta = { text: string; sign: 1 | 0 | -1 }

type Base = {
  title: string
  value?: string
  unit?: string
  delta?: Delta
  /** Lo lee `Bento.Row` para repartir el ancho de la fila; el tile no lo usa. */
  span?: 1 | 2
  height?: keyof typeof TILE
  /** `tint` = fondo lavado + título en acento: el tile "vivo" de la pantalla, uno por región. */
  tone?: 'default' | 'tint'
  entering?: ComponentProps<typeof Animated.View>['entering']
}

// El tile es UN elemento accesible. La etiqueta automática solo sabe leer title/value/delta, así que
// en cuanto hay un canvas adentro o el tile es tocable, la etiqueta en palabras es obligatoria.
type Content =
  | { children: (size: Size) => ReactNode; accessibilityLabel: string }
  | { children?: undefined; accessibilityLabel?: string }
type Action = { onPress: () => void; accessibilityLabel: string } | { onPress?: undefined }

type Props = Base & Content & Action

const styles = StyleSheet.create({
  // `flexGrow` y no `flex`: adentro de una celda de `Bento.Row` llena el alto que estira la fila, y
  // suelto en una columna se queda con el alto de su contenido (con `flex` colapsaría al minHeight).
  fill: { flexGrow: 1 },
  card: {
    ...shadow.card,
    ...outline,
    flexGrow: 1,
    gap: spacing[1],
    padding: spacing[4],
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.secondaryGroupedBackground,
  },
  // `colors.tint` es un PlatformColor: no se le baja el alpha, se lava con una capa encima (Chip).
  wash: { backgroundColor: colors.tint, opacity: opacity.wash, borderRadius: radius.xl },
  // `label` ya se invierte solo en dark, así que el mismo overlay oscurece en light y aclara en dark.
  highlight: { backgroundColor: colors.label, borderRadius: radius.xl },
  title: { textTransform: 'uppercase' },
  value: { flexDirection: 'row', alignItems: 'baseline', gap: spacing[1] },
  number: { flexShrink: 1 },
  // Sin canvas el dato se apoya en el piso del tile (etiqueta arriba, número en la base): si no,
  // los 132 pt de `TILE.sm` dejan una franja muerta abajo y la fila del bento se lee hueca.
  stat: { flexGrow: 1, gap: spacing[1], justifyContent: 'flex-end' },
  content: { flexGrow: 1, marginTop: spacing[1] },
  up: { color: colors.success },
  down: { color: colors.destructive },
})

function label({ title, value, unit, delta }: Base): string {
  const parts = [title]
  if (value !== undefined) parts.push(unit ? `${value} ${unit}` : value)
  // La flecha se lee "triángulo apuntando arriba" en el rotor: en palabras va el signo.
  if (delta) parts.push(`${delta.sign > 0 ? '+' : delta.sign < 0 ? '−' : ''}${delta.text}`)
  return parts.join(', ')
}

/**
 * Tile del bento (§12.4): etiqueta, dato y, opcionalmente, una mini-visualización que recibe el
 * tamaño ya medido — un solo `onLayout` por tile, que es lo que necesita cada Canvas de Skia.
 * Hasta la primera medición no dibuja nada (mismo criterio que `ui/Heatmap`).
 */
export default function Tile({
  title,
  value,
  unit,
  delta,
  height = 'sm',
  tone = 'default',
  entering,
  accessibilityLabel,
  onPress,
  children,
}: Props) {
  const [size, setSize] = useState<Size | null>(null)
  const pressed = useSharedValue(0)
  const scale = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.get() * (1 - Press.row) }],
  }))
  const wash = useAnimatedStyle(() => ({ opacity: pressed.get() * Press.highlight }))

  const a11yLabel = accessibilityLabel ?? label({ title, value, unit, delta })
  const card = [styles.card, { minHeight: TILE[height] }]
  const stat = (
    <>
      {value === undefined ? null : (
        <View style={styles.value}>
          {/* Figuras proporcionales: un número grande y solo, no una columna. */}
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            numberOfLines={1}
            role="displaySmall"
            style={styles.number}
          >
            {value}
          </Text>
          {unit ? (
            <Text color="secondary" role="footnote">
              {unit}
            </Text>
          ) : null}
        </View>
      )}
      {delta ? (
        <Text
          color="tertiary"
          role="caption"
          style={delta.sign > 0 ? styles.up : delta.sign < 0 ? styles.down : undefined}
          tabular
        >
          {`${delta.sign > 0 ? '▲ ' : delta.sign < 0 ? '▼ ' : ''}${delta.text}`}
        </Text>
      ) : null}
    </>
  )
  const body = (
    <>
      {tone === 'tint' ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wash]} />
      ) : null}
      <Text
        color={tone === 'tint' ? 'tint' : 'secondary'}
        numberOfLines={2}
        role="overline"
        style={styles.title}
      >
        {title}
      </Text>
      {/* Con canvas el sobrante ya se lo come `content`: envolver acá lo repartiría entre los dos. */}
      {children ? stat : <View style={styles.stat}>{stat}</View>}
      {children ? (
        <View
          // El tile es UN elemento accesible y su etiqueta ya está en palabras: en Android un
          // `accessible` no tapa a sus hijos, así que el canvas sería una segunda parada de TalkBack.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onLayout={(e: LayoutChangeEvent) => {
            const box = e.nativeEvent.layout
            setSize((p) =>
              p && p.width === box.width && p.height === box.height
                ? p
                : { width: box.width, height: box.height },
            )
          }}
          style={styles.content}
        >
          {size ? children(size) : null}
        </View>
      ) : null}
    </>
  )

  if (!onPress)
    return (
      <Animated.View accessible accessibilityLabel={a11yLabel} entering={entering} style={card}>
        {body}
      </Animated.View>
    )

  // Press propio y no `PressableScale`: su `Pressable` externo no acepta `style`, así que no puede
  // llenar la celda del bento (quedaría del alto de su contenido al lado de un tile más alto). Los
  // tokens son los mismos, y el highlight sale del shared value de la escala.
  // El `entering` va en un nodo aparte: encima del que anima `transform` se pisan el estilo.
  return (
    <Animated.View entering={entering} style={styles.fill}>
      <Pressable
        accessible
        accessibilityLabel={a11yLabel}
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={() => pressed.set(withSpring(1, Spring.press))}
        onPressOut={() => pressed.set(withSpring(0, Spring.press))}
        style={styles.fill}
      >
        <Animated.View style={[card, scale]}>
          {body}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.highlight, wash]}
          />
        </Animated.View>
      </Pressable>
    </Animated.View>
  )
}
