import { router, Stack } from 'expo-router'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import type { AccessibilityActionEvent } from 'react-native'
import { ScrollView, StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import {
  createGym,
  deleteGym,
  type Gym,
  listGyms,
  restoreGym,
  setActiveGym,
} from '@/db/queries/gyms'
import { getSettings } from '@/db/queries/settings'
import { useQuery } from '@/db/useQuery'
import { t } from '@/i18n'
import Badge from '@/ui/Badge'
import { haptic } from '@/ui/haptics'
import ListRow from '@/ui/ListRow'
import { RowLayout, useEnterFade } from '@/ui/motion'
import PressableScale from '@/ui/PressableScale'
import SwipeRow from '@/ui/SwipeRow'
import Text from '@/ui/Text'
import { toast } from '@/ui/Toast'
import { colors, MIN_TARGET, outline, Press, radius, shadow, spacing } from '@/ui/tokens'

const GYM_TABLES = ['gym', 'settings']

// El swipe cuelga su acción accesible del contenedor, y acá adentro hay dos celdas enfocables: sin
// esto el borrado no tiene camino con VoiceOver (mismo caso que las series de `routine-day/[id]`).
const DELETE_ACTION = [{ label: t('common.delete'), name: 'delete' }]

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.groupedBackground, flex: 1 },
  content: { padding: spacing[4] },
  // El hueco vive adentro de la fila para que se vaya con ella cuando se borra.
  rowSlot: { paddingBottom: spacing[2] },
  // Cada gimnasio es una card levantada (§12.5). El fondo va acá y no en el hijo: `shadow.card`
  // dibuja alrededor de esta caja y sin color de por medio se vería el gris a través. El radio
  // empata con el del recorte de SwipeRow: dos radios distintos se leen como un borde mal cortado.
  // El recorte y la sombra conviven: con `boxShadow` puesto, RN mete a los hijos en un contenedor
  // aparte y solo recorta ese (RCTViewComponentView, "overflow ink").
  card: {
    backgroundColor: colors.secondaryGroupedBackground,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  // El separador de la última fila cae fuera del recorte del grupo: ListRow lo dibuja siempre.
  hideSeparator: { marginBottom: -StyleSheet.hairlineWidth },
  row: { alignItems: 'center', flexDirection: 'row' },
  check: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    width: MIN_TARGET,
  },
  body: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing[3],
    minHeight: MIN_TARGET,
    paddingRight: spacing[4],
    paddingVertical: spacing[2],
  },
  grow: { flex: 1 },
  labels: { flex: 1 },
  head: { alignItems: 'center', flexDirection: 'row', gap: spacing[2] },
  // El nombre cede antes que el badge: "Activo" es una palabra y no se recorta.
  name: { flexShrink: 1 },
  empty: { paddingBottom: spacing[3], paddingHorizontal: spacing[2] },
})

function GymRow({ gym, active }: { gym: Gym; active: boolean }) {
  // Las barras dicen mejor qué gimnasio es que un conteo de discos.
  const bars = (gym.barsG ?? []).map((b) => b.name).join(', ')
  const remove = () => {
    haptic('delete')
    const snapshot = deleteGym(gym.id)
    toast.show({
      actionLabel: t('common.undo'),
      onAction: () => {
        haptic('undo')
        restoreGym(snapshot)
      },
      text: t('gyms.deleted'),
    })
  }

  return (
    <View style={[styles.card, shadow.card, outline]}>
      <SwipeRow onDelete={remove}>
        <View style={styles.row}>
          {/* Control aparte del cuerpo: anidarlo adentro del pressable que abre el editor lo
            escondería del lector (un Pressable es `accessible` y se traga a sus hijos). */}
          <PressableScale
            // La etiqueta no cambia con el estado: eso ya lo dice `checked`, y el hint es lo único
            // que cuenta que volver a tocarlo lo apaga (un radio marcado no se desmarca solo).
            accessibilityHint={t('gyms.setActiveHint')}
            accessibilityLabel={t('gyms.setActive')}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            accessibilityValue={{ text: gym.name }}
            onPress={() => {
              // Volver a tocar el activo lo apaga: sin gimnasio se usan las tablas por defecto.
              haptic('selection')
              setActiveGym(active ? null : gym.id)
            }}
            style={styles.check}
          >
            <SymbolView
              fallback={
                <Text color={active ? 'tint' : 'tertiary'} role="body">
                  {active ? '✓' : '○'}
                </Text>
              }
              name={{
                android: (active ? 'check_circle' : 'radio_button_unchecked') as AndroidSymbol,
                ios: (active ? 'checkmark.circle.fill' : 'circle') as SFSymbol,
              }}
              size={22}
              tintColor={active ? colors.tint : colors.tertiaryLabel}
            />
          </PressableScale>
          {/* PressableScale pone `style` en su vista interna: el flex tiene que vivir afuera. */}
          <View style={styles.grow}>
            <PressableScale
              accessibilityActions={DELETE_ACTION}
              // El badge vive adentro del pressable, que se traga a sus hijos: si no entra acá, el
              // lector no se entera de cuál está activo por este camino.
              accessibilityLabel={[gym.name, active ? t('gyms.active') : '', bars]
                .filter(Boolean)
                .join(', ')}
              onAccessibilityAction={(e: AccessibilityActionEvent) => {
                if (e.nativeEvent.actionName === 'delete') remove()
              }}
              onPress={() => router.push({ params: { id: gym.id }, pathname: '/gym/[id]' })}
              scale={Press.row}
              style={styles.body}
            >
              <View style={styles.labels}>
                <View style={styles.head}>
                  <Text numberOfLines={1} style={styles.name}>
                    {gym.name}
                  </Text>
                  {/* El badge se alinea solo con `flex-start`: adentro de una fila eso lo pega
                      arriba, así que el envoltorio es el que lo centra. */}
                  {active ? (
                    <View>
                      <Badge label={t('gyms.active')} tone="tint" />
                    </View>
                  ) : null}
                </View>
                {bars ? (
                  <Text color="secondary" numberOfLines={1} role="footnote">
                    {bars}
                  </Text>
                ) : null}
              </View>
              <SymbolView
                fallback={
                  <Text color="tertiary" role="body">
                    ›
                  </Text>
                }
                name={{
                  android: 'chevron_right' as AndroidSymbol,
                  ios: 'chevron.right' as SFSymbol,
                }}
                size={14}
                tintColor={colors.tertiaryLabel}
              />
            </PressableScale>
          </View>
        </View>
      </SwipeRow>
    </View>
  )
}

export default function GymsScreen() {
  const { gyms, activeId } = useQuery(
    () => ({ activeId: getSettings().activeGymId, gyms: listGyms() }),
    GYM_TABLES,
  )
  // Solo el gimnasio recién creado (o el que vuelve con Deshacer) entra con fade.
  const fadeIn = useEnterFade(gyms.map((g) => g.id))

  return (
    <>
      <Stack.Screen options={{ title: t('gyms.title') }} />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        style={styles.screen}
      >
        {gyms.length === 0 ? (
          <Text color="secondary" role="footnote" style={styles.empty}>
            {t('gyms.empty')}
          </Text>
        ) : null}
        {gyms.map((gym) => (
          <Animated.View
            entering={fadeIn(gym.id)}
            key={gym.id}
            layout={RowLayout}
            style={styles.rowSlot}
          >
            <GymRow active={gym.id === activeId} gym={gym} />
          </Animated.View>
        ))}
        <View style={[styles.card, shadow.card, outline]}>
          <View style={styles.hideSeparator}>
            <ListRow
              chevron
              // El nombre por defecto se edita en la pantalla que se abre: un gimnasio sin id no
              // tiene dónde guardar barras ni discos, así que se crea primero y se edita después.
              onPress={() =>
                router.push({ params: { id: createGym(t('gyms.new')) }, pathname: '/gym/[id]' })
              }
              title={t('gyms.new')}
            />
          </View>
        </View>
      </ScrollView>
    </>
  )
}
