import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { createRoutine } from '@/db/queries/routines'
import { t } from '@/i18n'
import Button from '@/ui/Button'
import { KAV_ENABLED, useSheetBottomInset } from '@/ui/keyboard'
import Text from '@/ui/Text'
import { colors, MIN_TARGET, radius, spacing } from '@/ui/tokens'

const styles = StyleSheet.create({
  // Nada de flex: 1 acá: `fitToContents` mide el contenido, y un hijo que crece a lo que haya
  // mide cero y deja la hoja del alto de la nada.
  sheet: { backgroundColor: colors.background, gap: spacing[4], padding: spacing[4] },
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
})

export default function NewRoutineScreen() {
  const bottom = useSheetBottomInset()
  const [name, setName] = useState('')
  const trimmed = name.trim()
  // Un solo disparo por hoja: Crear y el "Listo" del teclado son dos caminos al mismo write, y dos
  // toques rápidos entran los dos antes de que la navegación desmonte esto (dos rutinas iguales).
  // No se vuelve a false a propósito: de acá se sale navegando.
  const created = useRef(false)

  function create() {
    if (!trimmed || created.current) return
    created.current = true
    // Nace con un día: una rutina sin días no se puede empezar y la card diría "Siguiente: —".
    const id = createRoutine(trimmed, t('routine.dayDefault', { n: 1 }))
    // replace: cerrar la rutina recién creada vuelve a la lista, no a la hoja vacía.
    router.replace({ params: { id }, pathname: '/routine/[id]' })
  }

  return (
    <KeyboardAvoidingView
      // `automaticOffset` mide la posición real en pantalla: sin eso la hoja cree que está arriba
      // de todo y decide que el teclado no la tapa. En Android va apagada y el hueco lo pone el
      // padding de abajo (ver `src/ui/keyboard.ts`). Crear es el último hijo de la hoja, así que el
      // teclado lo empuja hacia arriba: `fitToContents` crece con el contenido y RN Screens la
      // vuelve a medir.
      automaticOffset
      behavior="padding"
      enabled={KAV_ENABLED}
      style={[styles.sheet, { paddingBottom: bottom + spacing[4] }]}
    >
      <Text accessibilityRole="header" role="headline">
        {t('routine.new')}
      </Text>

      <View style={styles.field}>
        <Text color="secondary" role="footnote">
          {t('routine.name')}
        </Text>
        <TextInput
          accessibilityLabel={t('routine.name')}
          autoFocus
          maxFontSizeMultiplier={1.6}
          onChangeText={setName}
          onSubmitEditing={create}
          placeholder={t('routine.namePlaceholder')}
          placeholderTextColor={colors.tertiaryLabel}
          returnKeyType="done"
          style={styles.input}
          value={name}
        />
      </View>

      <Button disabled={trimmed === ''} onPress={create} title={t('common.create')} />
    </KeyboardAvoidingView>
  )
}
