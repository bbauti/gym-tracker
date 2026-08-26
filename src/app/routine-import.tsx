import { getDocumentAsync } from 'expo-document-picker'
import { File } from 'expo-file-system'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { type Exercise, listExercises, normalizeName } from '@/db/queries/exercises'
import { importRoutine } from '@/db/queries/routines'
import { getSettings } from '@/db/queries/settings'
import { useQuery } from '@/db/useQuery'
import { plural, t } from '@/i18n'
import { parseRoutineDraft, type RoutineDraft } from '@/lib/routineText'
import Button from '@/ui/Button'
import { KAV_ENABLED, useSheetBottomInset } from '@/ui/keyboard'
import PressableScale from '@/ui/PressableScale'
import Text from '@/ui/Text'
import { toast } from '@/ui/Toast'
import { colors, radius, spacing } from '@/ui/tokens'

const CATALOGUE_TABLES = ['exercise', 'settings']
/** Lo que acepta el picker; el formato real lo decide el parser, no la extensión. */
const FILE_TYPES = ['text/plain', 'text/csv', 'text/comma-separated-values', 'application/json']

const styles = StyleSheet.create({
  // Detents fijos ([0.75, 1]): acá el flex: 1 sí va — la hoja no mide su contenido.
  sheet: { backgroundColor: colors.background, flex: 1, gap: spacing[3], padding: spacing[4] },
  head: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  cancel: { paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  input: {
    backgroundColor: colors.fill,
    borderRadius: radius.md,
    color: colors.label,
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    textAlignVertical: 'top',
  },
  // Alto reservado: el resumen aparece y desaparece con cada tecla y no puede mover los botones.
  footnote: { minHeight: 18 },
  actions: { flexDirection: 'row', gap: spacing[3] },
  grow: { flex: 1 },
})

/**
 * Cuántos ejercicios del borrador no están en el catálogo, con el mismo criterio que `importRoutine`
 * (seedId, después el nombre normalizado). Dos días con el mismo ejercicio nuevo cuentan uno solo:
 * el import lo crea una vez.
 */
function summarize(draft: RoutineDraft, catalogue: Exercise[]) {
  const seeds = new Set<string>()
  const names = new Set<string>()
  for (const e of catalogue) {
    if (e.seedId) seeds.add(e.seedId)
    for (const name of [e.nameEs, e.nameEn, ...(e.aliases ?? [])]) names.add(normalizeName(name))
  }

  let exercises = 0
  let unknown = 0
  for (const day of draft.days) {
    for (const ex of day.exercises) {
      exercises += 1
      if (ex.seedId && seeds.has(ex.seedId)) continue
      const key = normalizeName(ex.name)
      if (names.has(key)) continue
      names.add(key)
      unknown += 1
    }
  }
  return { days: draft.days.length, exercises, unknown }
}

/** El resumen cuenta tres cosas y las tres pueden ser una: cada número con su plural. */
function previewLabel(p: { days: number; exercises: number; unknown: number }): string {
  return [
    plural(p.days, t('routine.days.one', { n: p.days }), t('routine.days.other', { n: p.days })),
    plural(
      p.exercises,
      t('history.exercises.one', { n: p.exercises }),
      t('history.exercises.other', { n: p.exercises }),
    ),
    plural(
      p.unknown,
      t('import.new.one', { n: p.unknown }),
      t('import.new.other', { n: p.unknown }),
    ),
  ].join(' · ')
}

/** D08. Pegar (o abrir) una rutina y verla entera antes de escribir nada. */
export default function RoutineImportScreen() {
  const bottom = useSheetBottomInset()
  const [text, setText] = useState('')
  // Un solo disparo: dos toques rápidos entran los dos antes de que la navegación desmonte esto.
  const imported = useRef(false)

  const { catalogue, unit } = useQuery(
    // Con archivados: el import los matchea igual, y contarlos como nuevos mentiría en el resumen.
    () => ({ catalogue: listExercises({ includeArchived: true }), unit: getSettings().unit }),
    CATALOGUE_TABLES,
  )

  const draft = text.trim() ? parseRoutineDraft(text) : null
  const preview = draft ? summarize(draft, catalogue) : null

  async function pickFile() {
    const picked = await getDocumentAsync({ copyToCacheDirectory: true, type: FILE_TYPES }).catch(
      () => null,
    )
    if (!picked || picked.canceled || !picked.assets[0]) return
    try {
      // El archivo cae en el campo, no en la base: se revisa y se importa como cualquier texto.
      setText(await new File(picked.assets[0].uri).text())
    } catch {
      toast.show({ text: t('import.invalid') })
    }
  }

  function run() {
    if (!draft || imported.current) return
    imported.current = true
    const { routineId, created } = importRoutine(draft, { unit })
    const n = created.length
    toast.show({
      text:
        n > 0
          ? `${t('import.done')} · ${plural(n, t('import.created.one', { n }), t('import.created.other', { n }))}`
          : t('import.done'),
    })
    // replace: cerrar la rutina importada vuelve a la lista, no a la hoja con el texto pegado.
    router.replace({ params: { id: routineId }, pathname: '/routine/[id]' })
  }

  return (
    <KeyboardAvoidingView
      // `automaticOffset` mide la posición real: sin eso la hoja cree que está arriba de todo y no
      // compensa el teclado. En Android va apagada y el hueco lo pone el padding (`@/ui/keyboard`).
      automaticOffset
      behavior="padding"
      enabled={KAV_ENABLED}
      style={[styles.sheet, { paddingBottom: bottom + spacing[4] }]}
    >
      <View style={styles.head}>
        <Text accessibilityRole="header" role="headline">
          {t('import.title')}
        </Text>
        <PressableScale
          accessibilityLabel={t('common.cancel')}
          onPress={() => router.back()}
          style={styles.cancel}
        >
          <Text color="tint" role="headline">
            {t('common.cancel')}
          </Text>
        </PressableScale>
      </View>

      <TextInput
        accessibilityLabel={t('import.title')}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        maxFontSizeMultiplier={1.6}
        multiline
        onChangeText={setText}
        placeholder={t('import.placeholder')}
        placeholderTextColor={colors.tertiaryLabel}
        style={styles.input}
        value={text}
      />

      <Text color={preview ? 'secondary' : 'destructive'} role="footnote" style={styles.footnote}>
        {preview ? previewLabel(preview) : text.trim() ? t('import.invalid') : ''}
      </Text>

      <View style={styles.actions}>
        {/* PressableScale le pasa el `style` a su View de adentro: el flex va en el envoltorio. */}
        <View style={styles.grow}>
          <Button onPress={pickFile} title={t('import.fromFile')} variant="tinted" />
        </View>
        <View style={styles.grow}>
          <Button disabled={!draft} onPress={run} title={t('import.action')} />
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}
