import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'
import type { Field, NumKey } from '@/db/types'
import { locale, t } from '@/i18n'
import type { Unit } from '@/lib/units'
import GradientSurface from './GradientSurface'
import { Spring } from './motion'
import Text from './Text'
import { colors, Press, radius, shadow, spacing } from './tokens'

type Props = {
  field: Field
  unit: Unit
  /** Paso de −/+ ya formateado ('2,5', '1'). `null` esconde las dos teclas. */
  incrementLabel: string | null
  isLast: boolean
  onKey: (k: NumKey) => void
}

const KEY_HEIGHT = 48
const GAP = spacing[2]
// Una tecla se confirma al soltar, tarde lo que tarde: el default de RNGH (500 ms) cancelaría el tap
// si apoyás el dedo. Lo que sí cancela es alejarse de la tecla.
const HOLD_MS = 60_000
const SLIDE_OFF = 48
const DECIMAL_SEPARATOR = locale === 'es' ? ',' : '.'

const styles = StyleSheet.create({
  pad: {
    // El fondo del teclado es el agrupado y no `background`: las teclas de dígito son la superficie
    // clara de arriba (§12.3) y sobre blanco no se separarían.
    backgroundColor: colors.groupedBackground,
    borderTopColor: colors.separator,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: GAP,
    paddingHorizontal: spacing[2],
    paddingTop: spacing[2],
  },
  row: { flexDirection: 'row', gap: GAP },
  key: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderCurve: 'continuous',
    flex: 1,
    justifyContent: 'center',
    minHeight: KEY_HEIGHT,
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[2],
  },
  digit: { backgroundColor: colors.secondaryGroupedBackground, ...shadow.card },
  fn: { backgroundColor: colors.fill },
  // El degradado se dibuja adentro y lo recorta el radio de la tecla.
  accent: { overflow: 'hidden' },
  onAccent: { color: colors.onTint },
  spacer: { flex: 1, minHeight: KEY_HEIGHT },
})

type KeyProps = {
  k: NumKey
  label?: string
  /** Dígito: tipografía grande y superficie propia. Las funciones van en `fill`. */
  big?: boolean
  sf?: string
  md?: string
  a11y: string
  accent?: boolean
  onKey: (k: NumKey) => void
}

/**
 * `Gesture.Tap` y no Pressable: el numpad vive fuera del scroll, así que no hay `delaysContentTouches`
 * que respetar y el feedback entra en el primer frame (plan §5.5). Sin háptico y sin animar el valor.
 */
function Key({ k, label, big, sf, md, a11y, accent, onKey }: KeyProps) {
  const pressed = useSharedValue(1)
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: pressed.get() }] }))
  // Sin useMemo a propósito: el gesto se recrea en cada render para que el worklet no capture un
  // `onKey` viejo. GestureDetector actualiza la config en el lugar, no re-monta el handler.
  const tap = Gesture.Tap()
    .maxDuration(HOLD_MS)
    .maxDistance(SLIDE_OFF)
    .onBegin(() => {
      pressed.set(withSpring(Press.key, Spring.press))
    })
    .onEnd(() => {
      scheduleOnRN(onKey, k)
    })
    .onFinalize(() => {
      pressed.set(withSpring(1, Spring.press))
    })

  const text = (
    <Text
      numberOfLines={1}
      role={big ? 'title' : 'headline'}
      style={accent ? styles.onAccent : undefined}
      tabular
    >
      {label}
    </Text>
  )

  return (
    <GestureDetector gesture={tap}>
      <Animated.View
        accessibilityLabel={a11y}
        accessibilityRole="button"
        accessible
        // VoiceOver activa con un tap sintético que no siempre llega al gesto nativo.
        onAccessibilityTap={() => onKey(k)}
        style={[styles.key, big ? styles.digit : styles.fn, accent && styles.accent, animated]}
      >
        {accent ? <GradientSurface style={StyleSheet.absoluteFill} /> : null}
        {sf ? (
          <SymbolView
            fallback={text}
            name={{ ios: sf as SFSymbol, android: md as AndroidSymbol }}
            size={22}
            tintColor={accent ? colors.onTint : colors.label}
          />
        ) : (
          text
        )}
      </Animated.View>
    </GestureDetector>
  )
}

const Spacer = () => <View style={styles.spacer} />

const DIGITS: NumKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
]

export default function NumPad({ field, unit, incrementLabel, isLast, onKey }: Props) {
  const insets = useSafeAreaInsets()
  const decimals = field === 'weight' || field === 'distance'
  const plates = field === 'weight'
  const unitLabel = t(unit === 'kg' ? 'session.kg' : 'session.lb')
  const stepLabel =
    incrementLabel === null
      ? null
      : field === 'weight'
        ? `${incrementLabel} ${unitLabel}`
        : incrementLabel

  return (
    <View style={[styles.pad, { paddingBottom: Math.max(insets.bottom, spacing[2]) }]}>
      {DIGITS.map((digits, row) => (
        <View key={digits[0]} style={styles.row}>
          {digits.map((d) => (
            <Key a11y={d} big k={d} key={d} label={d} onKey={onKey} />
          ))}
          {row === 0 ? (
            <Key
              a11y={t('common.delete')}
              k="backspace"
              label="⌫"
              md="backspace"
              onKey={onKey}
              sf="delete.left"
            />
          ) : stepLabel === null ? (
            <Spacer />
          ) : (
            <Key
              a11y={`${row === 1 ? '−' : '+'} ${stepLabel}`}
              k={row === 1 ? 'minus' : 'plus'}
              label={`${row === 1 ? '−' : '+'}${incrementLabel}`}
              onKey={onKey}
            />
          )}
        </View>
      ))}
      <View style={styles.row}>
        {decimals ? (
          <Key a11y={DECIMAL_SEPARATOR} big k="." label={DECIMAL_SEPARATOR} onKey={onKey} />
        ) : (
          <Spacer />
        )}
        <Key a11y="0" big k="0" label="0" onKey={onKey} />
        {plates ? (
          <Key
            a11y={t('plates.title')}
            k="plates"
            label="≡"
            md="monitor_weight"
            onKey={onKey}
            sf="scalemass"
          />
        ) : (
          <Spacer />
        )}
        <Key
          a11y={isLast ? t('session.done') : t('session.next')}
          accent
          k={isLast ? 'done' : 'next'}
          label={isLast ? '✓' : '→'}
          md={isLast ? 'check' : 'arrow_forward'}
          onKey={onKey}
          sf={isLast ? 'checkmark' : 'arrow.right'}
        />
      </View>
    </View>
  )
}
