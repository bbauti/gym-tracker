import { FlashList } from '@shopify/flash-list'
import { router, Stack } from 'expo-router'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import {
  type Exercise,
  exerciseName,
  searchExercises,
  updateExercise,
} from '@/db/queries/exercises'
import { EQUIPMENT, type Equipment, MUSCLES, type Muscle } from '@/db/schema'
import { useQuery } from '@/db/useQuery'
import { locale, t } from '@/i18n'
import Chip from '@/ui/Chip'
import EmptyState from '@/ui/EmptyState'
import { haptic } from '@/ui/haptics'
import PressableScale from '@/ui/PressableScale'
import Text from '@/ui/Text'
import { colors, MIN_TARGET, spacing } from '@/ui/tokens'

const styles = StyleSheet.create({
  list: { backgroundColor: colors.background },
  filters: { gap: spacing[2], paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  rowMain: {
    flex: 1,
    minHeight: MIN_TARGET,
    justifyContent: 'center',
    paddingVertical: spacing[2],
  },
  archived: { opacity: 0.5 },
  star: {
    width: MIN_TARGET,
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: { paddingHorizontal: spacing[2] },
  footer: { alignItems: 'center', padding: spacing[4] },
  empty: { paddingTop: spacing[6] },
})

// FlashList v2 ancla el scroll al contenido visible por defecto (pensado para chats): en una lista
// que se rearma entera en cada tecla eso pelea con el filtrado.
const KEEP_POSITION_OFF = { disabled: true }

const keyExtractor = (item: Exercise) => String(item.id)

const noResults = (
  <View style={styles.empty}>
    <EmptyState
      description={t('library.noResults.description')}
      md="search"
      sf="magnifyingglass"
      title={t('library.noResults.title')}
    />
  </View>
)

function HeaderAdd() {
  return (
    <PressableScale
      accessibilityLabel={t('library.new')}
      onPress={() => router.push('/exercise/new')}
      style={styles.header}
    >
      <SymbolView
        fallback={
          <Text color="tint" role="title">
            +
          </Text>
        }
        name={{ ios: 'plus' as SFSymbol, android: 'add' as AndroidSymbol }}
        size={20}
        tintColor={colors.tint}
      />
    </PressableScale>
  )
}

/** Dos pressables hermanos, no anidados: el de la fila se traga los taps del hijo y VoiceOver
 *  solo ve el contenedor. La estrella es su propio botón. */
function ExerciseRow({ item }: { item: Exercise }) {
  const name = exerciseName(item, locale)
  const meta = `${t(`muscle.${item.primaryMuscle}`)} · ${t(`equipment.${item.equipment}`)}`
  const fav = item.isFavorite
  return (
    <View style={[styles.row, item.isArchived && styles.archived]}>
      <PressableScale
        accessibilityLabel={`${name}, ${meta}`}
        onPress={() => router.push({ pathname: '/exercise/[id]', params: { id: item.id } })}
        scale={0.98}
        style={styles.rowMain}
      >
        <Text numberOfLines={1}>{name}</Text>
        <Text color="secondary" numberOfLines={1} role="footnote">
          {meta}
        </Text>
      </PressableScale>
      <PressableScale
        accessibilityLabel={fav ? t('exercise.unfavorite') : t('exercise.favorite')}
        accessibilityState={{ selected: fav }}
        onPress={() => {
          haptic('toggle')
          updateExercise(item.id, { isFavorite: !fav })
        }}
        style={styles.star}
      >
        <SymbolView
          fallback={
            <Text color={fav ? 'tint' : 'tertiary'} role="callout">
              {fav ? '★' : '☆'}
            </Text>
          }
          name={{
            ios: (fav ? 'star.fill' : 'star') as SFSymbol,
            android: 'star' as AndroidSymbol,
          }}
          size={18}
          tintColor={fav ? colors.tint : colors.tertiaryLabel}
        />
      </PressableScale>
    </View>
  )
}

const renderItem = ({ item }: { item: Exercise }) => <ExerciseRow item={item} />

export default function ExercisesScreen() {
  const [q, setQ] = useState('')
  const [muscle, setMuscle] = useState<Muscle>()
  const [equipment, setEquipment] = useState<Equipment>()
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)

  const items = useQuery(
    () => searchExercises(q, locale, { muscle, equipment, favoritesOnly, includeArchived }),
    ['exercise'],
    [q, muscle, equipment, favoritesOnly, includeArchived],
  )

  // ponytail: dos filas de chips en vez de un Menu de equipo. Techo: con el teclado abierto quedan
  // ~80 pt de filtros arriba de los resultados. Upgrade: colapsar la fila de equipo a un Menu.
  const filters = (
    <View>
      <ScrollView
        contentContainerStyle={styles.filters}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        <Chip
          label={t('library.filters.all')}
          onPress={() => {
            setMuscle(undefined)
            setEquipment(undefined)
            setFavoritesOnly(false)
          }}
          selected={!muscle && !equipment && !favoritesOnly}
        />
        <Chip
          label={t('library.filters.favorites')}
          md="star"
          onPress={() => setFavoritesOnly(!favoritesOnly)}
          selected={favoritesOnly}
          sf="star"
        />
        {MUSCLES.map((m) => (
          <Chip
            key={m}
            label={t(`muscle.${m}`)}
            onPress={() => setMuscle(muscle === m ? undefined : m)}
            selected={muscle === m}
          />
        ))}
      </ScrollView>
      <ScrollView
        contentContainerStyle={styles.filters}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {EQUIPMENT.map((e) => (
          <Chip
            key={e}
            label={t(`equipment.${e}`)}
            onPress={() => setEquipment(equipment === e ? undefined : e)}
            selected={equipment === e}
          />
        ))}
      </ScrollView>
    </View>
  )

  const footer = (
    <View style={styles.footer}>
      <Chip
        label={t('library.archived')}
        md="inventory_2"
        onPress={() => setIncludeArchived(!includeArchived)}
        selected={includeArchived}
        sf="archivebox"
      />
    </View>
  )

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => <HeaderAdd />,
          headerSearchBarOptions: {
            autoCapitalize: 'none',
            hideWhenScrolling: false,
            onChangeText: (e) => setQ(e.nativeEvent.text),
            placeholder: t('library.search'),
          },
        }}
      />
      {/* Sin layout animations a propósito: la lista se rearma en cada tecla (§7.5). */}
      <FlashList
        ListEmptyComponent={noResults}
        ListFooterComponent={footer}
        ListHeaderComponent={filters}
        contentInsetAdjustmentBehavior="automatic"
        data={items}
        keyExtractor={keyExtractor}
        keyboardDismissMode="on-drag"
        maintainVisibleContentPosition={KEEP_POSITION_OFF}
        renderItem={renderItem}
        style={styles.list}
      />
    </>
  )
}
