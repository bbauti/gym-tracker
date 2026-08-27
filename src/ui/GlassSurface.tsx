import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import type { ReactNode } from 'react'
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import { useChartTheme } from './chartTheme'
import { colors, outline, radius, shadow } from './tokens'

type Props = {
  /**
   * Tinta el vidrio con el acento. Solo la acción PRIMARIA de un grupo (HIG): dos vidrios tintados
   * al lado se pelean y ninguno se lee como el que hay que tocar.
   */
  tint?: boolean
  /** El vidrio reacciona al toque. Solo cuando la superficie ES el control, no cuando lo contiene. */
  interactive?: boolean
  style?: StyleProp<ViewStyle>
  children?: ReactNode
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.xxl, borderCurve: 'continuous' },
  // Fallback tonal (§12.3): sin vidrio, la cápsula flota con superficie + sombra, y el hairline la
  // separa en dark, donde la sombra desaparece.
  fallback: { backgroundColor: colors.secondaryGroupedBackground },
})

/**
 * Vidrio con fallback (§12.3). Solo se usa en la capa de navegación —barra de CTA de Entrenar y
 * cápsula de descanso—, nunca sobre contenido ni vidrio sobre vidrio.
 *
 * `isLiquidGlassAvailable()` es la única puerta: en iOS 26 devuelve true (y ya contempla que el
 * usuario haya limitado el efecto), en iOS viejo y en Android devuelve false sin tocar nativo.
 */
export default function GlassSurface({ tint, interactive, style, children }: Props) {
  const theme = useChartTheme()

  if (!isLiquidGlassAvailable()) {
    return (
      <View style={[styles.base, styles.fallback, shadow.floating, outline, style]}>
        {children}
      </View>
    )
  }
  return (
    // `tintColor` es un string CSS del lado nativo: va el hex de `chartTheme`, no el PlatformColor.
    <GlassView
      glassEffectStyle="regular"
      isInteractive={interactive}
      style={[styles.base, style]}
      tintColor={tint ? theme.tint : undefined}
    >
      {children}
    </GlassView>
  )
}
