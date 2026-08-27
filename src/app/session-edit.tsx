import { DateTimePicker } from '@expo/ui/community/datetime-picker'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { getSession, updateSession } from '@/db/queries/session'
import { useQuery } from '@/db/useQuery'
import { locale, t } from '@/i18n'
import Input from '@/ui/Input'
import { KAV_ENABLED, useSheetBottomInset } from '@/ui/keyboard'
import PressableScale from '@/ui/PressableScale'
import SheetHeader, { sheetStyles } from '@/ui/SheetHeader'
import Text from '@/ui/Text'
import { colors, MIN_TARGET, Press, radius, spacing } from '@/ui/tokens'

const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'full' })

const styles = StyleSheet.create({
  field: { gap: spacing[1] },
  // Un campo más, pero el valor lo elige un picker: la caja es la del `Input` a mano.
  dateRow: {
    minHeight: MIN_TARGET,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.fill,
    paddingHorizontal: spacing[3],
  },
})

export default function SessionEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const sessionId = Number(id)
  const bottom = useSheetBottomInset()

  // `tables: []` a propósito: es un formulario. Si la fila se refrescara sola mientras se escribe,
  // el draft se pisaría solo. Lo que se guarda se escribe en Listo y la hoja se cierra.
  const row = useQuery(() => getSession(sessionId), [], [sessionId])

  const [name, setName] = useState(row?.name ?? '')
  const [note, setNote] = useState(row?.note ?? '')
  const [date, setDate] = useState(() => new Date(row?.startedAt ?? Date.now()))
  const [picking, setPicking] = useState(false)

  if (!row) return null

  function save() {
    if (!row) return
    // Mover la fecha corre el entrenamiento entero (`ended_at` y las series completadas): de eso se
    // encarga `updateSession`, que es donde vive la transacción.
    updateSession(row.id, {
      name: name.trim() || null,
      note: note.trim() || null,
      startedAt: date.getTime(),
    })
    router.back()
  }

  return (
    <KeyboardAvoidingView
      // `automaticOffset` mide la posición real en pantalla: sin eso la hoja cree que está arriba
      // de todo y decide que el teclado no la tapa. En Android va apagada y el hueco lo pone el
      // padding de abajo (ver `src/ui/keyboard.ts`).
      automaticOffset
      behavior="padding"
      enabled={KAV_ENABLED}
      style={[sheetStyles.sheet, { paddingBottom: bottom + spacing[4] }]}
    >
      <SheetHeader onDone={save} title={t('sessionEdit.title')} />

      <View style={sheetStyles.content}>
        <Input
          label={t('sessionEdit.name')}
          onChangeText={setName}
          placeholder={t('session.untitled')}
          returnKeyType="done"
          value={name}
        />

        <View style={styles.field}>
          {/* La etiqueta va escondida del lector: la fila ya se anuncia con ella adentro. */}
          <Text
            accessibilityElementsHidden
            color="secondary"
            importantForAccessibility="no-hide-descendants"
            role="label"
          >
            {t('sessionEdit.date')}
          </Text>
          <PressableScale
            accessibilityLabel={`${t('sessionEdit.date')}: ${dateFormat.format(date)}`}
            accessibilityState={{ expanded: picking }}
            onPress={() => setPicking(!picking)}
            scale={Press.row}
            style={styles.dateRow}
          >
            <Text>{dateFormat.format(date)}</Text>
          </PressableScale>
          {/* En iOS el picker es siempre inline (`presentation` se ignora) y se despliega debajo de
              la fila; en Android se monta como diálogo y hay que desmontarlo al cerrarlo. */}
          {picking ? (
            <DateTimePicker
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              mode="date"
              onDismiss={() => setPicking(false)}
              onValueChange={(_event, next) => {
                setDate(next)
                if (Platform.OS !== 'ios') setPicking(false)
              }}
              value={date}
            />
          ) : null}
        </View>

        <Input
          label={t('sessionEdit.note')}
          multiline
          onChangeText={setNote}
          placeholder={t('note.placeholder')}
          value={note}
        />
      </View>
    </KeyboardAvoidingView>
  )
}
