import { router, useLocalSearchParams } from 'expo-router'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { createExercise } from '@/db/queries/exercises'
import { EQUIPMENT, type Equipment, METRICS, type Metric, MUSCLES, type Muscle } from '@/db/schema'
import { t } from '@/i18n'
import { haptic } from '@/ui/haptics'
import Input from '@/ui/Input'
import { useAndroidKeyboardHeight } from '@/ui/keyboard'
import Menu from '@/ui/Menu'
import PressableScale from '@/ui/PressableScale'
import SheetHeader, { sheetStyles } from '@/ui/SheetHeader'
import Text from '@/ui/Text'
import { colors, MIN_TARGET, opacity, radius, spacing } from '@/ui/tokens'

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  // Mismo target que las acciones de `SheetHeader`, que es con quien se alinea.
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
    paddingHorizontal: spacing[2],
  },
  disabled: { opacity: opacity.disabled },
  // El fondo del grupo pinta los separadores: un gap de hairline entre filas opacas.
  group: {
    borderRadius: radius.md,
    overflow: 'hidden',
    gap: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  // Un tono sobre el fondo llano de la hoja: `secondaryGrouped` es blanco sobre blanco en light.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TARGET,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    backgroundColor: colors.tertiaryGroupedBackground,
  },
  rowLabel: { flex: 1 },
})

/** El trigger del Menu no es un Pressable: el menú nativo necesita el tap para abrirse. */
function PickerRow({
  label,
  value,
  items,
  onSelect,
}: {
  label: string
  value: string
  items: { key: string; label: string }[]
  onSelect: (key: string) => void
}) {
  return (
    <Menu items={items} onSelect={onSelect}>
      <View
        accessible
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityValue={{ text: value }}
        style={styles.row}
      >
        <Text numberOfLines={1} style={styles.rowLabel}>
          {label}
        </Text>
        <Text color="secondary" numberOfLines={1}>
          {value}
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
          size={12}
          tintColor={colors.tertiaryLabel}
        />
      </View>
    </Menu>
  )
}

const muscleItems = MUSCLES.map((m) => ({ key: m, label: t(`muscle.${m}`) }))
const equipmentItems = EQUIPMENT.map((e) => ({ key: e, label: t(`equipment.${e}`) }))
const metricItems = METRICS.map((m) => ({ key: m, label: t(`metric.${m}`) }))

export default function NewExerciseScreen() {
  const params = useLocalSearchParams<{ name?: string }>()
  const [name, setName] = useState(params.name ?? '')
  const [muscle, setMuscle] = useState<Muscle>('chest')
  const [equipment, setEquipment] = useState<Equipment>('barbell')
  const [metric, setMetric] = useState<Metric>('weight_reps')
  // La hoja es de detent [1] y en Android tampoco se achica con el teclado: sin este hueco los tres
  // Menu quedan debajo del IME y la lista no tiene nada de scroll para llegar (ver `@/ui/keyboard`).
  const keyboard = useAndroidKeyboardHeight()

  const trimmed = name.trim()

  // ponytail: un solo nombre para es y en, sin músculos secundarios ni patrón. Techo: un ejercicio
  // propio aparece igual en los dos idiomas y no entra en los filtros por patrón (que no existen).
  // Upgrade: el mismo formulario con dos campos de nombre y dos Menu más.
  function create() {
    if (!trimmed) return
    createExercise({
      nameEs: trimmed,
      nameEn: trimmed,
      primaryMuscle: muscle,
      equipment,
      metric,
    })
    router.back()
  }

  return (
    <ScrollView
      contentContainerStyle={[sheetStyles.sheet, { paddingBottom: spacing[6] + keyboard }]}
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
    >
      {/* La hoja no trae header de sistema: este es lo único que la cierra con VoiceOver, y deja
          "Crear" arriba del teclado sin pelear con él. "Crear" va como `trailing` y no como
          `onDone` porque es la única acción de la app que se apaga sola: sin nombre no hay nada que
          crear, y un botón inerte que no se anuncia deshabilitado es peor que uno gris. */}
      <SheetHeader
        onCancel={() => router.back()}
        title={t('exercise.new.title')}
        trailing={
          <PressableScale
            accessibilityLabel={t('exercise.new.create')}
            accessibilityState={{ disabled: !trimmed }}
            disabled={!trimmed}
            onPress={() => {
              // Mismo Soft que el "Cancelar" de al lado: lo que se siente es la hoja cerrándose.
              haptic('sheetClose')
              create()
            }}
            style={[styles.action, !trimmed && styles.disabled]}
          >
            <Text color="tint" numberOfLines={1} role="headline">
              {t('exercise.new.create')}
            </Text>
          </PressableScale>
        }
      />

      <Input
        accessibilityLabel={t('exercise.new.name')}
        autoCapitalize="sentences"
        autoCorrect={false}
        autoFocus
        onChangeText={setName}
        onSubmitEditing={create}
        placeholder={t('exercise.new.name')}
        returnKeyType="done"
        value={name}
      />

      <View style={styles.group}>
        <PickerRow
          items={muscleItems}
          label={t('exercise.new.muscle')}
          onSelect={(key) => setMuscle(key as Muscle)}
          value={t(`muscle.${muscle}`)}
        />
        <PickerRow
          items={equipmentItems}
          label={t('exercise.new.equipment')}
          onSelect={(key) => setEquipment(key as Equipment)}
          value={t(`equipment.${equipment}`)}
        />
        <PickerRow
          items={metricItems}
          label={t('exercise.new.metric')}
          onSelect={(key) => setMetric(key as Metric)}
          value={t(`metric.${metric}`)}
        />
      </View>
    </ScrollView>
  )
}
