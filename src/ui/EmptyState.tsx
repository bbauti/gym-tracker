import { type AndroidSymbol, type AnimationSpec, type SFSymbol, SymbolView } from 'expo-symbols'
import { StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import Button from './Button'
import { Enter, useReducedMotion } from './motion'
import Text from './Text'
import { colors, spacing } from './tokens'

type Props = {
  sf?: string
  /** Material Symbol equivalente; sin esto SymbolView no dibuja nada en Android. */
  md?: string
  title: string
  description?: string
  action?: { title: string; onPress: () => void }
}

/**
 * Un rebote y nada más (iOS 17+, `SymbolEffectOptions.nonRepeating` es el default del módulo): un
 * vacío se ve pocas veces y el símbolo es lo primero que mira el ojo. Android ignora la prop.
 */
const BOUNCE: AnimationSpec = { effect: { type: 'bounce', wholeSymbol: true } }

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
  },
  centered: { textAlign: 'center' },
})

export default function EmptyState({ sf, md, title, description, action }: Props) {
  // `animated` sale de `!!animationSpec` (SymbolView.ios.tsx), así que sin spec no hay efecto: los
  // símbolos de UIKit no consultan Reduce Motion por su cuenta.
  const reduced = useReducedMotion()

  return (
    <Animated.View entering={Enter.rise} style={styles.wrap}>
      {/* Decorativo: el título ya lo dice todo. En Android el símbolo es un <Text> con un codepoint
          privado y TalkBack lo pararía a leer, y expo-symbols ahí solo reenvía `style`: el wrapper
          es el único lugar donde estas props llegan (mismo patrón que ui/LockScreen). */}
      {sf ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <SymbolView
            animationSpec={reduced ? undefined : BOUNCE}
            fallback={null}
            name={{ ios: sf as SFSymbol, android: md as AndroidSymbol }}
            size={44}
            tintColor={colors.tertiaryLabel}
          />
        </View>
      ) : null}
      <Text role="headline" style={styles.centered}>
        {title}
      </Text>
      {description ? (
        <Text color="secondary" style={styles.centered}>
          {description}
        </Text>
      ) : null}
      {action ? <Button onPress={action.onPress} title={action.title} variant="tinted" /> : null}
    </Animated.View>
  )
}
