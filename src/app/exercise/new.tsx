import { router, useLocalSearchParams } from 'expo-router'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { useState } from 'react'
import { ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { createExercise } from '@/db/queries/exercises'
import { EQUIPMENT, type Equipment, METRICS, type Metric, MUSCLES, type Muscle } from '@/db/schema'
import { t } from '@/i18n'
import Menu from '@/ui/Menu'
import PressableScale from '@/ui/PressableScale'
import Text from '@/ui/Text'
import { colors, MIN_TARGET, radius, spacing } from '@/ui/tokens'

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[6] },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], minHeight: MIN_TARGET },
  barTitle: { flex: 1, textAlign: 'center' },
  barAction: { paddingVertical: spacing[2], minWidth: 64 },
  right: { textAlign: 'right' },
  disabled: { opacity: 0.4 },
  // El fondo del grupo pinta los separadores: un gap de hairline entre filas opacas.
  group: {
    borderRadius: radius.md,
    overflow: 'hidden',
    gap: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TARGET,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    backgroundColor: colors.secondaryGroupedBackground,
  },
  rowLabel: { flex: 1 },
  name: {
    minHeight: MIN_TARGET,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    fontSize: 17,
    lineHeight: 22,
    color: colors.label,
    backgroundColor: colors.secondaryGroupedBackground,
  },
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
    // Sin háptico: es un botón común y el sheet que se cierra ya es el feedback (§7.4).
    router.back()
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
    >
      {/* El sheet no tiene header: la barra propia es lo único que puede cerrarlo con VoiceOver,
          y deja "Crear" arriba del teclado sin pelear con él. */}
      <View style={styles.bar}>
        <PressableScale
          accessibilityLabel={t('common.cancel')}
          onPress={() => router.back()}
          style={styles.barAction}
        >
          <Text color="tint">{t('common.cancel')}</Text>
        </PressableScale>
        <Text numberOfLines={1} role="headline" style={styles.barTitle}>
          {t('exercise.new.title')}
        </Text>
        <PressableScale
          accessibilityLabel={t('exercise.new.create')}
          accessibilityState={{ disabled: !trimmed }}
          disabled={!trimmed}
          onPress={create}
          style={[styles.barAction, !trimmed && styles.disabled]}
        >
          <Text color="tint" role="headline" style={styles.right}>
            {t('exercise.new.create')}
          </Text>
        </PressableScale>
      </View>

      <View style={styles.group}>
        <TextInput
          accessibilityLabel={t('exercise.new.name')}
          autoCapitalize="sentences"
          autoCorrect={false}
          autoFocus
          onChangeText={setName}
          onSubmitEditing={create}
          placeholder={t('exercise.new.name')}
          placeholderTextColor={colors.tertiaryLabel}
          returnKeyType="done"
          style={styles.name}
          value={name}
        />
      </View>

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
