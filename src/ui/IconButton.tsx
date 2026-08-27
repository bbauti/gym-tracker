import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { type AccessibilityState, type ColorValue, StyleSheet, View } from 'react-native'
import PressableScale from './PressableScale'
import Text from './Text'
import { colors, MIN_TARGET, Press } from './tokens'

type Props = {
  sf: string
  /** Material Symbol equivalente; sin esto SymbolView no dibuja nada en Android. */
  md: string
  /** Lo único que anuncia el botón: adentro solo hay un símbolo. */
  label: string
  onPress?: () => void
  tint?: 'label' | 'tint' | 'tertiary' | 'destructive'
  /**
   * Trigger de `ui/Menu`: sale una View, no un Pressable. `MenuView` monta la vista nativa que se
   * come el tap, así que el Pressable no recibiría onPress y encima taparía el rol del trigger.
   */
  asMenuTrigger?: boolean
  /** Glifo para cuando el símbolo no existe (Android sin el Material Symbol): el target no queda vacío. */
  fallback?: string
  /** Estado del control (`selected` en un toggle): se suma al `disabled` que el botón ya anuncia. */
  accessibilityState?: AccessibilityState
}

const TINT: Record<NonNullable<Props['tint']>, ColorValue> = {
  label: colors.label,
  tertiary: colors.tertiaryLabel,
  tint: colors.tint,
  destructive: colors.destructive,
}

const styles = StyleSheet.create({
  // minWidth/minHeight, no width/height: con Dynamic Type el glifo del fallback crece.
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
  },
})

export default function IconButton({
  sf,
  md,
  label,
  onPress,
  tint = 'label',
  asMenuTrigger = false,
  fallback = '•',
  accessibilityState,
}: Props) {
  const icon = (
    <SymbolView
      fallback={
        <Text color={tint === 'label' ? 'primary' : tint} role="title">
          {fallback}
        </Text>
      }
      name={{ ios: sf as SFSymbol, android: md as AndroidSymbol }}
      size={22}
      tintColor={TINT[tint]}
    />
  )

  if (asMenuTrigger)
    return (
      <View accessible accessibilityLabel={label} accessibilityRole="button" style={styles.box}>
        {icon}
      </View>
    )

  return (
    <PressableScale
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: !onPress, ...accessibilityState }}
      disabled={!onPress}
      onPress={onPress}
      scale={Press.scale}
      style={styles.box}
    >
      {icon}
    </PressableScale>
  )
}
