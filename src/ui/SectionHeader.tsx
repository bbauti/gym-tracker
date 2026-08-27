import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import PressableScale from './PressableScale'
import Text from './Text'
import { MIN_TARGET, Press, radius, spacing } from './tokens'

type Props = {
  title: string
  subtitle?: string
  action?: { title: string; onPress: () => void }
  /** `overline` para separar bloques de una lista; `title` para abrir una pantalla. */
  kind?: 'overline' | 'title'
  style?: StyleProp<ViewStyle>
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing[2] },
  // Solo con acción: un encabezado suelto no se gana 44 pt de alto.
  target: { minHeight: MIN_TARGET },
  labels: { flex: 1 },
  // El uppercase lo pone el encabezado, no el rol `overline` (§12.3): el rol también sirve de dato.
  overline: { textTransform: 'uppercase' },
  // El hitSlop de PressableScale no alcanza: en Android el toque se recorta a los límites del
  // padre. La fila mide 44 pt y el botón la llena.
  // El radio es solo para el wash del press: el botón no tiene fondo propio (ídem MonthCalendar).
  action: {
    borderRadius: radius.sm,
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    paddingHorizontal: spacing[2],
  },
})

export default function SectionHeader({
  title,
  subtitle,
  action,
  kind = 'overline',
  style,
}: Props) {
  const overline = kind === 'overline'
  return (
    <View style={[styles.row, action && styles.target, style]}>
      <View style={styles.labels}>
        <Text
          accessibilityRole="header"
          color={overline ? 'secondary' : 'primary'}
          numberOfLines={2}
          role={overline ? 'overline' : 'title'}
          style={overline && styles.overline}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text color="secondary" role="footnote">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? (
        <PressableScale
          accessibilityLabel={action.title}
          accessibilityRole="button"
          highlight
          onPress={action.onPress}
          scale={Press.scale}
          style={styles.action}
        >
          <Text color="tint" numberOfLines={1} role="footnote">
            {action.title}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  )
}
