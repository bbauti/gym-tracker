import { DateTimePicker } from '@expo/ui/community/datetime-picker'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Platform, StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { getSession, updateSession } from '@/db/queries/session'
import { useQuery } from '@/db/useQuery'
import { locale, t } from '@/i18n'
import { KAV_ENABLED, useSheetBottomInset } from '@/ui/keyboard'
import PressableScale from '@/ui/PressableScale'
import Text from '@/ui/Text'
import { colors, MIN_TARGET, radius, spacing } from '@/ui/tokens'

const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'full' })

const styles = StyleSheet.create({
  // Nada de flex: 1 acá: `fitToContents` mide el contenido, y un hijo que crece a lo que haya
  // mide cero y deja la hoja del alto de la nada.
  sheet: { backgroundColor: colors.background, padding: spacing[4], gap: spacing[4] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  done: { paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  field: { gap: spacing[2] },
  input: {
    minHeight: MIN_TARGET,
    borderRadius: radius.md,
    backgroundColor: colors.fill,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    fontSize: 17,
    lineHeight: 22,
    color: colors.label,
  },
  note: { minHeight: 88, textAlignVertical: 'top' },
  dateRow: {
    minHeight: MIN_TARGET,
    justifyContent: 'center',
    borderRadius: radius.md,
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
      style={[styles.sheet, { paddingBottom: bottom + spacing[4] }]}
    >
      <View style={styles.header}>
        <Text accessibilityRole="header" role="headline">
          {t('sessionEdit.title')}
        </Text>
        <PressableScale accessibilityLabel={t('common.done')} onPress={save} style={styles.done}>
          <Text color="tint" role="headline">
            {t('common.done')}
          </Text>
        </PressableScale>
      </View>

      <View style={styles.field}>
        <Text color="secondary" role="footnote">
          {t('sessionEdit.name')}
        </Text>
        <TextInput
          accessibilityLabel={t('sessionEdit.name')}
          maxFontSizeMultiplier={1.6}
          onChangeText={setName}
          placeholder={t('session.untitled')}
          placeholderTextColor={colors.tertiaryLabel}
          returnKeyType="done"
          style={styles.input}
          value={name}
        />
      </View>

      <View style={styles.field}>
        <Text color="secondary" role="footnote">
          {t('sessionEdit.date')}
        </Text>
        <PressableScale
          accessibilityLabel={`${t('sessionEdit.date')}: ${dateFormat.format(date)}`}
          accessibilityState={{ expanded: picking }}
          onPress={() => setPicking(!picking)}
          scale={0.98}
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

      <View style={styles.field}>
        <Text color="secondary" role="footnote">
          {t('sessionEdit.note')}
        </Text>
        <TextInput
          accessibilityLabel={t('sessionEdit.note')}
          maxFontSizeMultiplier={1.6}
          multiline
          onChangeText={setNote}
          placeholder={t('note.placeholder')}
          placeholderTextColor={colors.tertiaryLabel}
          style={[styles.input, styles.note]}
          value={note}
        />
      </View>
    </KeyboardAvoidingView>
  )
}
