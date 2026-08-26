import { router, useLocalSearchParams } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { setFeedback } from '@/db/queries/progression'
import { getSessionExercise } from '@/db/queries/session'
import type { Feedback } from '@/db/schema'
import { useQuery } from '@/db/useQuery'
import { t } from '@/i18n'
import Chip from '@/ui/Chip'
import { useSheetBottomInset } from '@/ui/keyboard'
import PressableScale from '@/ui/PressableScale'
import Text from '@/ui/Text'
import { colors, spacing } from '@/ui/tokens'

type Option<V extends number> = { label: string; value: V }

const PUMP: Option<NonNullable<Feedback['pump']>>[] = [
  { label: t('feedback.pumpLow'), value: 1 },
  { label: t('feedback.pumpOk'), value: 2 },
  { label: t('feedback.pumpHigh'), value: 3 },
]

const DIFFICULTY: Option<NonNullable<Feedback['difficulty']>>[] = [
  { label: t('feedback.difficultyEasy'), value: 1 },
  { label: t('feedback.difficultyOk'), value: 2 },
  { label: t('feedback.difficultyHard'), value: 3 },
]

const PAIN: Option<NonNullable<Feedback['pain']>>[] = [
  { label: t('feedback.painNone'), value: 0 },
  { label: t('feedback.painSome'), value: 1 },
]

const styles = StyleSheet.create({
  // Sin flex: 1 — `fitToContents` mide el contenido y un hijo elástico mediría cero (hoja de 0 pt).
  sheet: { backgroundColor: colors.background, gap: spacing[3], padding: spacing[4] },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing[2],
  },
  done: { paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  row: { gap: spacing[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
})

function Row<V extends number>({
  label,
  options,
  value,
  onPick,
}: {
  label: string
  options: Option<V>[]
  value: V | undefined
  onPick: (value: V | undefined) => void
}) {
  return (
    <View style={styles.row}>
      <Text accessibilityRole="header" color="secondary" role="footnote">
        {label}
      </Text>
      <View style={styles.chips}>
        {options.map((o) => (
          <Chip
            // La pregunta va en el label: el texto de arriba es otro elemento, y sin él hay dos
            // chips que se llaman igual ("Bien" de bombeo y "Bien" de dificultad).
            accessibilityLabel={`${label}, ${o.label}`}
            key={o.value}
            label={o.label}
            // Volver a tocar el elegido lo apaga: es la única forma de deshacer un toque de más.
            onPress={() => onPick(value === o.value ? undefined : o.value)}
            selected={value === o.value}
          />
        ))}
      </View>
    </View>
  )
}

/**
 * E09: cómo salió el ejercicio (`?seId=`). Bombeo, dificultad y dolor — tres preguntas de una
 * escala, todas opcionales. Nunca se abre sola (§7.5): la abre el menú de la card o el pie que
 * aparece cuando el ejercicio ya está terminado.
 *
 * Lo que se contesta acá vuelve como sugerencia la próxima vez (`suggest`), nunca como un cambio en
 * la rutina (§2.2).
 */
export default function FeedbackScreen() {
  const params = useLocalSearchParams<{ seId: string }>()
  const seId = Number(params.seId)
  const bottom = useSheetBottomInset()
  // Se guarda al tocar, así que la hoja lee la fila en vez de llevar un borrador: lo que se ve es
  // lo que quedó guardado, incluso si la hoja se abre dos veces.
  const feedback = useQuery(
    () => getSessionExercise(seId)?.feedback ?? null,
    ['session_exercise'],
    [seId],
  )

  const save = (next: Feedback) => {
    // Sin ninguna respuesta vuelve a `null` y no a `{}`: el pie de la card pregunta justo mientras
    // el feedback sea null, y un objeto vacío lo apagaría para siempre.
    const answered = Object.values(next).some((v) => v !== undefined)
    setFeedback(seId, answered ? next : null)
  }

  return (
    <View style={[styles.sheet, { paddingBottom: bottom + spacing[4] }]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" role="headline">
          {t('feedback.title')}
        </Text>
        <PressableScale
          accessibilityLabel={t('common.done')}
          onPress={() => router.back()}
          style={styles.done}
        >
          <Text color="tint" role="headline">
            {t('common.done')}
          </Text>
        </PressableScale>
      </View>

      <Row
        label={t('feedback.pump')}
        onPick={(pump) => save({ ...feedback, pump })}
        options={PUMP}
        value={feedback?.pump}
      />
      <Row
        label={t('feedback.difficulty')}
        onPick={(difficulty) => save({ ...feedback, difficulty })}
        options={DIFFICULTY}
        value={feedback?.difficulty}
      />
      <Row
        label={t('feedback.pain')}
        onPick={(pain) => save({ ...feedback, pain })}
        options={PAIN}
        value={feedback?.pain}
      />
    </View>
  )
}
