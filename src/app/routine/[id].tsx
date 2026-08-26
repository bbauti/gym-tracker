import { router, Stack, useLocalSearchParams } from 'expo-router'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { Alert, StyleSheet, View } from 'react-native'
import Animated, { useAnimatedRef } from 'react-native-reanimated'
import { shareJsonFile } from '@/db/backup'
import {
  addDay,
  deleteRoutine,
  duplicateRoutine,
  exportRoutine,
  getRoutineTree,
  MAX_WEEKS,
  type RoutineTree,
  reorderDays,
  setWeeks,
  startSessionFromDay,
} from '@/db/queries/routines'
import { getActiveSessionId } from '@/db/queries/session'
import { useQuery } from '@/db/useQuery'
import { plural, t } from '@/i18n'
import { ensureNotificationPermission } from '@/notifications'
import Button from '@/ui/Button'
import Card from '@/ui/Card'
import { haptic } from '@/ui/haptics'
import ListRow from '@/ui/ListRow'
import Menu, { type MenuItem } from '@/ui/Menu'
import { useEnterFade } from '@/ui/motion'
import Sortable, { type ReorderActions } from '@/ui/Sortable'
import Stepper from '@/ui/Stepper'
import Text from '@/ui/Text'
import { toast } from '@/ui/Toast'
import { colors, MIN_TARGET, radius, spacing } from '@/ui/tokens'

type DayEntry = RoutineTree['days'][number]

const ROUTINE_TABLES = ['routine', 'routine_day', 'routine_exercise', 'routine_set']
const SESSION_TABLES = ['session']

const MENU: MenuItem[] = [
  { key: 'rename', label: t('routine.rename'), md: 'edit', sf: 'pencil' },
  { key: 'duplicate', label: t('routine.duplicate'), md: 'content_copy', sf: 'doc.on.doc' },
  { key: 'move', label: t('routine.moveToFolder'), md: 'folder', sf: 'folder' },
  { key: 'export', label: t('routine.export'), md: 'share', sf: 'square.and.arrow.up' },
  { destructive: true, key: 'delete', label: t('routine.delete'), md: 'delete', sf: 'trash' },
]

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.groupedBackground, flex: 1 },
  content: { padding: spacing[4] },
  start: { paddingBottom: spacing[4] },
  weeks: { marginBottom: spacing[4] },
  weekGroup: { paddingBottom: spacing[4] },
  weekTitle: {
    letterSpacing: 0.4,
    paddingBottom: spacing[2],
    paddingHorizontal: spacing[2],
    textTransform: 'uppercase',
  },
  // El hueco entre filas vive adentro del ítem: el que levantás se lleva su hueco (ui/Sortable.tsx).
  rowSlot: { paddingBottom: spacing[2] },
  rowCard: { borderRadius: radius.md, overflow: 'hidden' },
  hideSeparator: { marginBottom: -StyleSheet.hairlineWidth },
  badges: { alignItems: 'center', flexDirection: 'row', gap: spacing[1] },
  badge: {
    backgroundColor: colors.fill,
    borderRadius: radius.sm,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
  },
  more: {
    alignItems: 'center',
    minHeight: MIN_TARGET,
    justifyContent: 'center',
    width: MIN_TARGET,
  },
})

/** El índice guardado puede quedar fuera de rango (se borró un día): siempre da una posición real. */
function wrap(index: number, count: number): number {
  if (count <= 0) return 0
  return ((index % count) + count) % count
}

const keyOfDay = (item: DayEntry) => String(item.day.id)

/** Etiqueta chiquita y NO tocable: `ui/Chip` es un control (pide onPress y vibra al tocarlo). */
function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <Text color="tint" role="caption">
        {label}
      </Text>
    </View>
  )
}

export default function RoutineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const routineId = Number(id)
  const tree = useQuery(() => getRoutineTree(routineId), ROUTINE_TABLES, [routineId])
  // El id y no un booleano: con un entrenamiento abierto el botón no se apaga, lleva a ese.
  const activeId = useQuery(getActiveSessionId, SESSION_TABLES)
  // El sortable necesita el ref del scroll para auto-scrollear al arrastrar contra un borde.
  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  // Solo el día recién agregado entra con fade; los que ya estaban al abrir, no.
  const fadeIn = useEnterFade((tree?.days ?? []).map((d) => d.day.id))

  // Recién borrada: la pantalla se pinta una vez más antes de que el back se complete.
  if (!tree) return null

  const days = tree.days
  const name = tree.routine.name
  // Acotado también acá: la fila guardada es la que manda y un valor de fuera de rango se dibuja.
  const weeks = Math.min(Math.max(1, tree.routine.weeks ?? 1), MAX_WEEKS)
  const nextIndex = wrap(tree.routine.currentDayIndex, days.length)
  const nextDay = days.length === 0 ? null : days[nextIndex].day

  // D05. Los días llegan en el orden canónico (semana, después posición), así que agruparlos es una
  // sola pasada. Con `weeks` en 1 el grupo es uno solo y la pantalla ni dibuja los encabezados.
  const byWeek = Array.from({ length: weeks }, (_, week) => ({ list: [] as DayEntry[], week }))
  for (const entry of days) {
    byWeek[Math.min(Math.max(0, entry.day.weekIndex ?? 0), weeks - 1)].list.push(entry)
  }

  function onMenu(key: string) {
    if (key === 'rename') {
      router.push({ params: { id: routineId }, pathname: '/routine-edit' })
      return
    }
    if (key === 'duplicate') {
      const copyId = duplicateRoutine(routineId, name + t('routine.duplicateSuffix'))
      // replace y no push: volver atrás desde la copia lleva a la lista, no al original.
      router.replace({ params: { id: copyId }, pathname: '/routine/[id]' })
      return
    }
    if (key === 'move') {
      // Hoja y no `showMenu`: en Android el menú imperativo es un Alert de dos slots (ui/Menu.tsx)
      // y una lista que crece con lo que hace el usuario no entra ahí.
      router.push({ params: { id: routineId }, pathname: '/routine-move' })
      return
    }
    if (key === 'export') {
      const data = exportRoutine(routineId)
      if (!data) return
      // La hoja de compartir ES el feedback, igual que en los exports de ajustes: `shareAsync`
      // resuelve también cuando la cancelan, así que un "listo" mentiría la mitad de las veces.
      void shareJsonFile(name, data).catch(() => {
        toast.show({ text: t('backup.error.unsupported') })
      })
      return
    }
    // Lo único que se borra con diálogo: una rutina entera no entra en un toast de deshacer (§7.5
    // pide swipe + undo para filas, no para árboles).
    Alert.alert(t('routine.deleteConfirm.title'), t('routine.deleteConfirm.body'), [
      { style: 'cancel', text: t('common.cancel') },
      {
        onPress: () => {
          // El háptico va en el mismo bloque que el borrado (§7.4), igual que el del día y el de
          // una serie: esto es lo más destructivo de la pantalla y era lo único mudo.
          haptic('delete')
          deleteRoutine(routineId)
          router.back()
        },
        style: 'destructive',
        text: t('routine.deleteConfirm.action'),
      },
    ])
  }

  function renderDay(item: DayEntry, a11y: ReorderActions) {
    const exerciseCount = item.exercises.length
    const setCount = item.exercises.reduce((n, e) => n + e.sets.length, 0)
    const subtitle = [
      plural(
        exerciseCount,
        t('history.exercises.one', { n: exerciseCount }),
        t('history.exercises.other', { n: exerciseCount }),
      ),
      plural(setCount, t('day.sets.one', { n: setCount }), t('day.sets.other', { n: setCount })),
    ].join(' · ')
    const marks = [
      // Por id y no por posición: con semanas la lista se dibuja partida en grupos.
      item.day.id === nextDay?.id ? t('routine.next') : null,
      item.day.isDeload ? t('day.deload') : null,
    ].filter((s) => s !== null)
    return (
      // Entra con FadeIn el día recién agregado; la lista no se anima al reordenar
      // (de eso se ocupa el sortable con sus propios springs).
      <Animated.View entering={fadeIn(item.day.id)} style={styles.rowSlot}>
        <View style={styles.rowCard}>
          <View style={styles.hideSeparator}>
            <ListRow
              {...a11y}
              chevron
              label={[item.day.name, ...marks, subtitle].join(', ')}
              onPress={() =>
                router.push({ params: { id: item.day.id }, pathname: '/routine-day/[id]' })
              }
              subtitle={subtitle}
              title={item.day.name}
              trailing={
                marks.length > 0 ? (
                  <View style={styles.badges}>
                    {marks.map((label) => (
                      <Badge key={label} label={label} />
                    ))}
                  </View>
                ) : null
              }
            />
          </View>
        </View>
      </Animated.View>
    )
  }

  /** Los días de UNA semana con su fila de agregar. Se arrastra dentro de la semana, nunca entre. */
  function weekDays(list: DayEntry[], weekIndex: number | null) {
    return (
      <>
        {list.length > 0 ? (
          <Sortable
            data={list}
            keyExtractor={keyOfDay}
            onReorder={(keys) => reorderDays(routineId, keys.map(Number))}
            renderItem={(item, _index, a11y) => renderDay(item, a11y)}
            scrollableRef={scrollRef}
          />
        ) : null}
        <View style={styles.rowCard}>
          <View style={styles.hideSeparator}>
            <ListRow
              chevron
              // En pantalla alcanza con "Agregar día" (el encabezado dice cuál es la semana); en voz
              // alta la fila se lee sola y necesita decirlo.
              label={
                weekIndex === null ? undefined : t('routine.addDayToWeek', { n: weekIndex + 1 })
              }
              onPress={() => {
                const dayId = addDay(
                  routineId,
                  t('routine.dayDefault', { n: list.length + 1 }),
                  weekIndex,
                )
                router.push({ params: { id: dayId }, pathname: '/routine-day/[id]' })
              }}
              title={t('routine.addDay')}
            />
          </View>
        </View>
      </>
    )
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Menu items={MENU} onSelect={onMenu}>
              <View
                accessible
                accessibilityLabel={t('common.more')}
                accessibilityRole="button"
                style={styles.more}
              >
                <SymbolView
                  fallback={
                    <Text color="tint" role="title">
                      ⋯
                    </Text>
                  }
                  name={{
                    ios: 'ellipsis.circle' as SFSymbol,
                    android: 'more_horiz' as AndroidSymbol,
                  }}
                  size={22}
                  tintColor={colors.tint}
                />
              </View>
            </Menu>
          ),
          title: name,
        }}
      />
      <Animated.ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        ref={scrollRef}
        // El auto-scroll del sortable lee el offset con `useScrollViewOffset`, y sin esto RN manda
        // el evento una sola vez por gesto: arrastrar un día contra el borde no scrollearía.
        scrollEventThrottle={16}
      >
        {nextDay ? (
          <View style={styles.start}>
            {/* Dos sesiones a la vez dejarían la vieja sin terminar y fuera del historial (que solo
                lista las terminadas). Acá no hay card de "Continuar" como en la tab, así que el
                botón no se apaga: se convierte en ella y lleva al entrenamiento que está abierto. */}
            <Button
              onPress={() => {
                void ensureNotificationPermission()
                // La base y no `activeId`: `useQuery` difiere la invalidación un `setTimeout(0)`
                // (db/useQuery.ts), así que en un doble toque el segundo todavía ve `null` y
                // arrancaba una segunda sesión — la primera quedaba abierta para siempre y fuera
                // del historial. Leído en el momento, el segundo toque entra a la que se acaba de
                // crear, que es lo mismo que hace el título cuando ya hay una abierta.
                const sessionId = getActiveSessionId() ?? startSessionFromDay(nextDay.id)
                router.push({ params: { id: sessionId }, pathname: '/session/[id]' })
              }}
              title={
                activeId === null
                  ? t('routine.start', { day: nextDay.name })
                  : t('session.continue')
              }
              variant={activeId === null ? 'filled' : 'tinted'}
            />
          </View>
        ) : null}

        <Card style={styles.weeks}>
          {/* Bajar el número nunca borra días: los de las semanas que se van se mudan al final de la
              última que queda (db/queries/routines.ts → setWeeks). */}
          <Stepper
            label={t('routine.weeks')}
            max={MAX_WEEKS}
            min={1}
            onChange={(n) => setWeeks(routineId, n)}
            value={weeks}
          />
        </Card>

        {weeks === 1
          ? weekDays(days, null)
          : byWeek.map(({ list, week }) => (
              <View key={week} style={styles.weekGroup}>
                <Text
                  accessibilityRole="header"
                  color="secondary"
                  role="footnote"
                  style={styles.weekTitle}
                >
                  {t('routine.week', { n: week + 1 })}
                </Text>
                {weekDays(list, week)}
              </View>
            ))}
      </Animated.ScrollView>
    </View>
  )
}
