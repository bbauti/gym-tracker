import { Canvas, LinearGradient, RoundedRect } from '@shopify/react-native-skia'
import { type ReactNode, useState } from 'react'
import {
  type LayoutChangeEvent,
  Platform,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native'
import { useChartTheme } from './chartTheme'
import { colors } from './tokens'

const isAndroid = Platform.OS === 'android'

/**
 * Android no pinta el azul→índigo de iOS: el fondo es `colors.tint` (el acento de Material You, que
 * sale del wallpaper) y encima va solo negro hasta 0,28. Así la superficie sigue teniendo volumen
 * diagonal sin tapar el color que eligió el sistema.
 */
const SHADE = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.28)']

type Props = {
  /**
   * Radio propio. Sin esto la superficie sale cuadrada, para el caso más común: un `absoluteFill`
   * adentro de un padre con `overflow: hidden`, que ya la recorta con SU radio (`Button` hero).
   */
  radius?: number
  style?: StyleProp<ViewStyle>
  children?: ReactNode
}

/**
 * La superficie del acento (§12.3): el degradado de `chartTheme` dibujado con Skia, con los hijos
 * arriba. Es la única que lo pinta — `Button` hero, la tecla de acento del NumPad y el CTA la usan
 * en vez de repetir el Canvas.
 *
 * ponytail: un `onLayout` con estado en vez de `onSize` + derived values. El tamaño cambia una vez
 * por layout (nunca por frame), así que un render extra sale más barato que tres worklets.
 */
export default function GradientSurface({ radius, style, children }: Props) {
  const theme = useChartTheme()
  const [size, setSize] = useState({ width: 0, height: 0 })

  const onLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const { width, height } = nativeEvent.layout
    setSize((p) => (p.width === width && p.height === height ? p : { width, height }))
  }

  return (
    <View
      onLayout={onLayout}
      style={[
        // Color plano abajo del Canvas: cubre el frame anterior a la primera medición y, en Android,
        // es el tint dinámico que el degradado solo oscurece.
        { backgroundColor: isAndroid ? colors.tint : theme.gradient[0] },
        radius === undefined
          ? null
          : { borderRadius: radius, borderCurve: 'continuous', overflow: 'hidden' },
        style,
      ]}
    >
      {size.width > 0 ? (
        <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
          <RoundedRect height={size.height} r={radius ?? 0} width={size.width} x={0} y={0}>
            <LinearGradient
              colors={isAndroid ? SHADE : theme.gradient}
              end={{ x: size.width, y: size.height }}
              start={{ x: 0, y: 0 }}
            />
          </RoundedRect>
        </Canvas>
      ) : null}
      {children}
    </View>
  )
}
