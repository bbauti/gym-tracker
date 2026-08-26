import { Stack } from 'expo-router'
import { useState } from 'react'
import { FlatList, StyleSheet } from 'react-native'
import { type Exercise, exerciseName, searchExercises } from '@/db/queries/exercises'
import { useQuery } from '@/db/useQuery'
import { locale, t } from '@/i18n'
import EmptyState from '@/ui/EmptyState'
import ListRow from '@/ui/ListRow'
import { colors } from '@/ui/tokens'

const styles = StyleSheet.create({
  list: { backgroundColor: colors.groupedBackground },
  content: { flexGrow: 1 },
})

const keyExtractor = (item: Exercise) => String(item.id)

const renderItem = ({ item }: { item: Exercise }) => (
  <ListRow
    subtitle={`${t(`muscle.${item.primaryMuscle}`)} · ${t(`equipment.${item.equipment}`)}`}
    title={exerciseName(item, locale)}
  />
)

const noResults = (
  <EmptyState
    description={t('library.noResults.description')}
    md="search"
    sf="magnifyingglass"
    title={t('library.noResults.title')}
  />
)

export default function ExercisesScreen() {
  const [q, setQ] = useState('')
  const items = useQuery(() => searchExercises(q, locale), ['exercise'], [q])

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            autoCapitalize: 'none',
            hideWhenScrolling: false,
            onChangeText: (e) => setQ(e.nativeEvent.text),
            placeholder: t('library.search'),
          },
        }}
      />
      {/* Sin layout animations a propósito: la lista se rearma en cada tecla (§7.5). */}
      <FlatList
        ListEmptyComponent={noResults}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        data={items}
        keyExtractor={keyExtractor}
        keyboardDismissMode="on-drag"
        renderItem={renderItem}
        style={styles.list}
      />
    </>
  )
}
