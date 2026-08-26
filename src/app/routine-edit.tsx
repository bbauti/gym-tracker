import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Switch, TextInput, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { getRoutine, getRoutineDay, updateDay, updateRoutine } from '@/db/queries/routines'
import { useQuery } from '@/db/useQuery'
import { t } from '@/i18n'
import { haptic } from '@/ui/haptics'
import { KAV_ENABLED, useSheetBottomInset } from '@/ui/keyboard'
import PressableScale from '@/ui/PressableScale'
import Text from '@/ui/Text'
import { colors, MIN_TARGET, radius, spacing } from '@/ui/tokens'

// `tables: []` en las dos lecturas: es un formulario. Si la fila se refrescara sola mientras se
// escribe, el draft se pisaría solo. Lo que se guarda se escribe en Listo y la hoja se cierra.
const NO_TABLES: string[] = []

const styles = StyleSheet.create({
  // Nada de flex: 1 acá: `fitToContents` mide el contenido, y un hijo que crece a lo que haya
  // mide cero y deja la hoja del alto de la nada.
  sheet: { backgroundColor: colors.background, gap: spacing[4], padding: spacing[4] },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  done: { paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  field: { gap: spacing[2] },
  input: {
    backgroundColor: colors.fill,
    borderRadius: radius.md,
    color: colors.label,
    fontSize: 17,
    lineHeight: 22,
    minHeight: MIN_TARGET,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  // El Switch mide 51×31: el área tocable es la fila entera, y el switch va sin eventos propios.
  toggle: {
    alignItems: 'center',
    backgroundColor: colors.fill,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing[3],
    minHeight: MIN_TARGET,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  toggleLabel: { flex: 1 },
})

/** La misma hoja renombra una rutina (`id`) o un día (`dayId`, que además tiene el deload). */
export default function RoutineEditScreen() {
  const { id, dayId } = useLocalSearchParams<{ id?: string; dayId?: string }>()
  const routineId = id ? Number(id) : null
  const numericDayId = dayId ? Number(dayId) : null
  const bottom = useSheetBottomInset()

  const day = useQuery(
    () => (numericDayId === null ? null : getRoutineDay(numericDayId)),
    NO_TABLES,
    [numericDayId],
  )
  const routine = useQuery(() => (routineId === null ? null : getRoutine(routineId)), NO_TABLES, [
    routineId,
  ])

  const row = day ?? routine
  const [name, setName] = useState(row?.name ?? '')
  const [deload, setDeload] = useState(day?.isDeload ?? false)

  if (!row) return null

  function save() {
    const trimmed = name.trim()
    // Un nombre vacío no borra el que había: se cierra y listo.
    if (trimmed) {
      if (day) updateDay(day.id, { name: trimmed })
      else if (routine) updateRoutine(routine.id, { name: trimmed })
    }
    router.back()
  }

  /**
   * El switch se guarda al tocarlo y no en Listo: la hoja también se cierra arrastrándola, y ahí
   * un toggle que solo vive en el estado se perdería sin avisar. El nombre no puede hacer lo mismo
   * (se escribiría letra por letra), por eso tiene su botón.
   */
  function toggleDeload() {
    if (!day) return
    const next = !deload
    // El háptico va en el mismo bloque que el cambio de estado (§7.4).
    haptic('toggle')
    setDeload(next)
    updateDay(day.id, { isDeload: next })
  }

  return (
    <KeyboardAvoidingView
      // `automaticOffset` mide la posición real en pantalla: sin eso la hoja cree que está arriba
      // de todo y decide que el teclado no la tapa. En Android va apagada y el hueco lo pone el
      // padding de abajo (ver `src/ui/keyboard.ts`).
      automaticOffset
      behavior="padding"
      enabled={KAV_ENABLED}
      style={[styles.sheet, { paddingBottom: bottom + spacing[4] }]}
    >
      <View style={styles.header}>
        <Text accessibilityRole="header" role="headline">
          {day ? t('day.title') : t('routine.rename')}
        </Text>
        <PressableScale accessibilityLabel={t('common.done')} onPress={save} style={styles.done}>
          <Text color="tint" role="headline">
            {t('common.done')}
          </Text>
        </PressableScale>
      </View>

      <View style={styles.field}>
        <Text color="secondary" role="footnote">
          {day ? t('day.name') : t('routine.name')}
        </Text>
        <TextInput
          accessibilityLabel={day ? t('day.name') : t('routine.name')}
          // Solo la rutina abre con el teclado puesto: la hoja del día también tiene el switch de
          // deload, y con `fitToContents` el teclado le caía justo encima. Renombrar arranca con un
          // toque en el campo; el toggle queda a la vista sin tener que bajar el teclado primero.
          autoFocus={!day}
          maxFontSizeMultiplier={1.6}
          onChangeText={setName}
          onSubmitEditing={save}
          placeholder={day ? t('routine.dayDefault', { n: 1 }) : t('routine.namePlaceholder')}
          placeholderTextColor={colors.tertiaryLabel}
          returnKeyType="done"
          style={styles.input}
          value={name}
        />
      </View>

      {day ? (
        <View style={styles.field}>
          <PressableScale
            accessibilityLabel={t('day.deload')}
            accessibilityRole="switch"
            accessibilityState={{ checked: deload }}
            onPress={toggleDeload}
            scale={0.98}
            style={styles.toggle}
          >
            <Text numberOfLines={1} style={styles.toggleLabel}>
              {t('day.deload')}
            </Text>
            <View pointerEvents="none">
              <Switch value={deload} />
            </View>
          </PressableScale>
          <Text color="secondary" role="footnote">
            {t('day.deloadHint')}
          </Text>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  )
}
