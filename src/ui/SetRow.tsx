import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import type { SetRow as Row } from '@/db/queries/session'
import type { SetKind } from '@/db/schema'
import type { Field } from '@/db/types'
import { type Locale, t } from '@/i18n'
import type { PrKind } from '@/lib/prs'
import { formatDuration, formatWeight, gToUnit, type Unit } from '@/lib/units'
import { Spring, Timing } from './motion'
import PrBadge, { prKindsLabel } from './PrBadge'
import PressableScale from './PressableScale'
import Text from './Text'
import { colors, opacity, Press, radius, spacing } from './tokens'

type Props = {
  index: number
  set: Row
  prev: Row | null
  fields: Field[]
  showRpe: 'rpe' | 'rir' | 'none'
  unit: Unit
  locale: Locale
  focused: Field | null
  draft: string
  /** Qué récords rompió, si se rompieron en esta pantalla. Vacío = solo se sabe que hubo (H05). */
  prKinds: PrKind[]
  /** Sube al volver del background: no se lee, solo re-dispara el efecto de abajo (ver la pantalla). */
  resumeKey: number
  /** `pageY` = dónde cayó el dedo: la pantalla lo usa para subir la fila por encima del numpad. */
  onFocus: (f: Field, pageY: number) => void
  /** `pageY` = dónde cayó el dedo: si la serie no se puede completar, la pantalla enfoca las reps. */
  onComplete: (pageY: number) => void
  onKindPress: () => void
}

/** Anchos compartidos con la fila de encabezados de la card. */
// Las celdas van justas: "55.12" a 17 pt son ~47 pt y con la columna previa a 1.4 y el check a 64
// se truncaba en un iPhone 16 Pro / Pixel 9.
export const SET_COLUMNS = { badge: 34, prevFlex: 1.2, cellFlex: 1, check: 56 } as const

const ROW_HEIGHT = 56
const EMPTY = '–'

/** Letra por tipo de serie: la normal muestra el número. Independiente del idioma a propósito. */
const KIND_BADGE: Record<SetKind, string | null> = {
  normal: null,
  warmup: 'W',
  drop: 'D',
  failure: 'F',
  amrap: 'A',
  rest_pause: 'RP',
  giant: 'G',
}

const formatters = new Map<Locale, Intl.NumberFormat>()
function nf(locale: Locale) {
  let f = formatters.get(locale)
  if (!f) {
    f = new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-US', { maximumFractionDigits: 2 })
    formatters.set(locale, f)
  }
  return f
}

/** El número que se edita en ese campo: kg/lb, reps, segundos, metros, rpe, rir. */
export function fieldNumber(field: Field, set: Row | null, unit: Unit): number | null {
  if (!set) return null
  switch (field) {
    case 'weight':
      return set.weightG === null ? null : Math.round(gToUnit(set.weightG, unit) * 100) / 100
    case 'reps':
      return set.reps
    case 'duration':
      return set.durationMs === null ? null : Math.round(set.durationMs / 1000)
    case 'distance':
      return set.distanceMm === null ? null : Math.round(set.distanceMm / 10) / 100
    case 'rpe':
      return set.rpe
    case 'rir':
      return set.rir
  }
}

export function hasValue(field: Field, set: Row): boolean {
  return fieldNumber(field, set, 'kg') !== null
}

/** Lo que se muestra en la celda. Peso y duración con su formato; el resto, número pelado. */
function formatField(field: Field, set: Row | null, unit: Unit, locale: Locale): string | null {
  if (!set) return null
  if (field === 'weight')
    return set.weightG === null
      ? null
      : formatWeight(set.weightG, unit, locale, { withUnit: false })
  if (field === 'duration') return set.durationMs === null ? null : formatDuration(set.durationMs)
  const n = fieldNumber(field, set, unit)
  return n === null ? null : nf(locale).format(n)
}

/** El objetivo de repeticiones que trajo el día de rutina (D06): "8–12", o "10" si es uno solo. */
function targetReps(set: Row): string | null {
  const { targetRepsMin: min, targetRepsMax: max } = set
  if (min === null && max === null) return null
  if (min !== null && max !== null && min !== max) return `${min}–${max}`
  return String(min ?? max)
}

/**
 * Lo terciario de la celda cuando no hay valor real ni draft. Precedencia: sugerido (§2.2, la app
 * sugiere y el tilde confirma) > lo de la vez anterior > el objetivo del día, que es el único que
 * NO se confirma solo: completar sin repeticiones lo rebota (ver la pantalla).
 */
function ghostOf(
  field: Field,
  set: Row,
  prev: Row | null,
  unit: Unit,
  locale: Locale,
): string | null {
  if (field === 'weight' && set.suggestedWeightG !== null)
    return formatWeight(set.suggestedWeightG, unit, locale, { withUnit: false })
  if (field === 'reps' && set.suggestedReps !== null) return nf(locale).format(set.suggestedReps)
  const previous = formatField(field, prev, unit, locale)
  if (previous !== null) return previous
  return field === 'reps' ? targetReps(set) : null
}

/**
 * El mismo fantasma en número: de ahí arrancan ± y backspace en el numpad.
 *
 * Un rango no tiene un número solo, así que el objetivo entra por su mínimo: con "8–12" en fantasma,
 * + da 9 y no 1. Esto NO lo aplica — es la base de una tecla que el dedo apretó, y lo que quede en
 * la celda se sigue confirmando con el tilde (§2.2).
 */
export function ghostNumber(field: Field, set: Row, prev: Row | null, unit: Unit): number | null {
  if (field === 'weight' && set.suggestedWeightG !== null)
    return Math.round(gToUnit(set.suggestedWeightG, unit) * 100) / 100
  if (field === 'reps' && set.suggestedReps !== null) return set.suggestedReps
  const previous = fieldNumber(field, prev, unit)
  if (previous !== null) return previous
  return field === 'reps' ? (set.targetRepsMin ?? set.targetRepsMax) : null
}

export function fieldLabel(field: Field, unit: Unit): string {
  return field === 'weight' ? t(unit === 'kg' ? 'session.kg' : 'session.lb') : t(`session.${field}`)
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing[1],
    minHeight: ROW_HEIGHT,
  },
  tint: { backgroundColor: colors.tint, borderRadius: radius.sm },
  // El badge del récord va DENTRO de esta columna, debajo del número, y no al lado: el ancho lo
  // comparte la fila de encabezados, así que una pastilla en línea correría las celdas de esa fila
  // sola y las columnas dejarían de alinear. Apilado entra en los 44 pt sin estirar la fila.
  badge: {
    alignItems: 'center',
    gap: spacing[1],
    justifyContent: 'center',
    minHeight: 44,
    width: SET_COLUMNS.badge,
  },
  prev: { flex: SET_COLUMNS.prevFlex, textAlign: 'center' },
  // PressableScale aplica `style` a su vista interna, así que el flex del layout va en un slot
  // externo: si no, la celda se mide por su contenido y las columnas dejan de alinear.
  slot: { flex: SET_COLUMNS.cellFlex },
  cell: {
    alignItems: 'center',
    // El borde va siempre puesto y transparente: al enfocar solo cambia el color, así el número no
    // se corre un pelo cuando aparece el hairline.
    borderColor: 'transparent',
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing[1] / 2,
  },
  cellFocused: { backgroundColor: colors.fill, borderColor: colors.tint },
  check: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: ROW_HEIGHT,
    width: SET_COLUMNS.check,
  },
  box: {
    alignItems: 'center',
    borderColor: colors.separator,
    borderRadius: 8,
    borderWidth: 1.5,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  fill: { backgroundColor: colors.tint, borderRadius: 7 },
  onFill: { color: colors.onTint },
})

type CellProps = {
  index: number
  field: Field
  set: Row
  prev: Row | null
  unit: Unit
  locale: Locale
  focused: boolean
  draft: string
  onFocus: (f: Field, pageY: number) => void
}

function Cell({ index, field, set, prev, unit, locale, focused, draft, onFocus }: CellProps) {
  const own = formatField(field, set, unit, locale)
  const ghost = own === null ? ghostOf(field, set, prev, unit, locale) : null
  // El draft se escribe con punto y se muestra con el separador del idioma.
  const typed = locale === 'es' ? draft.replace('.', ',') : draft
  const shown = focused && draft !== '' ? typed : (own ?? ghost ?? EMPTY)
  const tone = focused ? 'tint' : own !== null ? 'primary' : 'tertiary'
  // El objetivo se lee como objetivo: en fantasma la celda dice "8–12" a secas y el lector no
  // aclararía qué es ese número. Si la celda ya está mostrando el rango, el aviso lo reemplaza en
  // vez de repetirlo. Solo el rango: un objetivo de un número suelto se lee como cualquier valor.
  const { targetRepsMin: min, targetRepsMax: max } = set
  const range = field === 'reps' ? targetReps(set) : null
  const hint =
    min !== null && max !== null && min !== max && range !== null
      ? t('session.targetHint', { max, min })
      : null
  // El fantasma se ve igual pero no se lee igual: en pantalla el gris ya dice "esto todavía no es
  // tuyo" y el lector no tiene gris, así que ahí lo decimos con palabras. Solo en el anuncio.
  // `ghost` ya implica que no hay valor propio; falta descartar el draft, que pisa la celda.
  const isGhost = ghost !== null && !(focused && draft !== '')
  const announced = isGhost ? t('session.suggested', { value: shown }) : shown
  const value = hint === null ? announced : shown === range ? hint : `${announced}, ${hint}`

  return (
    <View style={styles.slot}>
      <PressableScale
        // Sin el número la card entera suena a cinco "kg" iguales y no se sabe qué fila se edita.
        accessibilityLabel={`${index + 1}. ${fieldLabel(field, unit)}`}
        accessibilityState={{ selected: focused }}
        accessibilityValue={{ text: value }}
        onPress={(e) => onFocus(field, e.nativeEvent.pageY)}
        scale={Press.cell}
        style={[styles.cell, focused && styles.cellFocused]}
      >
        <Text color={tone} numberOfLines={1} role="body" tabular>
          {shown}
        </Text>
      </PressableScale>
    </View>
  )
}

export default function SetRow({
  index,
  set,
  prev,
  fields,
  showRpe,
  unit,
  locale,
  focused,
  draft,
  prKinds,
  resumeKey,
  onFocus,
  onComplete,
  onKindPress,
}: Props) {
  const done = set.completedAt !== null
  // ponytail: el check no usa `FadeIn(150)` sino un shared value con Timing.fast (140 ms, ease-out).
  // FadeIn es una entering animation y dispararía en las 20 filas al abrir una sesión vieja.
  // Techo: la animación de completar es 10 ms más corta que la del contrato.
  const fill = useSharedValue(done ? 1 : 0)
  const mark = useSharedValue(done ? 1 : 0)

  // `resumeKey` está en las deps y no en el cuerpo a propósito: una animación que arrancó con la app
  // en background nunca progresó (el diálogo de permisos de Android es otra Activity), así que la
  // serie quedaba completada en la base y el tilde sin llenar. Al volver, esto vuelve a apuntar los
  // shared values al mismo target: si ya llegaron, no se ve nada.
  // biome-ignore lint/correctness/useExhaustiveDependencies: el efecto reacciona a `resumeKey`, no lo lee
  useEffect(() => {
    fill.set(withSpring(done ? 1 : 0, Spring.press))
    mark.set(withTiming(done ? 1 : 0, Timing.fast))
  }, [done, fill, mark, resumeKey])

  const fillStyle = useAnimatedStyle(() => ({
    opacity: fill.get(),
    transform: [{ scale: 0.8 + 0.2 * fill.get() }],
  }))
  const markStyle = useAnimatedStyle(() => ({ opacity: mark.get() }))
  const tintStyle = useAnimatedStyle(() => ({ opacity: mark.get() * opacity.wash }))

  const badge = KIND_BADGE[set.kind] ?? String(index + 1)
  // El récord entra solo cuando pasa ACÁ: una serie que ya venía con récord (abrir una sesión vieja,
  // o la card que vuelve con Deshacer) monta la pastilla puesta. Mismo motivo que el tilde de arriba.
  const [prAtMount] = useState(set.isPr)
  // Peso corporal es un peso más para los récords (más dominadas es récord), pero "Reps a 0 kg" no
  // se lee: ahí el nombre del equipo dice lo mismo y ya está traducido.
  const prWeight = !set.isPr
    ? ''
    : set.weightG
      ? formatWeight(set.weightG, unit, locale)
      : t('equipment.bodyweight')
  const kindLabel = `${index + 1}. ${t(`setKind.${set.kind}`)}`
  const extra = showRpe === 'none' ? null : showRpe
  const ghostSummary = prev
    ? fields.map((f) => formatField(f, prev, unit, locale) ?? EMPTY).join(' × ')
    : EMPTY

  return (
    <View style={styles.row}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.tint, tintStyle]}
      />
      {/* La pastilla queda dentro del pressable a propósito: iOS lee un elemento accesible entero,
          así que el récord se anuncia en el mismo barrido que el número en vez de robar una parada. */}
      <PressableScale
        accessibilityLabel={
          set.isPr
            ? `${kindLabel}, ${t('pr.badge')}: ${prKinds.length === 0 ? t('pr.new') : prKindsLabel(prKinds, prWeight)}`
            : kindLabel
        }
        onPress={onKindPress}
        style={styles.badge}
      >
        <Text color={set.kind === 'normal' ? 'secondary' : 'tint'} role="footnote" tabular>
          {badge}
        </Text>
        {set.isPr ? (
          <PrBadge animate={!prAtMount} kinds={prKinds} resumeKey={resumeKey} weight={prWeight} />
        ) : null}
      </PressableScale>
      <Text color="tertiary" numberOfLines={1} role="footnote" style={styles.prev} tabular>
        {ghostSummary}
      </Text>
      {fields.map((f) => (
        <Cell
          draft={draft}
          field={f}
          focused={focused === f}
          index={index}
          key={f}
          locale={locale}
          onFocus={onFocus}
          prev={prev}
          set={set}
          unit={unit}
        />
      ))}
      {extra ? (
        <Cell
          draft={draft}
          field={extra}
          focused={focused === extra}
          index={index}
          locale={locale}
          onFocus={onFocus}
          prev={prev}
          set={set}
          unit={unit}
        />
      ) : null}
      <PressableScale
        accessibilityLabel={`${index + 1}. ${t('session.completeSet')}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        onPress={(e) => onComplete(e.nativeEvent.pageY)}
        style={styles.check}
      >
        <View style={styles.box}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.fill, fillStyle]} />
          <Animated.View style={markStyle}>
            <SymbolView
              fallback={
                <Text maxFontSizeMultiplier={1} role="footnote" style={styles.onFill}>
                  ✓
                </Text>
              }
              name={{ ios: 'checkmark' as SFSymbol, android: 'check' as AndroidSymbol }}
              size={16}
              tintColor={colors.onTint}
            />
          </Animated.View>
        </View>
      </PressableScale>
    </View>
  )
}
