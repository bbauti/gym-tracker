import { router, useLocalSearchParams } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'
import { listFolders } from '@/db/queries/folders'
import { moveRoutineToFolder } from '@/db/queries/routines'
import { useQuery } from '@/db/useQuery'
import { t } from '@/i18n'
import { useSheetBottomInset } from '@/ui/keyboard'
import ListRow from '@/ui/ListRow'
import PressableScale from '@/ui/PressableScale'
import Text from '@/ui/Text'
import { colors, radius, spacing } from '@/ui/tokens'

const FOLDER_TABLES = ['folder']

const styles = StyleSheet.create({
  // Sin flex: 1 — `fitToContents` mide el contenido y un hijo elástico mediría cero (hoja de 0 pt).
  sheet: { backgroundColor: colors.background, gap: spacing[2], padding: spacing[4] },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing[2],
  },
  cancel: { paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  card: { borderRadius: radius.md, overflow: 'hidden' },
  // El separador de la última fila cae fuera del recorte del grupo: ListRow lo dibuja siempre.
  hideSeparator: { marginBottom: -StyleSheet.hairlineWidth },
})

/**
 * D02. La lista entera de carpetas en una hoja, y no en el menú imperativo: en Android `showMenu` es
 * un Alert de dos slots (ui/Menu.tsx), así que con dos carpetas la segunda no existía y la salida a
 * "Nueva carpeta" tampoco. Acá las dos plataformas ven lo mismo.
 */
export default function RoutineMoveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const routineId = Number(id)
  const bottom = useSheetBottomInset()
  const folders = useQuery(listFolders, FOLDER_TABLES)

  const move = (folderId: number | null) => {
    moveRoutineToFolder(routineId, folderId)
    router.back()
  }

  return (
    <View style={[styles.sheet, { paddingBottom: bottom + spacing[4] }]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" role="headline">
          {t('routine.moveToFolder')}
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
      {/* Con muchas carpetas la hoja topa contra la pantalla: el scroll es lo que evita repetir el
          recorte que trajo esta pantalla al mundo. */}
      <ScrollView>
        <View style={styles.card}>
          <ListRow onPress={() => move(null)} title={t('folders.none')} />
          {folders.map((folder) => (
            <ListRow key={folder.id} onPress={() => move(folder.id)} title={folder.name} />
          ))}
          <View style={styles.hideSeparator}>
            {/* replace: la hoja se va, y volver de Carpetas cae en la rutina y no en un picker
                viejo. La carpeta nueva se elige entrando otra vez al menú. */}
            <ListRow chevron onPress={() => router.replace('/folders')} title={t('folders.new')} />
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
