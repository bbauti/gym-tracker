import type { ReactNode } from 'react'
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import { concentric } from './shape'
import { colors, outline, radius, shadow, spacing } from './tokens'

type Variant = 'flat' | 'raised' | 'inset'
type Props = { children: ReactNode; style?: StyleProp<ViewStyle>; variant?: Variant }

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.secondaryGroupedBackground,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    padding: spacing[4],
  },
  // Un bloque metido ADENTRO de una card: un tono más y radio concéntrico con el padre (§12.3),
  // calculado contra el padding de `card` porque ese es el hueco entre los dos bordes.
  inset: {
    backgroundColor: colors.tertiaryGroupedBackground,
    borderRadius: concentric(radius.lg, spacing[4]),
    padding: spacing[3],
  },
})

// `raised` va con las dos: en dark la sombra se pierde contra el fondo y lo que separa la card es
// el hairline (§12.7).
const VARIANT: Record<Variant, StyleProp<ViewStyle>> = {
  flat: null,
  raised: [shadow.card, outline],
  inset: styles.inset,
}

export default function Card({ children, style, variant = 'flat' }: Props) {
  return <View style={[styles.card, VARIANT[variant], style]}>{children}</View>
}
