import { Platform, Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native'
import { colors } from './tokens'

type Role =
  | 'display'
  | 'displaySmall'
  | 'largeTitle'
  | 'title'
  | 'titleEmphasized'
  | 'headline'
  | 'body'
  | 'callout'
  | 'footnote'
  | 'label'
  | 'caption'
  | 'overline'
type Color = 'primary' | 'secondary' | 'tertiary' | 'tint' | 'destructive'

// RN ya usa `role` para el rol ARIA; acá manda el rol tipográfico (a11y va por accessibilityRole).
type Props = Omit<TextProps, 'role'> & { role?: Role; color?: Color; tabular?: boolean }

// SF Rounded no se alcanza desde RN sin módulo nativo: el carácter de los numerales grandes sale del
// peso 800 + tracking negativo + tabular. El tracking se aprieta más en iOS porque SF lo aguanta;
// Roboto a -1.5 se junta.
const DISPLAY_TRACKING = Platform.OS === 'ios' ? -1.5 : -0.5
// A 44 pt el mismo apriete relativo que `display` (~-2.7% iOS / ~-0.9% Android): un -1 fijo dejaría
// el rol chico MÁS apretado que el grande justo en Roboto, que es donde no entra.
const DISPLAY_SMALL_TRACKING = Platform.OS === 'ios' ? -1.2 : -0.4

const styles = StyleSheet.create({
  display: { fontSize: 56, lineHeight: 64, fontWeight: '800', letterSpacing: DISPLAY_TRACKING },
  displaySmall: {
    fontSize: 44,
    lineHeight: 52,
    fontWeight: '800',
    letterSpacing: DISPLAY_SMALL_TRACKING,
  },
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  titleEmphasized: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.3 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  // El uppercase lo pone `SectionHeader`, no el rol: el mismo tamaño sirve para un dato chico.
  overline: { fontSize: 11, lineHeight: 13, fontWeight: '600', letterSpacing: 0.8 },
  tabular: { fontVariant: ['tabular-nums'] },
})

const tint: Record<Color, TextStyle> = {
  primary: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  tertiary: { color: colors.tertiaryLabel },
  tint: { color: colors.tint },
  destructive: { color: colors.destructive },
}

// Los títulos escalan libre; en las filas densas (<= body) el Dynamic Type se topea en 1.6. Los
// roles display se topean en 1.3: a 56 pt, 1.6 se come la pantalla (van con `adjustsFontSizeToFit`).
const MAX_SCALE: Record<Role, number | undefined> = {
  display: 1.3,
  displaySmall: 1.3,
  largeTitle: undefined,
  title: undefined,
  titleEmphasized: undefined,
  headline: undefined,
  body: 1.6,
  callout: 1.6,
  footnote: 1.6,
  label: 1.6,
  caption: 1.6,
  overline: 1.6,
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
