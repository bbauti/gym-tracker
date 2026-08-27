import { Stack } from 'expo-router'
import { useState } from 'react'
import type { AccessibilityActionEvent } from 'react-native'
import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedRef } from 'react-native-reanimated'
import {
  createFolder,
  deleteFolder,
  type Folder,
  folderRoutineCounts,
  listFolders,
  renameFolder,
  reorderFolders,
  restoreFolder,
} from '@/db/queries/folders'
import { useQuery } from '@/db/useQuery'
import { plural, t } from '@/i18n'
import { haptic } from '@/ui/haptics'
import Input from '@/ui/Input'
import ListRow from '@/ui/ListRow'
import { useEnterFade } from '@/ui/motion'
import Sortable, { type ReorderActions } from '@/ui/Sortable'
import SwipeRow from '@/ui/SwipeRow'
import Text from '@/ui/Text'
import { toast } from '@/ui/Toast'
import { colors, radius, spacing } from '@/ui/tokens'

// `routine` también: mover una rutina a una carpeta desde el menú de la rutina cambia el conteo, y
// borrar una carpeta suelta las que tenía adentro.
const FOLDER_TABLES = ['folder', 'routine']

// El swipe cuelga su acción accesible del contenedor y solo llega cuando el hijo es UN elemento
// (ui/SwipeRow.tsx): acá el que enfoca el lector es el campo de texto, así que la acción va ahí.
const DELETE_ACTION = { label: t('common.delete'), name: 'delete' }

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.groupedBackground, flex: 1 },
  content: { padding: spacing[4] },
  // El hueco entre filas vive adentro del ítem: el que levantás se lleva su hueco (ui/Sortable.tsx).
  rowSlot: { paddingBottom: spacing[2] },
  // Mismo radio que el recorte de SwipeRow: la fila de "nueva" cierra la lista sin cambiar de forma.
  rowCard: { borderRadius: radius.sm, overflow: 'hidden' },
  // El separador de la última fila cae fuera del recorte del grupo: ListRow lo dibuja siempre.
  hideSeparator: { marginBottom: -StyleSheet.hairlineWidth },
  // El campo tiene fondo propio (ui/Input): el hueco lo pone la fila, no el padding del texto.
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing[2], padding: spacing[2] },
  name: { flex: 1 },
})

/**
 * Una carpeta se edita en su propia fila: sin pantalla de detalle y sin botón de guardar, el nombre
 * se escribe acá y se confirma al salir del campo. `useState` y no la fila de la base — un refresh a
 * mitad de una palabra pisaría lo que se está escribiendo.
 */
function FolderRow({
  folder,
  count,
  autoFocus,
  a11y,
}: {
  folder: Folder
  count: number
  autoFocus: boolean
  a11y: ReorderActions
}) {
  const [name, setName] = useState(folder.name)
  // `selectTextOnFocus` no es de montaje: RN lo aplica en CADA foco. Solo el primero (el de recién
  // creada) selecciona todo; después tocar el nombre para corregir una letra no lo borra.
  const [selectAll, setSelectAll] = useState(autoFocus)

  function commit() {
    const trimmed = name.trim()
    // Un nombre vacío no borra el que había: el campo vuelve al guardado.
    if (!trimmed) setName(folder.name)
    else if (trimmed !== folder.name) renameFolder(folder.id, trimmed)
  }

  function remove() {
    haptic('delete')
    const snapshot = deleteFolder(folder.id)
    toast.show({
      actionLabel: t('common.undo'),
      onAction: () => {
        haptic('undo')
        restoreFolder(snapshot)
      },
      text: t('folders.deleted'),
    })
  }

  const subtitle =
    count === 0
      ? t('folders.empty')
      : plural(
          count,
          t('folders.routines.one', { n: count }),
          t('folders.routines.other', { n: count }),
        )

  return (
    <SwipeRow onDelete={remove}>
      <View style={styles.row}>
        <Input
          accessibilityActions={[...a11y.accessibilityActions, DELETE_ACTION]}
          // El valor del campo es el nombre: la etiqueta dice qué es, no lo repite.
          accessibilityLabel={t('folders.name')}
          autoFocus={autoFocus}
          onAccessibilityAction={(e: AccessibilityActionEvent) => {
            if (e.nativeEvent.actionName === 'delete') remove()
            else a11y.onAccessibilityAction(e)
          }}
          onBlur={commit}
          onFocus={() => setSelectAll(false)}
          onSubmitEditing={commit}
          onChangeText={setName}
          placeholder={t('folders.placeholder')}
          returnKeyType="done"
          // Recién creada entra con el nombre por defecto seleccionado: escribir lo reemplaza.
          selectTextOnFocus={selectAll}
          style={styles.name}
          value={name}
        />
        <Text color="secondary" role="footnote">
          {subtitle}
        </Text>
      </View>
    </SwipeRow>
  )
}

/** D02. Las carpetas agrupan rutinas en la tab de entrenar; el orden de acá es el de esa lista. */
export default function FoldersScreen() {
  const { folders, counts } = useQuery(
    () => ({ counts: folderRoutineCounts(), folders: listFolders() }),
    FOLDER_TABLES,
  )
  // El sortable necesita el ref del scroll para auto-scrollear al arrastrar contra un borde.
  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  // La carpeta recién creada es la única que entra enfocada; las que ya estaban, no.
  const [newId, setNewId] = useState<number | null>(null)
  const fadeIn = useEnterFade(folders.map((f) => f.id))

  return (
    <>
      <Stack.Screen options={{ title: t('folders.title') }} />
      <Animated.ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        // Con el teclado abierto, tocar el nombre de otra carpeta lo edita en un solo toque.
        keyboardShouldPersistTaps="handled"
        ref={scrollRef}
        // El auto-scroll del sortable lee el offset con `useScrollViewOffset`, y sin esto RN manda
        // el evento una sola vez por gesto.
        scrollEventThrottle={16}
        style={styles.screen}
      >
        {folders.length > 0 ? (
          <Sortable
            data={folders}
            keyExtractor={(item) => String(item.id)}
            onReorder={(keys) => reorderFolders(keys.map(Number))}
            renderItem={(item, _index, a11y) => (
              <Animated.View entering={fadeIn(item.id)} style={styles.rowSlot}>
                <FolderRow
                  a11y={a11y}
                  autoFocus={item.id === newId}
                  count={counts.get(item.id) ?? 0}
                  folder={item}
                />
              </Animated.View>
            )}
            scrollableRef={scrollRef}
          />
        ) : null}
        <View style={styles.rowCard}>
          <View style={styles.hideSeparator}>
            {/* Sin chevron: no abre nada. La carpeta se crea con el nombre por defecto y la fila
                aparece enfocada, así que renombrarla es seguir escribiendo. */}
            <ListRow
              onPress={() => setNewId(createFolder(t('folders.new')))}
              title={t('folders.new')}
            />
          </View>
        </View>
      </Animated.ScrollView>
    </>
  )
}
