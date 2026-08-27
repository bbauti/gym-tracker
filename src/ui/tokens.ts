import { type ColorValue, Platform, PlatformColor, StyleSheet, type ViewStyle } from 'react-native'

// ponytail: Android usa attrs del tema donde el attr es un <color> plano y hex fijos donde no.
// `?android:attr/textColor*` NO sirve: son ColorStateList y `resolveThemeAttribute` devuelve
// `outValue.data` sin chequear el tipo (ColorPropConverter.kt:213) → sale un índice del string pool
// como ARGB (alpha 0 = invisible). `@color/*` sí: `resolveResource` hace
// `getIdentifier(name, 'color', pkg)` + `ResourcesCompat.getColor(res, id, theme)` (:186-188), que
// respeta qualifiers (-night, -v31) y alias. De ahí sale el tint dinámico (L06):
// `plugins/withDynamicColor.js` escribe `colors_tint.xml` en las cuatro variantes (tint/on_tint y el
// par de superficies `surface_high`/`surface_low`), y no es opcional — sin el recurso, `getColor`
// tira NotFoundException y el PlatformColor queda sin resolver: cada color nuevo de Android que
// salga de ahí pide un prebuild.
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
  // La superficie de una card. En Android es la mitad baja del par tonal M3 y no
  // `?android:attr/colorBackgroundFloating`: con dynamic color el attr del tema no se tiñe y la card
  // quedaría de otro palo que su propio inset, que sí sale del par.
  secondaryGroupedBackground: color(
    'secondarySystemGroupedBackground',
    '@color/surface_low',
    '#FFFFFF',
  ),
  // La superficie de un bloque metido ADENTRO de una card (`Card variant="inset"`): en light baja un
  // tono, en dark sube uno. Es la mitad alta del mismo par.
  tertiaryGroupedBackground: color(
    'tertiarySystemGroupedBackground',
    '@color/surface_high',
    '#F2F2F7',
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
  // Segundo color del degradado (§12.3). Fijo en Android: el accent dinámico ya es `tint`, y un
  // segundo tono del wallpaper haría un degradado sin contraste entre stops.
  indigo: color('systemIndigo', null, '#5E5CE6'),
} satisfies Record<string, ColorValue>

export const spacing = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32 } as const

export const radius = { xs: 6, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, pill: 999 } as const

export const opacity = {
  wash: 0.14, // fondo tintado de una fila completada
  pressed: 0.1, // highlight de press
  outline: 0.18, // hairline de un tile
  dim: 0.7, // texto de apoyo sobre una superficie tintada
  disabled: 0.4,
  ghost: 0.5, // archivado, placeholder
} as const

// `boxShadow` (RN 0.86) no acepta `PlatformColor`: lo parsea como string CSS, así que el rgba va
// fijo. Android usa `elevation` en su lugar — con las dos puestas la sombra se dibuja dos veces.
const elevate = (boxShadow: string, elevation: number): ViewStyle =>
  Platform.select({ android: { elevation }, default: { boxShadow } })

export const shadow = {
  card: elevate('0px 2px 6px rgba(0,0,0,0.08)', 1),
  floating: elevate('0px 6px 16px rgba(0,0,0,0.12)', 4),
  lifted: elevate('0px 12px 28px rgba(0,0,0,0.18)', 8),
} satisfies Record<string, ViewStyle>

/** Le da borde al tile en dark, donde la sombra se pierde contra el fondo. Va junto a `shadow`. */
export const outline = {
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: `rgba(128,128,128,${opacity.outline})`,
} satisfies ViewStyle

/** Escalas de press por tipo de superficie: cuanto más chico el target, más se hunde. */
export const Press = {
  scale: 0.96, // botón, card
  row: 0.98, // fila de lista, ancha: 0.96 se lee como salto
  cell: 0.94, // celda de una serie
  key: 0.97, // tecla del numpad
  highlight: opacity.pressed,
} as const

/** Alto mínimo de un tile del bento (§12.4). Mínimo, nunca fijo: Dynamic Type crece. */
export const TILE = { sm: 132, md: 174, lg: 220 } as const

export const MIN_TARGET = 44
