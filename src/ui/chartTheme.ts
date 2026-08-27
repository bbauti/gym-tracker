import { useColorScheme } from 'react-native'

/**
 * Los colores que van adentro de un Canvas de Skia (heatmap, líneas del gráfico).
 *
 * `tokens.ts` devuelve `PlatformColor`, y Skia no lo entiende: su tipo `Color` es
 * `string | number | number[] | Float32Array` (skia/types/Color.ts), así que un token del sistema
 * llega como objeto opaco y se dibuja negro. Estos son los mismos colores resueltos a mano por
 * esquema, y son los únicos hex de la app.
 *
 * ponytail: dos ramas de `useColorScheme`, no un tema. Techo: no sigue "increase contrast" ni el
 * tinte del sistema en Android. Upgrade: leer los colores del tema con @pchmn/expo-material3-theme,
 * el mismo checkpoint que ya debe `tokens.ts`.
 *
 * El gris no es el `tertiaryLabel` (2,15:1 en light, invisible como trazo): es `#8E8E93`, que pasa
 * 3:1 contra las dos superficies y queda a ΔE 19,4 (protan) / 10,9 (tritan) del azul — la segunda
 * serie se distingue de la primera con daltonismo, no solo por el color.
 */
export type ChartTheme = {
  /** La serie que importa. */
  tint: string
  /** La serie de contexto: un gris, a propósito — es énfasis, no dos categorías. */
  muted: string
  /** El riel de una barra o la celda sin datos del heatmap. */
  track: string
  trackOpacity: number
  /**
   * Azul → índigo, los dos stops de `GradientSurface` y del relleno de `Sparkline` (§12.3). El
   * segundo no cambia por esquema: #5E5CE6 da 5:1 contra el blanco del CTA en light y en dark, así
   * que el texto encima se lee igual en los dos.
   */
  gradient: [string, string]
  /** El segundo acento, para la serie de contraste de un Ring. */
  indigo: string
  /** Semáforo de las bandas de volumen adentro del Canvas: el par de `colors.success/...`. */
  success: string
  warning: string
  destructive: string
}

const LIGHT: ChartTheme = {
  muted: '#8E8E93',
  tint: '#007AFF',
  track: '#787880',
  trackOpacity: 0.16,
  gradient: ['#007AFF', '#5E5CE6'],
  indigo: '#5856D6',
  success: '#34C759',
  warning: '#FF9500',
  destructive: '#FF3B30',
}

const DARK: ChartTheme = {
  muted: '#8E8E93',
  tint: '#0A84FF',
  track: '#787880',
  trackOpacity: 0.3,
  gradient: ['#0A84FF', '#5E5CE6'],
  indigo: '#5E5CE6',
  success: '#30D158',
  warning: '#FF9F0A',
  destructive: '#FF453A',
}

export function useChartTheme(): ChartTheme {
  return useColorScheme() === 'dark' ? DARK : LIGHT
}
