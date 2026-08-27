import { Canvas, Group, RoundedRect, type Transforms3d } from '@shopify/react-native-skia'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { AccessibilityInfo, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  type SharedValue,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { plural, t } from '@/i18n'
import Badge from './Badge'
import { MAX_PARTICLES, type Particle, particles } from './confetti'
import { Ease, Enter, MotionPolicy, Timing, useReducedMotion } from './motion'
import Text from './Text'
import { colors, outline, radius, shadow, spacing } from './tokens'

type CelebrationOptions = {
  title: string
  /** Segunda línea. Sin ella la tarjeta es solo el título y la pastilla. */
  subtitle?: string
  /** Récords de la sesión: 0 esconde la pastilla. */
  prs: number
}
type Item = CelebrationOptions & { id: number }

/** Techo de una celebración (§7.1). Al cumplirse se desmonta sola. */
const LIFE_MS = 900
const LIFE = { duration: LIFE_MS, easing: Ease.out }

/**
 * La tarjeta entra con `Enter.rise` salvo con reduce-motion, que se lleva el movimiento pero NO el
 * cross-fade (§7.6): sin él la celebración es un corte seco. Por eso las dos van con la política
 * `data` y la salida es la única para las dos ramas. Instancias de módulo que nadie encadena, igual
 * que `Enter`/`Exit`.
 */
const CARD_IN = FadeIn.duration(Timing.base.duration)
  .easing(Ease.out)
  .reduceMotion(MotionPolicy.data)
const CARD_OUT = FadeOut.duration(Timing.fast.duration)
  .easing(Ease.out)
  .reduceMotion(MotionPolicy.data)

/** Gravedad en radios por t², y giro proporcional a la velocidad horizontal (≈ ¾ de vuelta). */
const GRAVITY = 1.2
const SPIN = 5
/** El burst ocupa ~media pantalla; los papelitos que se van por el borde se van, así es el papel. */
const RADIUS_RATIO = 0.42
/** Se apagan en el último tercio: sin esto el Canvas desaparecería de golpe con todo puesto. */
const FADE_FROM = 0.65

// Una celebración a la vez, con el estado en el módulo para que `show` sea llamable desde cualquier
// pantalla sin pasar por props (mismo patrón que `ui/Toast`).
let seq = 0
let visible: Item | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function clear(id: number) {
  if (visible?.id !== id) return // ya la reemplazó otra celebración
  visible = null
  emit()
}

export const celebration = {
  show(options: CelebrationOptions): void {
    seq += 1
    visible = { ...options, id: seq }
    emit()
  },
}

function prsLabel(n: number): string {
  return plural(n, t('celebration.prs.one', { n }), t('celebration.prs.other', { n }))
}

/** La tarjeta es UN elemento accesible: esto es lo único que se lee (y se anuncia). */
function announce(item: Item): string {
  return [item.title, item.subtitle, item.prs > 0 ? prsLabel(item.prs) : '']
    .filter(Boolean)
    .join('. ')
}

const styles = StyleSheet.create({
  host: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  card: {
    ...shadow.lifted,
    ...outline,
    alignItems: 'center',
    backgroundColor: colors.secondaryGroupedBackground,
    borderCurve: 'continuous',
    borderRadius: radius.xxl,
    gap: spacing[2],
    marginHorizontal: spacing[5],
    maxWidth: 340,
    padding: spacing[5],
  },
  centered: { textAlign: 'center' },
})

/**
 * Un papelito. Un solo `useDerivedValue` por partícula, y la opacidad compartida en el `Group` de
 * arriba: es la misma curva para los 32, no hace falta calcularla 32 veces por frame.
 */
function Flake({
  cx,
  cy,
  life,
  p,
  r,
}: {
  cx: number
  cy: number
  life: SharedValue<number>
  p: Particle
  r: number
}) {
  const transform = useDerivedValue<Transforms3d>(() => {
    const at = life.get()
    return [
      { translateX: cx + (p.x0 + p.vx * at) * r },
      { translateY: cy + (p.y0 + p.vy * at + GRAVITY * at * at) * r },
      // Después de trasladar: gira sobre su propio centro, que es de donde está corrido el rect.
      { rotate: p.vx * at * SPIN },
    ]
  })

  return (
    <RoundedRect
      color={`hsl(${p.hue},90%,62%)`}
      height={p.size}
      r={1.5}
      transform={transform}
      width={p.size}
      x={-p.size / 2}
      y={-p.size / 2}
    />
  )
}

/**
 * Tier 3 de la celebración (§7.5): la que se gana el confetti, una vez por entrenamiento terminado.
 * Vive en el layout raíz y no en la sesión a propósito — la pantalla que la dispara se va con el
 * `router.back()` del mismo bloque, y una celebración que se muere con su pantalla no se ve.
 *
 * Se monta una sola vez, después de `ToastHost`. El host queda siempre montado (una View vacía) para
 * que la salida de la tarjeta llegue a correr: si desapareciera el padre, `exiting` no anima nada.
 */
export function CelebrationHost() {
  const item = useSyncExternalStore(subscribe, () => visible)
  const reduced = useReducedMotion()
  const { height, width } = useWindowDimensions()
  const life = useSharedValue(0)
  const flakes = useMemo(() => (item ? particles(item.id, MAX_PARTICLES) : []), [item])

  useEffect(() => {
    if (!item) return
    const id = item.id
    // Vuelve a 0 en vez de seguir desde donde estaba: el burst es un disparo, no un estado, y dos
    // celebraciones seguidas tienen que salir las dos desde el centro.
    life.set(0)
    if (!reduced) life.set(withTiming(1, LIFE))
    // `accessibilityLiveRegion` es solo de Android y con 900 ms de vida no está garantizado que
    // llegue a dispararse: el anuncio a mano es el que asegura que se escuche (ídem `ui/Toast`).
    AccessibilityInfo.announceForAccessibility(announce(item))
    const timer = setTimeout(() => clear(id), LIFE_MS)
    return () => clearTimeout(timer)
  }, [item, life, reduced])

  const fade = useDerivedValue(() =>
    interpolate(life.get(), [FADE_FROM, 1], [1, 0], Extrapolation.CLAMP),
  )

  const r = Math.min(width, height) * RADIUS_RATIO

  return (
    // `pointerEvents="none"`: la celebración no bloquea nada, ni el back ni lo que quedó abajo.
    <View pointerEvents="none" style={styles.host}>
      {item ? (
        <>
          {reduced ? null : (
            <Canvas style={StyleSheet.absoluteFill}>
              <Group opacity={fade}>
                {flakes.map((p, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: la lista se monta y se desmonta entera y nunca se reordena
                  <Flake cx={width / 2} cy={height / 2} key={i} life={life} p={p} r={r} />
                ))}
              </Group>
            </Canvas>
          )}
          <Animated.View
            accessible
            accessibilityLabel={announce(item)}
            accessibilityLiveRegion="polite"
            entering={reduced ? CARD_IN : Enter.rise}
            exiting={CARD_OUT}
            style={styles.card}
          >
            <Text role="titleEmphasized" style={styles.centered}>
              {item.title}
            </Text>
            {item.subtitle ? (
              <Text color="secondary" role="callout" style={styles.centered}>
                {item.subtitle}
              </Text>
            ) : null}
            {item.prs > 0 ? <Badge label={prsLabel(item.prs)} size="md" tone="tint" /> : null}
          </Animated.View>
        </>
      ) : null}
    </View>
  )
}
