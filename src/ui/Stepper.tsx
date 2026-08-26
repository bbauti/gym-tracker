import { useEffect, useRef } from 'react'
import { type AccessibilityActionEvent, StyleSheet, View } from 'react-native'
import { haptic } from './haptics'
import PressableScale from './PressableScale'
import Text from './Text'
import { colors, MIN_TARGET, radius, spacing } from './tokens'

type Props = {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
  label: string
  /** Para valores que no se leen como número pelado ("—" cuando no hay RPE, "8,5" en es). */
  format?: (v: number) => string
  /**
   * Lo que dice el lector en vez de `format(value)`. Un guión en pantalla es "vacío"; leído en voz
   * alta es "raya" (o nada, según la verbosidad), y el valor sigue siendo el que usarían los ±.
   */
  a11yText?: string
}

/** Techo del contrato: 8 cambios por segundo. Más rápido no se alcanza a leer el número. */
const REPEAT_MS = 125
/** Un toque tiene que poder ser un toque: recién después de esto el mantener empieza a repetir. */
const HOLD_MS = 350

const ACTIONS = [{ name: 'increment' }, { name: 'decrement' }]

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing[2], minHeight: MIN_TARGET },
  label: { flex: 1 },
  button: {
    alignItems: 'center',
    backgroundColor: colors.fill,
    borderRadius: radius.sm,
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
    overflow: 'hidden',
  },
  disabled: { opacity: 0.4 },
  // Ancho fijo + tabular: el número cambia a 8/s y la fila no se puede mover con él.
  value: { minWidth: 56, textAlign: 'center' },
})

type ButtonProps = {
  disabled: boolean
  glyph: string
  label: string
  onPress: () => void
  onHold: () => void
  onRelease: () => void
}

function AdjustButton({ disabled, glyph, label, onPress, onHold, onRelease }: ButtonProps) {
  return (
    <PressableScale
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      // El primer cambio de un mantener sale de `onLongPress` (RN no dispara `onPress` después):
      // así el toque suelto sigue contando uno solo y el mantener no cuenta dos.
      delayLongPress={HOLD_MS}
      disabled={disabled}
      onLongPress={onHold}
      onPress={onPress}
      onPressOut={onRelease}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text color="tint" role="title">
        {glyph}
      </Text>
    </PressableScale>
  )
}

/**
 * Stepper ±: el número se toca, no se tipea (§5.4 — los campos numéricos nunca abren el teclado).
 * Mantener repite a 8/s como máximo, con un `setInterval` que se corta al soltar y al desmontar.
 */
export default function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  format,
  a11yText,
}: Props) {
  const lo = min ?? Number.NEGATIVE_INFINITY
  const hi = max ?? Number.POSITIVE_INFINITY

  // Lo que lee el repeat. Las props llegan un render tarde (el padre escribe en la db y vuelve por
  // useQuery, que difiere la invalidación un turno): a 8/s serían ocho veces el mismo número.
  const latest = useRef(value)
  // Y el handler por ref por lo mismo: el que capturó el `setInterval` al arrancar el repeat vería
  // el estado del padre congelado en ese frame durante todo el mantener.
  const handler = useRef(onChange)
  useEffect(() => {
    latest.current = value
    handler.current = onChange
  })

  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const stop = () => {
    if (timer.current === null) return
    clearInterval(timer.current)
    timer.current = null
  }
  // Soltar afuera del botón, un back con el dedo apoyado, una rotación: el intervalo se corta igual.
  // El cleanup no llama a `stop` (se redefine en cada render y sería una dep del efecto): el ref sí
  // es estable.
  useEffect(
    () => () => {
      if (timer.current !== null) clearInterval(timer.current)
    },
    [],
  )

  const bump = (dir: 1 | -1) => {
    // Dos decimales: con step 0.5 la suma flotante saca 7.999999999 y eso llegaría a la db.
    const next = Math.min(hi, Math.max(lo, Math.round((latest.current + dir * step) * 100) / 100))
    if (next === latest.current) {
      stop() // llegó al tope mientras repetía
      return
    }
    latest.current = next
    // El háptico va antes del write y en el mismo bloque (§7.1). El gate por evento (300 ms) hace
    // el resto: mantener no vibra ocho veces por segundo.
    haptic('selection')
    handler.current(next)
  }

  const hold = (dir: 1 | -1) => {
    bump(dir)
    stop()
    timer.current = setInterval(() => bump(dir), REPEAT_MS)
  }

  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') bump(1)
    else if (e.nativeEvent.actionName === 'decrement') bump(-1)
  }

  const display = format ? format(value) : String(value)

  return (
    // Un solo elemento accesible con rol 'adjustable': VoiceOver lo ajusta con swipe arriba/abajo y
    // los dos botones dejan de ser paradas separadas del barrido.
    <View
      accessibilityActions={ACTIONS}
      accessibilityLabel={label}
      accessibilityRole="adjustable"
      accessibilityValue={{ max, min, now: value, text: a11yText ?? display }}
      accessible
      onAccessibilityAction={onAction}
      style={styles.row}
    >
      <Text numberOfLines={1} style={styles.label}>
        {label}
      </Text>
      <AdjustButton
        disabled={value <= lo}
        glyph="−"
        label={`${label}, −${step}`}
        onHold={() => hold(-1)}
        onPress={() => bump(-1)}
        onRelease={stop}
      />
      <Text role="headline" style={styles.value} tabular>
        {display}
      </Text>
      <AdjustButton
        disabled={value >= hi}
        glyph="+"
        label={`${label}, +${step}`}
        onHold={() => hold(1)}
        onPress={() => bump(1)}
        onRelease={stop}
      />
    </View>
  )
}
