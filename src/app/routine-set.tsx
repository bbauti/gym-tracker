import { router, useLocalSearchParams } from 'expo-router'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getRoutineSet, updateRoutineSet } from '@/db/queries/routines'
import { SET_KINDS, type SetKind } from '@/db/schema'
import { locale, t } from '@/i18n'
import { haptic } from '@/ui/haptics'
import Menu from '@/ui/Menu'
import PressableScale from '@/ui/PressableScale'
import SheetHeader, { sheetStyles } from '@/ui/SheetHeader'
import Stepper from '@/ui/Stepper'
import Text from '@/ui/Text'
import { colors, MIN_TARGET, opacity, spacing } from '@/ui/tokens'

/** Rango de repeticiones que tiene sentido escribir a mano; arriba de 50 ya es otra cosa (D06). */
const REPS_LO = 1
const REPS_HI = 50
const REPS_MIN_FALLBACK = 8
const REPS_MAX_FALLBACK = 12
const RPE_LO = 5
const RPE_HI = 10
const RPE_STEP = 0.5
/** Primer toque de ± sobre un RPE vacío: un objetivo típico, no 5.5. */
const RPE_DEFAULT = 8

const KIND_ITEMS = SET_KINDS.map((k) => ({ key: k, label: t(`setKind.${k}`) }))

const rpeFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
const EMPTY = '—'

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing[2], minHeight: MIN_TARGET },
  rowLabel: { flex: 1 },
  grow: { flex: 1 },
  clear: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
  },
  disabled: { opacity: opacity.disabled },
})

/**
 * La serie objetivo de la rutina (D06): rango de reps, tipo y RPE. Es una plantilla, no un registro
 * — acá no se escribe peso ni nada que la app pueda "aplicar" después (§2.2).
 */
export default function RoutineSetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const setId = Number(id)
  const insets = useSafeAreaInsets()

  // Lectura de arranque, no suscripción: la hoja es el único que escribe esta fila mientras está
  // abierta, y refrescarla sola pisaría el valor que el dedo está subiendo.
  const [row] = useState(() => getRoutineSet(setId))
  const [repsMin, setRepsMin] = useState(row?.repsMin ?? REPS_MIN_FALLBACK)
  const [repsMax, setRepsMax] = useState(row?.repsMax ?? REPS_MAX_FALLBACK)
  const [kind, setKind] = useState<SetKind>(row?.kind ?? 'normal')
  const [rpe, setRpe] = useState<number | null>(row?.targetRpe ?? null)

  if (!row) return null

  // Se escribe en cada cambio: la hoja se cierra arrastrándola y ahí no hay dónde poner un "guardar".
  const changeMin = (v: number) => {
    // El máximo nunca queda por debajo del mínimo: subir el mínimo lo empuja.
    const nextMax = Math.max(v, repsMax)
    setRepsMin(v)
    setRepsMax(nextMax)
    updateRoutineSet(setId, { repsMax: nextMax, repsMin: v })
  }

  const changeMax = (v: number) => {
    setRepsMax(v)
    updateRoutineSet(setId, { repsMax: v })
  }

  const changeKind = (key: string) => {
    // Cambiar en un picker suena distinto de apretar un botón (§12.6). Es el mismo evento que
    // dispara `Menu`, y el gate por evento no lo deja sonar dos veces.
    haptic('pickerChange')
    setKind(key as SetKind)
    updateRoutineSet(setId, { kind: key as SetKind })
  }

  const changeRpe = (v: number | null) => {
    // Sobre un RPE vacío el ± no suma medio punto a nada: lo enciende en el objetivo típico.
    const next = v === null ? null : rpe === null ? RPE_DEFAULT : v
    setRpe(next)
    updateRoutineSet(setId, { targetRpe: next })
  }

  return (
    <View style={[sheetStyles.sheet, { paddingBottom: insets.bottom + spacing[4] }]}>
      <SheetHeader onDone={() => router.back()} title={t('routineSet.title')} />

      <View style={sheetStyles.content}>
        <Stepper
          label={t('routineSet.min')}
          max={REPS_HI}
          min={REPS_LO}
          onChange={changeMin}
          value={repsMin}
        />
        {/* El mínimo es el piso del máximo: el rango no se puede dar vuelta desde la UI. */}
        <Stepper
          label={t('routineSet.max')}
          max={REPS_HI}
          min={repsMin}
          onChange={changeMax}
          value={repsMax}
        />

        {/* El trigger del Menu no es un Pressable: el menú nativo necesita el tap para abrirse. */}
        <Menu items={KIND_ITEMS} onSelect={changeKind}>
          <View
            accessible
            accessibilityLabel={t('routineSet.kind')}
            accessibilityRole="button"
            accessibilityValue={{ text: t(`setKind.${kind}`) }}
            style={styles.row}
          >
            <Text numberOfLines={1} style={styles.rowLabel}>
              {t('routineSet.kind')}
            </Text>
            <Text color="secondary" numberOfLines={1}>
              {t(`setKind.${kind}`)}
            </Text>
            <SymbolView
              fallback={
                <Text color="tertiary" role="footnote">
                  ⌄
                </Text>
              }
              name={{
                ios: 'chevron.up.chevron.down' as SFSymbol,
                android: 'unfold_more' as AndroidSymbol,
              }}
              size={13}
              tintColor={colors.tertiaryLabel}
            />
          </View>
        </Menu>

        <View style={styles.row}>
          <View style={styles.grow}>
            <Stepper
              // El guión es para el ojo: el lector dice "Sin RPE objetivo" y no "raya".
              a11yText={rpe === null ? t('routineSet.clearRpe') : undefined}
              format={rpe === null ? () => EMPTY : rpeFormat.format}
              label={t('routineSet.rpe')}
              max={RPE_HI}
              min={RPE_LO}
              onChange={changeRpe}
              step={RPE_STEP}
              value={rpe ?? RPE_DEFAULT}
            />
          </View>
          {/* ponytail: el "sin RPE" es este botón y no una opción más del stepper. Techo: un target de
              44 pt para algo que se usa poco. Upgrade: swipe sobre el valor, si molesta. */}
          <PressableScale
            accessibilityLabel={t('routineSet.clearRpe')}
            accessibilityState={{ disabled: rpe === null }}
            disabled={rpe === null}
            onPress={() => {
              // El háptico va en el mismo bloque que el cambio (§7.4): el Stepper ya lo hace en ±,
              // apagarlo es el único cambio de valor de la hoja que no sonaba.
              haptic('selection')
              changeRpe(null)
            }}
            style={[styles.clear, rpe === null && styles.disabled]}
          >
            <Text color="tint" role="headline">
              {EMPTY}
            </Text>
          </PressableScale>
        </View>
      </View>
    </View>
  )
}
