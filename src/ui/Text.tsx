import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native'
import { colors } from './tokens'

type Role = 'largeTitle' | 'title' | 'headline' | 'body' | 'callout' | 'footnote' | 'caption'
type Color = 'primary' | 'secondary' | 'tertiary' | 'tint' | 'destructive'

// RN ya usa `role` para el rol ARIA; acá manda el rol tipográfico (a11y va por accessibilityRole).
type Props = Omit<TextProps, 'role'> & { role?: Role; color?: Color; tabular?: boolean }

const styles = StyleSheet.create({
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  tabular: { fontVariant: ['tabular-nums'] },
})

const tint: Record<Color, TextStyle> = {
  primary: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  tertiary: { color: colors.tertiaryLabel },
  tint: { color: colors.tint },
  destructive: { color: colors.destructive },
}

// Los títulos escalan libre; en las filas densas (<= body) el Dynamic Type se topea en 1.6.
const MAX_SCALE: Record<Role, number | undefined> = {
  largeTitle: undefined,
  title: undefined,
  headline: undefined,
  body: 1.6,
  callout: 1.6,
  footnote: 1.6,
  caption: 1.6,
}

export default function Text({ role = 'body', color = 'primary', tabular, style, ...rest }: Props) {
  return (
    <RNText
      maxFontSizeMultiplier={MAX_SCALE[role]}
      {...rest}
      style={[styles[role], tint[color], tabular && styles.tabular, style]}
    />
  )
}
