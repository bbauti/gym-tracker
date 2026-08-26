import { type ReactNode, useState } from 'react'
import {
  type Insets,
  type LayoutChangeEvent,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { Spring } from './motion'
import { MIN_TARGET } from './tokens'

const ZERO: Insets = { top: 0, bottom: 0, left: 0, right: 0 }

type Props = Omit<PressableProps, 'style' | 'children'> & {
  scale?: number
  style?: StyleProp<ViewStyle>
  children?: ReactNode
}

export default function PressableScale({
  scale = 0.96,
  style,
  children,
  hitSlop,
  onPressIn,
  onPressOut,
  onLayout,
  ...rest
}: Props) {
  const pressed = useSharedValue(1)
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
        onPressIn?.(e)
      }}
      onPressOut={(e) => {
        pressed.set(withSpring(1, Spring.press))
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
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </Pressable>
  )
}
