import { GlassContainer, isLiquidGlassAvailable } from 'expo-glass-effect'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import Button from './Button'
import GlassSurface from './GlassSurface'
import GradientSurface from './GradientSurface'
import { MotionPolicy, Timing } from './motion'
import PressableScale from './PressableScale'
import Text from './Text'
import { colors, radius, spacing } from './tokens'

type Mode = 'start' | 'continue'

type Props = {
  primary: { title: string; onPress: () => void; sf?: string; md?: string }
  secondary?: { title: string; onPress: () => void }
  /** Con sesión abierta, `continue`. Cambiarlo CRUZA el rótulo del primario, no lo reemplaza. */
  mode: Mode
}

/** Igual que el hero de `Button`: la barra y el botón grande de una pantalla miden lo mismo. */
const HEIGHT = 56

const styles = StyleSheet.create({
  // `center` y no `stretch`: el secundario sin vidrio es un `Button` de 50 y estirarlo lo dejaría
  // pegado arriba; centrado, los dos comparten la línea media midan lo que midan.
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  grow: { flex: 1 },
  face: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: HEIGHT,
    paddingHorizontal: spacing[4],
    borderRadius: radius.pill,
    borderCurve: 'continuous',
  },
  // Sin alto fijo: los dos rótulos apilados crecen con Dynamic Type.
  labels: { flexShrink: 1, justifyContent: 'center' },
  ghost: { alignItems: 'center', justifyContent: 'center' },
  onTint: { color: colors.onTint },
  tinted: { color: colors.tint },
})

/**
 * La barra de acción de Entrenar (§12.3): en iOS 26 dos cápsulas de vidrio dentro de un
 * `GlassContainer` —la primaria tintada e interactiva, la de al lado sin tinte— y en el resto el
 * hero con degradado más un botón plano.
 *
 * No dispara hápticos a propósito: empezar un entrenamiento es `sessionStart` y tiene que salir en
 * el MISMO bloque que el `router.push` de la pantalla (§7.1), no acá.
 */
export default function GlassCTA({ primary, secondary, mode }: Props) {
  const glass = isLiquidGlassAvailable()
  const toContinue = mode === 'continue'
  const t = useSharedValue(toContinue ? 1 : 0)
  // Del primario llega solo el título del modo actual: el del otro modo se recuerda para poder
  // cruzarlos. Ajustar el estado en el render es el patrón de React para esto —no hay frame de más—
  // y corta solo, porque después de escribirlo la condición ya no se cumple.
  const [labels, setLabels] = useState({ start: primary.title, continue: primary.title })
  if (labels[mode] !== primary.title) setLabels((p) => ({ ...p, [mode]: primary.title }))

  useEffect(() => {
    // Sin reset previo: `t` sale de donde esté hacia el extremo del modo, así una ida y vuelta rápida
    // se ve continua en vez de saltar (§7.1, interrumpible).
    t.set(withTiming(toContinue ? 1 : 0, { ...Timing.sheet, reduceMotion: MotionPolicy.ui }))
  }, [toContinue, t])

  const front = useAnimatedStyle(() => ({ opacity: toContinue ? t.get() : 1 - t.get() }))
  const back = useAnimatedStyle(() => ({ opacity: toContinue ? 1 - t.get() : t.get() }))

  const face = (
    <>
      {primary.sf ? (
        <SymbolView
          fallback={null}
          name={{ ios: primary.sf as SFSymbol, android: primary.md as AndroidSymbol }}
          size={20}
          tintColor={colors.onTint}
        />
      ) : null}
      {/* Los dos rótulos quedan montados para cruzarse: fuera del árbol accesible, o en Android
          TalkBack para en el fantasma y lee "Empezar" con la barra diciendo "Continuar". */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.labels}
      >
        <Animated.View style={front}>
          <Text role="headline" style={styles.onTint}>
            {labels[mode]}
          </Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ghost, back]}>
          <Text role="headline" style={styles.onTint}>
            {labels[toContinue ? 'start' : 'continue']}
          </Text>
        </Animated.View>
      </View>
    </>
  )

  // El `flex` va en un wrapper: el `style` de PressableScale cae en su Animated.View interna, así que
  // puesto ahí el Pressable de afuera queda del ancho del rótulo en vez de tomar la fila.
  const cta = (
    <View style={styles.grow}>
      <PressableScale
        accessibilityLabel={primary.title}
        onPress={primary.onPress}
        style={styles.grow}
      >
        {glass ? (
          <GlassSurface interactive style={styles.face} tint>
            {face}
          </GlassSurface>
        ) : (
          <GradientSurface radius={radius.pill} style={styles.face}>
            {face}
          </GradientSurface>
        )}
      </PressableScale>
    </View>
  )

  // `Button` sirve para el secundario sin vidrio (mismo plano, mismo háptico: ninguno), pero no para
  // el primario: el rótulo que se cruza necesita dos capas y el hero de `Button` trae `buttonPrimary`.
  let aside = null
  if (secondary && glass) {
    aside = (
      <PressableScale accessibilityLabel={secondary.title} onPress={secondary.onPress}>
        <GlassSurface style={styles.face}>
          <Text role="headline" style={styles.tinted}>
            {secondary.title}
          </Text>
        </GlassSurface>
      </PressableScale>
    )
  } else if (secondary) {
    aside = <Button onPress={secondary.onPress} title={secondary.title} variant="plain" />
  }

  if (!glass) {
    return (
      <View style={styles.row}>
        {cta}
        {aside}
      </View>
    )
  }
  // `spacing` es la distancia a la que los dos vidrios empiezan a fundirse: la misma que el gap.
  return (
    <GlassContainer spacing={spacing[2]} style={styles.row}>
      {cta}
      {aside}
    </GlassContainer>
  )
}
