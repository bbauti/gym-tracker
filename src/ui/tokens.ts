import { type ColorValue, Platform, PlatformColor } from 'react-native'

// ponytail: Android usa attrs del tema donde el attr es un <color> plano y hex fijos donde no.
// `?android:attr/textColor*` NO sirve: son ColorStateList y RN devuelve `outValue.data` sin chequear
// el tipo (ColorPropConverter.kt:212) → sale un índice del string pool como ARGB (alpha 0 = invisible).
// Techo: los grises secundarios y el tint no siguen el tema ni llegan a 4.5:1 en light y dark a la vez
// (matemáticamente imposible con un color fijo). Upgrade: @pchmn/expo-material3-theme en el primer
// checkpoint Android, o colors.xml + values-night vía config plugin.
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
  tint: color('systemBlue', null, '#0A84FF'),
  fill: color('systemFill', null, 'rgba(120,120,128,0.2)'),
  destructive: color('systemRed', null, '#FF3B30'),
  // Blanco fijo a propósito: es el color de lo que va ENCIMA de `tint` o `destructive`
  // (el check de una serie, la tecla de acento, el tacho del swipe), y esos dos son
  // suficientemente oscuros en light y en dark como para no necesitar variante.
  onTint: '#FFFFFF',
} satisfies Record<string, ColorValue>

export const spacing = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32 } as const

export const radius = { sm: 8, md: 12, lg: 16 } as const

export const MIN_TARGET = 44
