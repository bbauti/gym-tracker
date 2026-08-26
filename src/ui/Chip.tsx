import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { StyleSheet, View } from 'react-native'
import { haptic } from './haptics'
import PressableScale from './PressableScale'
import Text from './Text'
import { colors, radius, spacing } from './tokens'

type Props = {
  label: string
  selected?: boolean
  onPress: () => void
  sf?: string
  /** Material Symbol equivalente; sin esto SymbolView no dibuja nada en Android. */
  md?: string
  /**
   * Para cuando el label solo no alcanza: dos chips de filas distintas pueden decir lo mismo
   * ("Bien" de bombeo y "Bien" de dificultad) y en el rotor quedan indistinguibles.
   */
  accessibilityLabel?: string
}

const styles = StyleSheet.create({
  // minHeight, no height: con Dynamic Type el chip crece en vez de recortar el label.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    minHeight: 32,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.lg,
    backgroundColor: colors.fill,
    overflow: 'hidden',
  },
  // colors.tint es un PlatformColor: no se le puede bajar el alpha, se lava con una capa encima.
  wash: { backgroundColor: colors.tint, opacity: 0.18, borderRadius: radius.lg },
})

export default function Chip({
  label,
  selected = false,
  onPress,
  sf,
  md,
  accessibilityLabel,
}: Props) {
  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        // Un chip siempre cambia el filtro (el seleccionado se apaga), así que el press es el cambio.
        haptic('selection')
        onPress()
      }}
      style={styles.chip}
    >
      {selected ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wash]} />
      ) : null}
      {sf ? (
        <SymbolView
          fallback={null}
          name={{ ios: sf as SFSymbol, android: md as AndroidSymbol }}
          size={13}
          tintColor={selected ? colors.tint : colors.secondaryLabel}
        />
      ) : null}
      <Text color={selected ? 'tint' : 'secondary'} numberOfLines={1} role="footnote">
        {label}
      </Text>
    </PressableScale>
  )
}
