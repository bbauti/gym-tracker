import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import type { ReactNode } from 'react'
import {
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  StyleSheet,
  View,
} from 'react-native'
import PressableScale from './PressableScale'
import Text from './Text'
import { colors, MIN_TARGET, spacing } from './tokens'

type Props = {
  title: string
  subtitle?: string
  trailing?: ReactNode
  onPress?: () => void
  chevron?: boolean
  /** La fila es un solo elemento accesible: sin esto, lo que va en `trailing` no se anuncia. */
  label?: string
  /** Acciones del rotor (reordenar): el foco cae en la fila entera, así que se cuelgan de ella. */
  accessibilityActions?: AccessibilityActionInfo[]
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void
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
          <Text color="secondary" numberOfLines={1} role="footnote">
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
      <View
        {...a11y}
        accessible
        accessibilityLabel={a11yLabel}
        accessibilityState={{ disabled: true }}
        style={styles.container}
      >
        {content}
      </View>
    )
  return (
    <PressableScale
      {...a11y}
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      scale={0.98}
      style={styles.container}
    >
      {content}
    </PressableScale>
  )
}
