import type { ReactNode } from 'react'
import Sortables, { type SortableGridProps } from 'react-native-sortables'
import { haptic } from './haptics'

type Props<T> = {
  data: T[]
  keyExtractor: (item: T) => string
  renderItem: (item: T, index: number) => ReactNode
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
 * ponytail: reordenar es SOLO arrastrando. Techo: con VoiceOver/TalkBack o un teclado no hay forma
 * de mover un ítem — el lector se traga el gesto y la librería no expone acciones. Camino de
 * upgrade (auditoría de accesibilidad, fase 7): `accessibilityActions` moveUp/moveDown por ítem en
 * el wrapper de `renderItem`, y su `onAccessibilityAction` arma el nuevo orden de `data` con
 * `keyExtractor` y llama al mismo `onReorder`. Sin cambio de comportamiento para el que arrastra.
 */
export default function Sortable<T>({
  data,
  keyExtractor,
  renderItem,
  onReorder,
  enabled = true,
  scrollableRef,
}: Props<T>) {
  return (
    <Sortables.Grid
      activeItemScale={1.03}
      activeItemShadowOpacity={0.2}
      columns={1}
      data={data}
      dragActivationDelay={250}
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
      renderItem={({ index, item }) => renderItem(item, index)}
      scrollableRef={scrollableRef}
      sortEnabled={enabled}
    />
  )
}
