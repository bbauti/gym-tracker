import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { StyleSheet, View } from 'react-native'
import PressableScale from './PressableScale'
import Text from './Text'
import { colors, radius, spacing } from './tokens'

type Props = {
  title: string
  onPress: () => void
  variant?: 'filled' | 'tinted' | 'plain'
  destructive?: boolean
  disabled?: boolean
  sf?: string
  /** Material Symbol equivalente; sin esto SymbolView no dibuja nada en Android. */
  md?: string
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 50,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
  },
  wash: { opacity: 0.15, borderRadius: radius.md },
  disabled: { opacity: 0.4 },
  label: { flexShrink: 1 },
})

export default function Button({
  title,
  onPress,
  variant = 'filled',
  destructive,
  disabled,
  sf,
  md,
}: Props) {
  const accent = destructive ? colors.destructive : colors.tint
  const fg = variant === 'filled' ? '#FFFFFF' : accent
  return (
    <PressableScale
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.base,
        variant === 'filled' && { backgroundColor: accent },
        disabled && styles.disabled,
      ]}
    >
      {variant === 'tinted' && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.wash, { backgroundColor: accent }]}
        />
      )}
      {sf ? (
        <SymbolView
          fallback={null}
          name={{ ios: sf as SFSymbol, android: md as AndroidSymbol }}
          size={18}
          tintColor={fg}
        />
      ) : null}
      <Text role="headline" style={[styles.label, { color: fg }]}>
        {title}
      </Text>
    </PressableScale>
  )
}
