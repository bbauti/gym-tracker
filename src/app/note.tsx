import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { getSessionExercise, updateSessionExercise } from '@/db/queries/session'
import { getSet, updateSet } from '@/db/queries/sets'
import { t } from '@/i18n'
import Input from '@/ui/Input'
import { KAV_ENABLED, useSheetBottomInset } from '@/ui/keyboard'
import SheetHeader, { sheetStyles } from '@/ui/SheetHeader'
import { spacing } from '@/ui/tokens'

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
      style={[sheetStyles.sheet, { paddingBottom: bottom + spacing[4] }]}
    >
      <SheetHeader onDone={save} title={t('note.title')} />
      <Input
        accessibilityLabel={t('note.title')}
        autoFocus
        multiline
        onChangeText={setText}
        placeholder={t('note.placeholder')}
        value={text}
      />
    </KeyboardAvoidingView>
  )
}
