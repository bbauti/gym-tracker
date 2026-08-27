import { type ColorValue, StyleSheet, View } from 'react-native'
import Text from './Text'
import { colors, opacity, radius, spacing } from './tokens'

type Tone = 'tint' | 'neutral' | 'success' | 'warning' | 'destructive'
type Size = 'sm' | 'md'
/** Etiqueta chiquita y NO tocable: `ui/Chip` es el control (pide onPress y vibra al tocarlo). */
type Props = { label: string; tone?: Tone; size?: Size }

// El fondo sale del mismo color que el texto, lavado: ningún `colors.*` acepta alpha (son
// PlatformColor), así que el lavado va como capa encima y no como rgba.
// `neutral` usa `label` en vez de `fill` por lo mismo: es el único gris que sigue el esquema, y al
// 14 % da el mismo relleno neutro en light y en dark.
const WASH: Record<Tone, ColorValue> = {
  tint: colors.tint,
  neutral: colors.label,
  success: colors.success,
  warning: colors.warning,
  destructive: colors.destructive,
}

// `success` y `warning` dejan el tono en el lavado y escriben con `label`: su propio color sobre su
// propio lavado da ~2:1 (systemOrange sobre naranja al 14 %) y a 12 pt no se lee.
const FG: Record<Tone, ColorValue> = {
  tint: colors.tint,
  neutral: colors.secondaryLabel,
  success: colors.label,
  warning: colors.label,
  destructive: colors.destructive,
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  sm: { paddingHorizontal: spacing[2], paddingVertical: 2 },
  md: { paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
  wash: { opacity: opacity.wash },
})

export default function Badge({ label, tone = 'neutral', size = 'sm' }: Props) {
  return (
    <View style={[styles.badge, styles[size]]}>
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.wash, { backgroundColor: WASH[tone] }]}
      />
      <Text role={size === 'sm' ? 'caption' : 'label'} style={{ color: FG[tone] }}>
        {label}
      </Text>
    </View>
  )
}
