import type { ReactNode } from 'react'
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import { colors, radius, spacing } from './tokens'

type Props = { children: ReactNode; style?: StyleProp<ViewStyle> }

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.secondaryGroupedBackground,
    borderRadius: radius.lg,
    padding: spacing[4],
  },
})

export default function Card({ children, style }: Props) {
  return <View style={[styles.card, style]}>{children}</View>
}
