import { type MenuAction, MenuView } from '@expo/ui/community/menu'
import type { ReactNode } from 'react'
import { ActionSheetIOS, Alert, Platform } from 'react-native'
import { t } from '@/i18n'
import { haptic } from './haptics'

export type MenuItem = {
  key: string
  label: string
  destructive?: boolean
  sf?: string
  /** Material Symbol equivalente. Ver el comentario de `toAction`: hoy no se dibuja. */
  md?: string
  /**
   * Sin tic: o el háptico lo dispara quien maneja la acción, o el ítem es un verbo que abre otra
   * pantalla y ahí no va ninguno (§7.4: nunca en navegación).
   */
  skipTick?: boolean
}

type Props = { items: MenuItem[]; onSelect: (key: string) => void; children: ReactNode }

// ponytail: `md` viaja en las props por simetría con Button/ListRow pero no se usa. @expo/ui solo
// dibuja el ícono de una acción en Android si le pasás un ImageSourcePropType (un require de un
// vector .xml), y el proyecto no tiene assets. Techo: en Android el menú va sin íconos.
// Upgrade: assets/menu/*.xml + un map de nombre -> require.
/**
 * El tic de "elegí una opción" (§12.6). En una acción destructiva (o marcada `skipTick`) NO va: el
 * gate global de 50 ms es uno solo para todos los eventos, así que el tic se comería el háptico que
 * dispara el handler en el mismo tick.
 */
const pick = (item: MenuItem | undefined): void => {
  if (item && !item.destructive && !item.skipTick) haptic('pickerChange')
}

const toAction = (i: MenuItem): MenuAction => ({
  id: i.key,
  title: i.label,
  image: i.sf as MenuAction['image'],
  attributes: i.destructive ? { destructive: true } : undefined,
})

/**
 * Menú nativo anclado al trigger: SwiftUI `Menu` en iOS, `DropdownMenu` de Compose en Android.
 * `children` es el trigger; el tap lo abre el nativo (no hay onPress que interceptar).
 */
export default function Menu({ items, onSelect, children }: Props) {
  return (
    <MenuView
      actions={items.map(toAction)}
      onPressAction={(e) => {
        // El menú nativo ya se cerró: el tic acompaña al cambio, no a la apertura.
        const key = e.nativeEvent.event
        pick(items.find((i) => i.key === key))
        onSelect(key)
      }}
    >
      {children}
    </MenuView>
  )
}

/**
 * Para triggers que no conviene envolver: `MenuView` monta una vista nativa (un host de SwiftUI) por
 * instancia, y una por fila en una lista de 20 series sale cara. `MenuView.show()` no sirve como
 * escape: en iOS es un no-op documentado.
 */
export function showMenu(o: {
  title?: string
  items: MenuItem[]
  onSelect: (key: string) => void
}): void {
  if (Platform.OS === 'ios') {
    const options = [...o.items.map((i) => i.label), t('common.cancel')]
    const destructive = o.items.findIndex((i) => i.destructive)
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex: options.length - 1,
        destructiveButtonIndex: destructive < 0 ? undefined : destructive,
        options,
        title: o.title,
      },
      (index) => {
        const item = o.items[index]
        if (!item) return
        pick(item)
        o.onSelect(item.key)
      },
    )
    return
  }
  // ponytail: el Alert de Android tiene tres slots (positive/negative/neutral) y RN descarta el
  // resto, así que un menú largo se corta a las dos primeras acciones (por eso quien llama pone
  // primero las que valen). Techo: en Android no llegás a los tipos de serie menos usados.
  // Upgrade: una ruta formSheet 'set-options' — las rutas las registra app/_layout.tsx (otro slice).
  Alert.alert(o.title ?? '', undefined, [
    ...o.items.slice(0, 2).map((i) => ({
      onPress: () => {
        pick(i)
        o.onSelect(i.key)
      },
      style: i.destructive ? ('destructive' as const) : undefined,
      text: i.label,
    })),
    { style: 'cancel' as const, text: t('common.cancel') },
  ])
}
