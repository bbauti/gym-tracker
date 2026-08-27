import type { ReactNode } from 'react'
import type { AccessibilityActionEvent, AccessibilityActionInfo } from 'react-native'
import Sortables, { type SortableGridProps } from 'react-native-sortables'
import { t } from '@/i18n'
import { haptic } from './haptics'

/** Lo que cada ítem cuelga del elemento que ya marca `accessible` para poder reordenar sin gesto. */
export type ReorderActions = {
  accessibilityActions: AccessibilityActionInfo[]
  onAccessibilityAction: (event: AccessibilityActionEvent) => void
}

type Props<T> = {
  data: T[]
  keyExtractor: (item: T) => string
  renderItem: (item: T, index: number, a11y: ReorderActions) => ReactNode
  onReorder: (orderedKeys: string[]) => void
  enabled?: boolean
  /** Extra al contrato: sin esto no hay auto-scroll al arrastrar contra el borde (§7.3). */
  scrollableRef?: SortableGridProps<T>['scrollableRef']
}

/**
 * Lista vertical reordenable (§7.3): long-press 250 ms para levantar, hápticos propios.
 *
 * El separador entre ítems va ADENTRO de `renderItem` (padding en el wrapper de la card), no como
 * gap del contenedor: el ítem levantado se mide con su propio alto y el hueco tiene que viajar con él.
 *
 * Con lector de pantalla el gesto de arrastre no existe, así que cada ítem recibe acciones
 * moveUp/moveDown que arman el orden nuevo y llaman al mismo `onReorder`. Las acciones se pasan a
 * `renderItem` en vez de colgarse de un wrapper: las dos plataformas solo ofrecen las acciones del
 * elemento ENFOCADO, y el foco cae en lo que la card marca `accessible`, nunca en un ancestro.
 */
export default function Sortable<T>({
  data,
  keyExtractor,
  renderItem,
  onReorder,
  enabled = true,
  scrollableRef,
}: Props<T>) {
  const move = (from: number, to: number) => {
    const keys = data.map(keyExtractor)
    const [key] = keys.splice(from, 1)
    keys.splice(to, 0, key)
    haptic('selection')
    onReorder(keys)
  }
  // Fuera de `renderItem`: un objeto nuevo por render le cambiaría las props a todas las cards y
  // ninguna reusaría su árbol cacheado (de eso vive la sesión mientras se tipea, ver session/[id]).
  const actions: ReorderActions[] = data.map((_, index) => ({
    accessibilityActions: [
      // En los extremos la acción imposible ni se ofrece.
      ...(index > 0 ? [{ label: t('a11y.moveUp'), name: 'moveUp' }] : []),
      ...(index < data.length - 1 ? [{ label: t('a11y.moveDown'), name: 'moveDown' }] : []),
    ],
    onAccessibilityAction: ({ nativeEvent }) => {
      if (nativeEvent.actionName === 'moveUp') move(index, index - 1)
      else if (nativeEvent.actionName === 'moveDown') move(index, index + 1)
    },
  }))
  return (
    <Sortables.Grid
      activeItemScale={1.03}
      // `shadow.lifted` no entra tal cual: la librería dibuja la sombra en la CELDA (que incluye el
      // hueco entre cards) con geometría fija de halo 0/0/5 y solo expone el alfa, así que sube para
      // pesar como los 12/28 px del token. En Android no dibuja ninguna (`useItemDecoration` corta
      // con `!IS_ANDROID`) y el levantado queda todo en la escala.
      activeItemShadowOpacity={0.3}
      columns={1}
      data={data}
      dragActivationDelay={250}
      // El default (300) empata con el levantado: §7.2 pide la salida en 0.5-0.7x de la entrada, y
      // acá el dedo ya se fue de la pantalla.
      dropAnimationDuration={180}
      // El offset de agarre se respeta: con snap el ítem se teleporta a centrarse bajo el dedo.
      enableActiveItemSnap={false}
      // Los hápticos son los nuestros (§7.4), vía callbacks; los de la librería quedan apagados.
      hapticsEnabled={false}
      inactiveItemOpacity={1}
      // Los defaults entran desde scale 0.5 y salen con la misma duración (§7.5 = reject): el
      // enter/exit de la card lo maneja quien la renderiza.
      itemEntering={null}
      itemExiting={null}
      keyExtractor={keyExtractor}
      onDragEnd={({ fromIndex, indexToKey, toIndex }) => {
        haptic('dragDrop')
        if (fromIndex !== toIndex) onReorder(indexToKey)
      }}
      onDragStart={() => haptic('dragStart')}
      onOrderChange={() => haptic('dragSlot')}
      renderItem={({ index, item }) => renderItem(item, index, actions[index])}
      scrollableRef={scrollableRef}
      sortEnabled={enabled}
    />
  )
}
