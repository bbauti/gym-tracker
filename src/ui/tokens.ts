import { type ColorValue, Platform, PlatformColor } from 'react-native'

// ponytail: Android usa attrs del tema donde el attr es un <color> plano y hex fijos donde no.
// `?android:attr/textColor*` NO sirve: son ColorStateList y `resolveThemeAttribute` devuelve
// `outValue.data` sin chequear el tipo (ColorPropConverter.kt:213) → sale un índice del string pool
// como ARGB (alpha 0 = invisible). `@color/*` sí: `resolveResource` hace
// `getIdentifier(name, 'color', pkg)` + `ResourcesCompat.getColor(res, id, theme)` (:186-188), que
// respeta qualifiers (-night, -v31) y alias. De ahí sale el tint dinámico (L06):
// `plugins/withDynamicColor.js` escribe `colors_tint.xml` en las cuatro variantes, y no es opcional —
// sin el recurso, `getColor` tira NotFoundException y el PlatformColor queda sin resolver.
// Techo: los grises secundarios siguen fijos — ni siguen el tema ni llegan a 4.5:1 en light y dark a
// la vez (imposible con un color fijo) — y adentro de Skia no entra ningún PlatformColor, esos van
// resueltos a mano en `chartTheme.ts`. Upgrade: @pchmn/expo-material3-theme si molesta.
const isIOS = Platform.OS === 'ios'
const isAndroid = Platform.OS === 'android'
const color = (ios: string, android: string | null, fallback: string): ColorValue =>
  isIOS ? PlatformColor(ios) : isAndroid && android ? PlatformColor(android) : fallback

export const colors = {
  label: color('label', '?android:attr/colorForeground', '#000000'),
  secondaryLabel: color('secondaryLabel', null, '#8E8E93'),
  tertiaryLabel: color('tertiaryLabel', null, '#AEAEB2'),
  background: color('systemBackground', '?android:attr/colorBackground', '#FFFFFF'),
  groupedBackground: color('systemGroupedBackground', '?android:attr/colorBackground', '#F2F2F7'),
  secondaryGroupedBackground: color(
    'secondarySystemGroupedBackground',
    '?android:attr/colorBackgroundFloating',
    '#FFFFFF',
  ),
  separator: color('separator', null, 'rgba(128,128,128,0.35)'),
  tint: color('systemBlue', '@color/tint', '#0A84FF'),
  fill: color('systemFill', null, 'rgba(120,120,128,0.2)'),
  destructive: color('systemRed', null, '#FF3B30'),
  // Semáforo de las bandas de volumen (E07): en el rango que rinde, en el techo, pasado.
  success: color('systemGreen', null, '#34C759'),
  warning: color('systemOrange', null, '#FF9500'),
  // Lo que va ENCIMA de `tint` o `destructive` (el check de una serie, la tecla de acento, el tacho
  // del swipe). En Android sale del mismo recurso que `tint` y por el mismo motivo: con dynamic
  // color en dark el accent es un tono claro, y el blanco encima sería ilegible.
  // Techo: `destructive` es un rojo fijo, así que ahí el par no es el de M3 — pero el tono 20 de
  // dark contrasta con ese rojo igual o mejor que el blanco que había antes.
  onTint: isAndroid ? PlatformColor('@color/on_tint') : '#FFFFFF',
} satisfies Record<string, ColorValue>

export const spacing = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32 } as const

export const radius = { sm: 8, md: 12, lg: 16 } as const

export const MIN_TARGET = 44
