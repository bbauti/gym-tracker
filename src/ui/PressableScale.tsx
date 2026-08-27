import { type ReactNode, useState } from 'react'
import {
  type Insets,
  type LayoutChangeEvent,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from 'react-native'
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { Spring } from './motion'
import { colors, MIN_TARGET, Press } from './tokens'

const ZERO: Insets = { top: 0, bottom: 0, left: 0, right: 0 }

type Props = Omit<PressableProps, 'style' | 'children'> & {
  scale?: number
  /**
   * Capa de `colors.label` que se enciende con el press (§12.4). Va donde el hundido solo no se ve:
   * filas anchas, chips, teclas. Corre con el mismo `Spring.press` que la escala —no puede
   * desfasarse— pero con su propio valor, así que también ilumina con `scale: 1`.
   */
  highlight?: boolean
  style?: StyleProp<ViewStyle>
  children?: ReactNode
}

function Highlight({
  press,
  borderRadius,
}: {
  press: SharedValue<number>
  borderRadius: ViewStyle['borderRadius']
}) {
  // 0 en reposo, `Press.highlight` con el dedo apoyado.
  const wash = useAnimatedStyle(() => ({ opacity: press.get() * Press.highlight }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.label, borderRadius }, wash]}
    />
  )
}

export default function PressableScale({
  scale = Press.scale,
  highlight,
  style,
  children,
  hitSlop,
  onPressIn,
  onPressOut,
  onLayout,
  ...rest
}: Props) {
  const pressed = useSharedValue(1)
  const press = useSharedValue(0)
  // Arranca en cero para que el primer onLayout de un box ya >= 44 pt no dispare un render extra.
  const [auto, setAuto] = useState<Insets>(ZERO)
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: pressed.get() }] }))

  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      hitSlop={hitSlop ?? auto}
      onPressIn={(e) => {
        pressed.set(withSpring(scale, Spring.press))
        press.set(withSpring(1, Spring.press))
        onPressIn?.(e)
      }}
      onPressOut={(e) => {
        pressed.set(withSpring(1, Spring.press))
        press.set(withSpring(0, Spring.press))
        onPressOut?.(e)
      }}
      onLayout={(e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout
        const x = Math.max(0, (MIN_TARGET - width) / 2)
        const y = Math.max(0, (MIN_TARGET - height) / 2)
        setAuto((p) => (p.left === x && p.top === y ? p : { top: y, bottom: y, left: x, right: x }))
        onLayout?.(e)
      }}
    >
      <Animated.View style={[style, animated]}>
        {children}
        {highlight ? (
          <Highlight borderRadius={StyleSheet.flatten(style)?.borderRadius} press={press} />
        ) : null}
      </Animated.View>
    </Pressable>
  )
}
