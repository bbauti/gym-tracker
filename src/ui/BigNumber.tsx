import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import Text from './Text'
import { colors, opacity, spacing } from './tokens'

type Align = 'left' | 'center' | 'right'
type Props = {
  value: string
  /** Unidad o sufijo ("kg", "%", "series"): apoya al número, no compite con él. */
  unit?: string
  /** Qué es el número. Va debajo, y al final de la etiqueta de accesibilidad. */
  label?: string
  role?: 'display' | 'displaySmall' | 'titleEmphasized'
  align?: Align
  /** `onTint` = encima de una superficie tintada (hero, tile de acento). */
  tone?: 'primary' | 'tint' | 'onTint'
  style?: StyleProp<ViewStyle>
}

const BOX: Record<Align, ViewStyle['alignItems']> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
}

const styles = StyleSheet.create({
  root: { gap: spacing[1] },
  // Baseline: la unidad se apoya en la línea del número, no en su centro.
  line: { alignItems: 'baseline', flexDirection: 'row', gap: spacing[1] },
  // Sin esto `adjustsFontSizeToFit` no tiene contra qué achicar: el texto no se dejaría encoger.
  value: { flexShrink: 1 },
  onTint: { color: colors.onTint },
  // Sobre una superficie tintada no hay gris legible: el apoyo baja opacidad en vez de color.
  onTintSupport: { color: colors.onTint, opacity: opacity.dim },
})

/**
 * El numeral grande de una pantalla o de un tile: tabular para que no baile al contar, capado en
 * una línea y achicado hasta entrar (los roles display topean Dynamic Type en 1.3, ver `Text`).
 *
 * Un solo elemento accesible: el lector dice "1.234 kg, volumen", no tres nodos sueltos.
 */
export default function BigNumber({
  value,
  unit,
  label,
  role = 'display',
  align = 'left',
  tone = 'primary',
  style,
}: Props) {
  const over = tone === 'onTint'
  const a11y = [[value, unit].filter(Boolean).join(' '), label].filter(Boolean).join(', ')

  return (
    <View
      accessibilityLabel={a11y}
      accessible
      style={[styles.root, { alignItems: BOX[align] }, style]}
    >
      <View style={styles.line}>
        <Text
          adjustsFontSizeToFit
          color={tone === 'tint' ? 'tint' : 'primary'}
          numberOfLines={1}
          role={role}
          style={[styles.value, over ? styles.onTint : null]}
          tabular
        >
          {value}
        </Text>
        {unit ? (
          <Text
            color={over ? 'primary' : 'secondary'}
            numberOfLines={1}
            role="label"
            style={over ? styles.onTintSupport : null}
          >
            {unit}
          </Text>
        ) : null}
      </View>
      {label ? (
        <Text
          color={over ? 'primary' : 'secondary'}
          role="footnote"
          style={[{ textAlign: align }, over ? styles.onTintSupport : null]}
        >
          {label}
        </Text>
      ) : null}
    </View>
  )
}
