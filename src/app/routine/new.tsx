import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { createRoutine } from '@/db/queries/routines'
import { t } from '@/i18n'
import Button from '@/ui/Button'
import Input from '@/ui/Input'
import { KAV_ENABLED, useSheetBottomInset } from '@/ui/keyboard'
import SheetHeader, { sheetStyles } from '@/ui/SheetHeader'
import { spacing } from '@/ui/tokens'

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
      style={[sheetStyles.sheet, { paddingBottom: bottom + spacing[4] }]}
    >
      {/* Sin "Listo": de esta hoja se sale creando (o arrastrándola). */}
      <SheetHeader title={t('routine.new')} />

      <Input
        autoFocus
        label={t('routine.name')}
        onChangeText={setName}
        onSubmitEditing={create}
        placeholder={t('routine.namePlaceholder')}
        returnKeyType="done"
        value={name}
      />

      <Button disabled={trimmed === ''} onPress={create} title={t('common.create')} />
    </KeyboardAvoidingView>
  )
}
