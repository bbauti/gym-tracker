import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { getSessionExercise, updateSessionExercise } from '@/db/queries/session'
import { getSet, updateSet } from '@/db/queries/sets'
import { t } from '@/i18n'
import { KAV_ENABLED, useSheetBottomInset } from '@/ui/keyboard'
import PressableScale from '@/ui/PressableScale'
import Text from '@/ui/Text'
import { colors, radius, spacing } from '@/ui/tokens'

const styles = StyleSheet.create({
  // Sin flex: 1 — `fitToContents` mide el contenido y un hijo elástico mide cero (hoja de 0 pt).
  sheet: { backgroundColor: colors.background, padding: spacing[4], gap: spacing[4] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  done: { paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  input: {
    minHeight: 120,
    borderRadius: radius.md,
    backgroundColor: colors.fill,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    fontSize: 17,
    lineHeight: 22,
    color: colors.label,
    textAlignVertical: 'top',
  },
})

/** La misma hoja edita la nota de un ejercicio de la sesión (`seId`) o la de una serie (`setId`). */
function readNote(seId: number | null, setId: number | null): string {
  if (seId !== null) return getSessionExercise(seId)?.note ?? ''
  if (setId !== null) return getSet(setId)?.note ?? ''
  return ''
}

const toId = (value: string | undefined) => (value === undefined ? null : Number(value))

export default function NoteScreen() {
  const params = useLocalSearchParams<{ seId?: string; setId?: string }>()
  const seId = toId(params.seId)
  const setId = toId(params.setId)
  const bottom = useSheetBottomInset()

  // Lectura de arranque, no suscripción: mientras se escribe manda el draft.
  const [text, setText] = useState(() => readNote(seId, setId))

  function save() {
    const note = text.trim() || null
    if (seId !== null) updateSessionExercise(seId, { note })
    else if (setId !== null) updateSet(setId, { note })
    router.back()
  }

  return (
    <KeyboardAvoidingView
      // Sin `automaticOffset` la hoja cree estar arriba de todo y no se corre con el teclado. En
      // Android va apagada y el hueco lo pone el padding de abajo (ver `src/ui/keyboard.ts`).
      automaticOffset
      behavior="padding"
      enabled={KAV_ENABLED}
      style={[styles.sheet, { paddingBottom: bottom + spacing[4] }]}
    >
      <View style={styles.header}>
        <Text accessibilityRole="header" role="headline">
          {t('note.title')}
        </Text>
        <PressableScale accessibilityLabel={t('common.done')} onPress={save} style={styles.done}>
          <Text color="tint" role="headline">
            {t('common.done')}
          </Text>
        </PressableScale>
      </View>
      <TextInput
        accessibilityLabel={t('note.title')}
        autoFocus
        maxFontSizeMultiplier={1.6}
        multiline
        onChangeText={setText}
        placeholder={t('note.placeholder')}
        placeholderTextColor={colors.tertiaryLabel}
        style={styles.input}
        value={text}
      />
    </KeyboardAvoidingView>
  )
}
