import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import type { ReactNode } from 'react'
import {
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type AccessibilityRole,
  type AccessibilityState,
  StyleSheet,
  View,
} from 'react-native'
import PressableScale from './PressableScale'
import Text from './Text'
import { colors, MIN_TARGET, Press, spacing } from './tokens'

type Props = {
  title: string
  subtitle?: string
  /** `label` (13/600) para un dato al pie del título; `footnote` (13/400) para una descripción. */
  subtitleRole?: 'footnote' | 'label'
  trailing?: ReactNode
  onPress?: () => void
  chevron?: boolean
  /** La fila es un solo elemento accesible: sin esto, lo que va en `trailing` no se anuncia. */
  label?: string
  /** Acciones del rotor (reordenar): el foco cae en la fila entera, así que se cuelgan de ella. */
  accessibilityActions?: AccessibilityActionInfo[]
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void
  /** Cuando la fila ES otro control (un switch, p. ej.): sin esto se anuncia como botón. */
  accessibilityRole?: AccessibilityRole
  /**
   * El valor del control (`checked`) y si está apagado. Va explícito: una fila sin `onPress` es
   * informativa, no deshabilitada, y anunciarla "atenuada" dice lo contrario de lo que pasa.
   */
  accessibilityState?: AccessibilityState
}

const styles = StyleSheet.create({
  container: { paddingLeft: spacing[4], backgroundColor: colors.secondaryGroupedBackground },
  row: {
    minHeight: MIN_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingRight: spacing[4],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  labels: { flex: 1 },
})

export default function ListRow({
  title,
  subtitle,
  subtitleRole = 'footnote',
  trailing,
  onPress,
  chevron,
  label,
  ...a11y
}: Props) {
  const a11yLabel = label ?? (subtitle ? `${title}, ${subtitle}` : title)
  const content = (
    <View style={styles.row}>
      <View style={styles.labels}>
        <Text numberOfLines={1}>{title}</Text>
        {subtitle ? (
          <Text color="secondary" numberOfLines={1} role={subtitleRole}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {chevron ? (
        <SymbolView
          fallback={
            <Text color="tertiary" role="body">
              ›
            </Text>
          }
          name={{ ios: 'chevron.right' as SFSymbol, android: 'chevron_right' as AndroidSymbol }}
          size={14}
          tintColor={colors.tertiaryLabel}
        />
      ) : null}
    </View>
  )

  if (!onPress)
    return (
      <View {...a11y} accessible accessibilityLabel={a11yLabel} style={styles.container}>
        {content}
      </View>
    )
  return (
    <PressableScale
      {...a11y}
      accessibilityLabel={a11yLabel}
      highlight
      onPress={onPress}
      scale={Press.row}
      style={styles.container}
    >
      {content}
    </PressableScale>
  )
}
