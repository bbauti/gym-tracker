import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { StyleSheet, View } from 'react-native'
import GradientSurface from './GradientSurface'
import { haptic } from './haptics'
import PressableScale from './PressableScale'
import Text from './Text'
import { colors, opacity, radius, spacing } from './tokens'

type Props = {
  title: string
  onPress: () => void
  /**
   * Cuando el título no alcanza para saber cuál de todos es. Cinco cards de rutina dan cinco
   * "Empezar, botón" idénticos, y el cuerpo de la card es otro elemento accesible: no se hereda.
   */
  accessibilityLabel?: string
  /** `hero` es el primario de una pantalla: degradado, 56 pt y radio xl. Uno solo a la vista. */
  variant?: 'filled' | 'tinted' | 'plain' | 'hero'
  size?: 'md' | 'lg'
  destructive?: boolean
  disabled?: boolean
  sf?: string
  /** Material Symbol equivalente; sin esto SymbolView no dibuja nada en Android. */
  md?: string
}

const styles = StyleSheet.create({
  // `overflow: hidden` recorta el wash, el degradado y el highlight del press al radio que toque.
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    overflow: 'hidden',
  },
  md: { minHeight: 50, borderRadius: radius.md },
  lg: { minHeight: 56, borderRadius: radius.lg, paddingHorizontal: spacing[5] },
  // Manda sobre el `size`: un hero mide siempre lo mismo.
  hero: { minHeight: 56, borderRadius: radius.xl },
  wash: { opacity: opacity.wash },
  disabled: { opacity: opacity.disabled },
  label: { flexShrink: 1 },
  heroLabel: { fontWeight: '700' },
})

export default function Button({
  title,
  accessibilityLabel,
  onPress,
  variant = 'filled',
  size = 'md',
  destructive,
  disabled,
  sf,
  md,
}: Props) {
  const primary = variant === 'filled' || variant === 'hero'
  const accent = destructive ? colors.destructive : colors.tint
  const fg = primary ? colors.onTint : accent
  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={() => {
        // Solo el primario (§12.3): un `tinted`/`plain` es la acción de al lado y no se gana un golpe.
        if (primary) haptic('buttonPrimary')
        onPress()
      }}
      style={[
        styles.base,
        styles[size],
        variant === 'hero' && styles.hero,
        variant === 'filled' && { backgroundColor: accent },
        disabled && styles.disabled,
      ]}
    >
      {variant === 'hero' && <GradientSurface style={StyleSheet.absoluteFill} />}
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
      <Text
        role="headline"
        style={[styles.label, variant === 'hero' && styles.heroLabel, { color: fg }]}
      >
        {title}
      </Text>
    </PressableScale>
  )
}
