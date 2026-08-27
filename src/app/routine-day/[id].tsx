import { router, Stack, useLocalSearchParams } from 'expo-router'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { type AccessibilityActionEvent, Alert, StyleSheet, View } from 'react-native'
import Animated, { useAnimatedRef } from 'react-native-reanimated'
import { exerciseName } from '@/db/queries/exercises'
import {
  addRoutineSet,
  deleteDay,
  deleteRoutineSet,
  getRoutineDay,
  getRoutineTree,
  type RoutineSetRow,
  type RoutineTree,
  removeRoutineExercise,
  reorderRoutineExercises,
  restoreRoutineExercise,
  restoreRoutineSet,
  updateRoutineExercise,
} from '@/db/queries/routines'
import { useQuery } from '@/db/useQuery'
import { locale, t } from '@/i18n'
import Badge from '@/ui/Badge'
import Button from '@/ui/Button'
import Card from '@/ui/Card'
import EmptyState from '@/ui/EmptyState'
import { haptic } from '@/ui/haptics'
import IconButton from '@/ui/IconButton'
import Menu, { type MenuItem } from '@/ui/Menu'
import { RowLayout, useEnterFade } from '@/ui/motion'
import PressableScale from '@/ui/PressableScale'
import Sortable, { type ReorderActions } from '@/ui/Sortable'
import SwipeRow from '@/ui/SwipeRow'
import Text from '@/ui/Text'
import { toast } from '@/ui/Toast'
import { colors, MIN_TARGET, Press, spacing } from '@/ui/tokens'

type DayEntry = RoutineTree['days'][number]
type ExerciseEntry = DayEntry['exercises'][number]

const DAY_TABLES = ['routine', 'routine_day', 'routine_exercise', 'routine_set', 'exercise']

/** Los descansos que se eligen de verdad. Lo fino se ajusta en el ejercicio, no en la rutina. */
const REST_OPTIONS = [60, 90, 120, 180]
const REST_DEFAULT_KEY = 'rest:default'

const DAY_MENU: MenuItem[] = [
  // `skipTick`: "Editar" abre otra pantalla y la transición ya es el feedback (§7.4).
  { key: 'edit', label: t('day.edit'), md: 'edit', skipTick: true, sf: 'pencil' },
  { destructive: true, key: 'delete', label: t('day.delete'), md: 'delete', sf: 'trash' },
]

// El descanso que se elige acá viaja a la sesión: `startSessionFromDay` lo copia a
// `session_exercise.rest_sec` y la pantalla de entrenamiento lo prefiere al del ejercicio y al de
// ajustes. "Por defecto" lo devuelve a null, que es volver a esa cadena.
const EXERCISE_MENU: MenuItem[] = [
  ...REST_OPTIONS.map((n) => ({ key: `rest:${n}`, label: t('day.rest', { n }) })),
  { key: REST_DEFAULT_KEY, label: t('day.restDefault') },
  { destructive: true, key: 'remove', label: t('common.delete'), md: 'delete', sf: 'trash' },
]

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.groupedBackground, flex: 1 },
  // Sin `gap`: la separación entre cards vive adentro de `cardSlot` porque el hueco de la card
  // levantada tiene que viajar con ella (ver ui/Sortable.tsx).
  content: { padding: spacing[4] },
  cardSlot: { paddingBottom: spacing[4] },
  empty: { marginBottom: spacing[4], minHeight: 240 },
  deload: { gap: spacing[2], marginBottom: spacing[4] },
  card: { gap: spacing[1] },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing[2] },
  cardTitle: { flex: 1 },
  more: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    width: MIN_TARGET,
  },
  setRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing[2],
    minHeight: MIN_TARGET,
    paddingRight: spacing[1],
  },
  // `minWidth` y no `width`: a 1.6× un índice de dos dígitos no entra en 22 pt y parte en dos líneas.
  index: { minWidth: 22, textAlign: 'center' },
  // `flexShrink`: a Dynamic Type grande "Entrada en calor" se comía la fila y el que se achicaba era
  // el rango de reps, que es la única razón por la que existe esta pantalla. Cede el chip.
  kindSlot: { flexShrink: 1 },
  reps: { flex: 1 },
  addSet: { alignItems: 'center', justifyContent: 'center', minHeight: MIN_TARGET },
})

/** Dos queries y no una: el árbol se pide por rutina y la pantalla solo tiene el id del día. */
function readDay(dayId: number): DayEntry | null {
  const row = getRoutineDay(dayId)
  if (!row) return null
  // ponytail: trae la rutina entera para dibujar un día. Techo: 6 días × 8 ejercicios son ~150 filas
  // en una pantalla que se abre a mano. Upgrade: getDayTree(dayId) en db/queries/routines.ts.
  return getRoutineTree(row.routineId)?.days.find((d) => d.day.id === dayId) ?? null
}

/** "8–12 reps", "10 reps" o "—" si la serie no pide nada (D06). */
function repsText(set: RoutineSetRow): string {
  const { repsMin: lo, repsMax: hi } = set
  if (lo !== null && hi !== null && lo !== hi) return t('day.reps', { max: hi, min: lo })
  const n = lo ?? hi
  return n === null ? '—' : t('day.repsSingle', { n })
}

const keyOfExercise = (item: ExerciseEntry) => String(item.re.id)

// El swipe de `ui/SwipeRow` cuelga su acción accesible del contenedor, y acá el que enfoca VoiceOver
// es el Pressable de adentro (iOS no hereda acciones de un ancestro que no es elemento). Sin esto
// borrar una serie objetivo no tiene camino accesible: la fila no tiene menú, como sí lo tiene la de
// la sesión.
const DELETE_ACTION = [{ label: t('common.delete'), name: 'delete' }]

/**
 * El editor de un día de la rutina (D04/D06/D07): ejercicios reordenables, cada uno con sus series
 * objetivo. Todo lo que se toca acá es plantilla — la app sugiere, nunca aplica (§2.2).
 */
export default function RoutineDayScreen() {
  const params = useLocalSearchParams<{ id: string }>()
  const dayId = Number(params.id)
  const data = useQuery(() => (Number.isFinite(dayId) ? readDay(dayId) : null), DAY_TABLES, [dayId])
  // El sortable necesita el ref del scroll para auto-scrollear al arrastrar contra un borde.
  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  // Solo el ejercicio recién agregado (o el que vuelve con Deshacer) entra con fade.
  const fadeIn = useEnterFade((data?.exercises ?? []).map((e) => e.re.id))

  // Recién borrado (el día o la rutina entera desde otra pantalla): no hay nada que dibujar.
  if (!data) return null
  const { day, exercises } = data

  const handleDayMenu = (key: string) => {
    if (key === 'edit') {
      router.push({ params: { dayId }, pathname: '/routine-edit' })
      return
    }
    // La única confirmación de la fase es la de borrar una rutina (§7.5), pero un día se lleva sus
    // ejercicios y `deleteDay` no devuelve con qué deshacerlo: acá el diálogo es el undo.
    Alert.alert(t('day.deleteConfirm.title'), t('day.deleteConfirm.body'), [
      { style: 'cancel', text: t('common.cancel') },
      {
        onPress: () => {
          haptic('delete')
          deleteDay(dayId)
          router.back()
        },
        style: 'destructive',
        text: t('day.deleteConfirm.action'),
      },
    ])
  }

  const handleExerciseMenu = (reId: number, key: string) => {
    if (key !== 'remove') {
      const restSec = key === REST_DEFAULT_KEY ? null : Number(key.split(':')[1])
      updateRoutineExercise(reId, { restSec })
      return
    }
    // Sin diálogo (§7.5): se quita y queda el toast, que devuelve la card entera con sus series.
    haptic('delete')
    const removed = removeRoutineExercise(reId)
    if (!removed) return
    toast.show({
      actionLabel: t('common.undo'),
      onAction: () => {
        haptic('undo')
        restoreRoutineExercise(removed)
      },
      text: t('day.exerciseRemoved'),
    })
  }

  const handleDeleteSet = (setId: number) => {
    haptic('delete')
    const removed = deleteRoutineSet(setId)
    toast.show({
      actionLabel: t('common.undo'),
      onAction: () => {
        haptic('undo')
        restoreRoutineSet(removed)
      },
      text: t('day.setRemoved'),
    })
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Menu items={DAY_MENU} onSelect={handleDayMenu}>
              <IconButton
                asMenuTrigger
                fallback="⋯"
                label={t('common.more')}
                md="more_horiz"
                sf="ellipsis.circle"
                tint="tint"
              />
            </Menu>
          ),
          title: day.name,
        }}
      />
      <Animated.ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        ref={scrollRef}
        // El auto-scroll del sortable lee el offset con `useScrollViewOffset`, y sin esto RN manda
        // el evento una sola vez por gesto: arrastrar contra el borde no scrollearía.
        scrollEventThrottle={16}
      >
        {day.isDeload ? (
          <Card style={styles.deload}>
            <Badge label={t('day.deload')} size="md" tone="warning" />
            <Text color="secondary" role="footnote">
              {t('day.deloadHint')}
            </Text>
          </Card>
        ) : null}
        {exercises.length === 0 ? (
          <View style={styles.empty}>
            <EmptyState
              md="fitness_center"
              sf="figure.strengthtraining.traditional"
              title={t('day.empty')}
            />
          </View>
        ) : (
          <Sortable
            data={exercises}
            keyExtractor={keyOfExercise}
            onReorder={(keys) => reorderRoutineExercises(dayId, keys.map(Number))}
            renderItem={(item, _index, a11y) => (
              // La card entra con FadeIn al agregarla (§7.6); el hueco entre cards vive acá adentro.
              <Animated.View entering={fadeIn(item.re.id)} style={styles.cardSlot}>
                <ExerciseCard
                  a11y={a11y}
                  item={item}
                  onDeleteSet={handleDeleteSet}
                  onMenu={handleExerciseMenu}
                />
              </Animated.View>
            )}
            scrollableRef={scrollRef}
          />
        )}
        <Button
          md="add"
          onPress={() => router.push({ params: { dayId }, pathname: '/pick-exercise' })}
          sf="plus"
          title={t('day.addExercise')}
          variant="tinted"
        />
      </Animated.ScrollView>
    </View>
  )
}

type CardProps = {
  item: ExerciseEntry
  onMenu: (reId: number, key: string) => void
  onDeleteSet: (setId: number) => void
  /** Reordenar sin arrastre: van en el botón de la card, que es lo único enfocable del encabezado. */
  a11y: ReorderActions
}

function ExerciseCard({ item, onMenu, onDeleteSet, a11y }: CardProps) {
  const { re, exercise, sets } = item
  const name = exerciseName(exercise, locale)
  // Las series que ya estaban no animan; la que agregás y la que vuelve con Deshacer, sí. Una card
  // recién agregada monta con sus tres series adentro: entra la card, no tres fades sobre ella.
  const fadeIn = useEnterFade(sets.map((s) => s.id))

  return (
    <Card style={styles.card} variant="raised">
      <View style={styles.cardHeader}>
        <View style={styles.cardTitle}>
          <Text numberOfLines={2} role="headline">
            {name}
          </Text>
          {re.restSec === null ? null : (
            <Text color="secondary" role="footnote">
              {t('day.rest', { n: re.restSec })}
            </Text>
          )}
        </View>
        <Menu items={EXERCISE_MENU} onSelect={(key) => onMenu(re.id, key)}>
          <View
            {...a11y}
            accessible
            accessibilityLabel={`${t('common.more')}, ${name}`}
            accessibilityRole="button"
            style={styles.more}
          >
            <SymbolView
              fallback={
                <Text color="tint" role="title">
                  ⋯
                </Text>
              }
              name={{ ios: 'ellipsis.circle' as SFSymbol, android: 'more_horiz' as AndroidSymbol }}
              size={22}
              tintColor={colors.tint}
            />
          </View>
        </Menu>
      </View>
      {/* El hueco que deja una serie borrada lo cierra RowLayout — es la única región de la card
          con layout animation, y las filas no se arrastran (lo que se arrastra es la card). */}
      {sets.map((set, index) => (
        <Animated.View entering={fadeIn(set.id)} key={set.id} layout={RowLayout}>
          <SwipeRow onDelete={() => onDeleteSet(set.id)}>
            <SetTargetRow index={index} onDelete={() => onDeleteSet(set.id)} set={set} />
          </SwipeRow>
        </Animated.View>
      ))}
      <PressableScale
        accessibilityLabel={`${t('day.addSet')}, ${name}`}
        onPress={() => addRoutineSet(re.id)}
        scale={Press.row}
        style={styles.addSet}
      >
        <Text color="tint" role="callout">
          {t('day.addSet')}
        </Text>
      </PressableScale>
    </Card>
  )
}

/** Una serie objetivo: "1 · Entrada en calor · 8–12 reps · RPE 8". Toda la fila abre la hoja. */
function SetTargetRow({
  index,
  set,
  onDelete,
}: {
  index: number
  set: RoutineSetRow
  onDelete: () => void
}) {
  const reps = repsText(set)
  // `session.rpe` son las tres letras "RPE" en los dos idiomas; `routineSet.rpe` ("RPE objetivo")
  // es el label de la hoja y no entra en una fila de 44 pt.
  const rpe = set.targetRpe === null ? null : `${t('session.rpe')} ${set.targetRpe}`
  const kind = set.kind === 'normal' ? null : t(`setKind.${set.kind}`)

  return (
    <PressableScale
      accessibilityActions={DELETE_ACTION}
      accessibilityLabel={[`${index + 1}`, kind, reps, rpe].filter(Boolean).join(', ')}
      onAccessibilityAction={(e: AccessibilityActionEvent) => {
        if (e.nativeEvent.actionName === 'delete') onDelete()
      }}
      onPress={() => router.push({ params: { id: set.id }, pathname: '/routine-set' })}
      scale={Press.row}
      style={styles.setRow}
    >
      <Text color="secondary" role="footnote" style={styles.index} tabular>
        {index + 1}
      </Text>
      {kind === null ? null : (
        <View style={styles.kindSlot}>
          <Badge label={kind} tone="tint" />
        </View>
      )}
      <Text numberOfLines={1} style={styles.reps}>
        {reps}
      </Text>
      {rpe === null ? null : (
        <Text color="secondary" role="footnote" tabular>
          {rpe}
        </Text>
      )}
      <SymbolView
        fallback={
          <Text color="tertiary" role="body">
            ›
          </Text>
        }
        name={{ ios: 'chevron.right' as SFSymbol, android: 'chevron_right' as AndroidSymbol }}
        size={14}
        tintColor={colors.tertiaryLabel}
      />
    </PressableScale>
  )
}
