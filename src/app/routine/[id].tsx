import { router, Stack, useLocalSearchParams } from 'expo-router'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { Alert, StyleSheet, View } from 'react-native'
import Animated, { FadeIn, useAnimatedRef } from 'react-native-reanimated'
import {
  addDay,
  deleteRoutine,
  duplicateRoutine,
  getRoutineTree,
  reorderDays,
  startSessionFromDay,
} from '@/db/queries/routines'
import { getActiveSessionId } from '@/db/queries/session'
import { useQuery } from '@/db/useQuery'
import { plural, t } from '@/i18n'
import { ensureNotificationPermission } from '@/notifications'
import Button from '@/ui/Button'
import ListRow from '@/ui/ListRow'
import Menu, { type MenuItem } from '@/ui/Menu'
import Sortable from '@/ui/Sortable'
import Text from '@/ui/Text'
import { colors, MIN_TARGET, radius, spacing } from '@/ui/tokens'

const ROUTINE_TABLES = ['routine', 'routine_day', 'routine_exercise', 'routine_set']
const SESSION_TABLES = ['session']

const MENU: MenuItem[] = [
  { key: 'rename', label: t('routine.rename'), md: 'edit', sf: 'pencil' },
  { key: 'duplicate', label: t('routine.duplicate'), md: 'content_copy', sf: 'doc.on.doc' },
  { destructive: true, key: 'delete', label: t('routine.delete'), md: 'delete', sf: 'trash' },
]

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.groupedBackground, flex: 1 },
  content: { padding: spacing[4] },
  start: { paddingBottom: spacing[4] },
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
  const busy = useQuery(() => getActiveSessionId() !== null, SESSION_TABLES)
  // El sortable necesita el ref del scroll para auto-scrollear al arrastrar contra un borde.
  const scrollRef = useAnimatedRef<Animated.ScrollView>()

  // Recién borrada: la pantalla se pinta una vez más antes de que el back se complete.
  if (!tree) return null

  const days = tree.days
  const name = tree.routine.name
  const nextIndex = wrap(tree.routine.currentDayIndex, days.length)
  const nextDay = days.length === 0 ? null : days[nextIndex].day

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
    // Lo único que se borra con diálogo: una rutina entera no entra en un toast de deshacer (§7.5
    // pide swipe + undo para filas, no para árboles).
    Alert.alert(t('routine.deleteConfirm.title'), t('routine.deleteConfirm.body'), [
      { style: 'cancel', text: t('common.cancel') },
      {
        onPress: () => {
          deleteRoutine(routineId)
          router.back()
        },
        style: 'destructive',
        text: t('routine.deleteConfirm.action'),
      },
    ])
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
      >
        {nextDay ? (
          <View style={styles.start}>
            {/* Mismo apagado que la card de la tab: con una sesión abierta no se empieza otra. */}
            <Button
              disabled={busy}
              onPress={() => {
                void ensureNotificationPermission()
                const sessionId = startSessionFromDay(nextDay.id)
                router.push({ params: { id: sessionId }, pathname: '/session/[id]' })
              }}
              title={t('routine.start', { day: nextDay.name })}
            />
          </View>
        ) : null}

        {days.length > 0 ? (
          <Sortable
            data={days}
            keyExtractor={(item) => String(item.day.id)}
            onReorder={(keys) => reorderDays(routineId, keys.map(Number))}
            renderItem={(item, index) => {
              const exerciseCount = item.exercises.length
              const setCount = item.exercises.reduce((n, e) => n + e.sets.length, 0)
              const subtitle = [
                plural(
                  exerciseCount,
                  t('history.exercises.one', { n: exerciseCount }),
                  t('history.exercises.other', { n: exerciseCount }),
                ),
                plural(
                  setCount,
                  t('day.sets.one', { n: setCount }),
                  t('day.sets.other', { n: setCount }),
                ),
              ].join(' · ')
              const marks = [
                index === nextIndex ? t('routine.next') : null,
                item.day.isDeload ? t('day.deload') : null,
              ].filter((s) => s !== null)
              return (
                // Entra con FadeIn el día recién agregado; la lista no se anima al reordenar
                // (de eso se ocupa el sortable con sus propios springs).
                <Animated.View entering={FadeIn.duration(200)} style={styles.rowSlot}>
                  <View style={styles.rowCard}>
                    <View style={styles.hideSeparator}>
                      <ListRow
                        chevron
                        label={[item.day.name, ...marks, subtitle].join(', ')}
                        onPress={() =>
                          router.push({
                            params: { id: item.day.id },
                            pathname: '/routine-day/[id]',
                          })
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
            }}
            scrollableRef={scrollRef}
          />
        ) : null}

        <View style={styles.rowCard}>
          <View style={styles.hideSeparator}>
            <ListRow
              chevron
              onPress={() => {
                const dayId = addDay(routineId, t('routine.dayDefault', { n: days.length + 1 }))
                router.push({ params: { id: dayId }, pathname: '/routine-day/[id]' })
              }}
              title={t('routine.addDay')}
            />
          </View>
        </View>
      </Animated.ScrollView>
    </View>
  )
}
