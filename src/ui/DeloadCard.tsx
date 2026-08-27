import type { ComponentProps } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { locale, t } from '@/i18n'
import type { DeloadState } from '@/lib/progression'
import Badge from './Badge'
import Button from './Button'
import Card from './Card'
import { Exit, RowLayout, useEnterFade } from './motion'
import PressableScale from './PressableScale'
import Text from './Text'
import { MIN_TARGET, spacing } from './tokens'

type Props = {
  state: DeloadState
  onStart: () => void
  onDismiss: () => void
  onEnd: () => void
  /**
   * Lo decide el padre: al abrir la app la card ya estaba en pantalla y no aparece, así que no
   * anima. Solo entra con fade el consejo que llega con la tab abierta.
   */
  entering?: ComponentProps<typeof Animated.View>['entering']
}

// Sin año: la ventana es de siete días y "2 de septiembre" se lee de un vistazo, "2 sept 2026" no.
const dateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' })

const styles = StyleSheet.create({
  card: { gap: spacing[2] },
  actions: { alignItems: 'center', flexDirection: 'row', gap: spacing[2], paddingTop: spacing[1] },
  action: { flex: 1 },
  // Sin fondo propio: el color lo pone el Badge, que es la pastilla del sistema (§12.4).
  banner: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing[2],
    justifyContent: 'space-between',
  },
  bannerLabel: { flex: 1 },
  end: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TARGET,
    minWidth: MIN_TARGET,
  },
})

/**
 * E06. La tarjeta que propone bajar una semana y, mientras dura, el cartel que lo recuerda.
 *
 * Solo sugiere: los dos botones escriben en `settings` y nada más — las rutinas y el calendario no
 * se tocan (§2.2). El consejo ya se calla solo en `deloadAdvice` (se equivoca hacia el silencio),
 * así que acá aparecer es la excepción y por eso puede entrar con fade.
 */
export default function DeloadCard({ state, onStart, onDismiss, onEnd, entering }: Props) {
  const until = state.until
  // El cartel entra con fade solo si el deload empieza con la card en pantalla ("Empezar deload"):
  // si ya estaba activo al montar, el cartel es lo que había y aparecer de la nada sería mentira.
  const bannerFade = useEnterFade(state.active ? ['banner'] : [])
  return (
    // Un solo contenedor con layout por región (§7.2): al empezar el deload la tarjeta se encoge
    // hasta el cartel en vez de saltar.
    <Animated.View entering={entering} exiting={Exit.fade} layout={RowLayout}>
      {state.active ? (
        // La card se va sin `exiting` (no retiene el alto) y el cartel entra sobre el hueco que
        // RowLayout está cerrando: si no, sería lo único del cambio que no anima (§7.1).
        <Animated.View entering={bannerFade('banner')} style={styles.banner}>
          {/* El Badge se ajusta a su texto: envuelto, se lleva el alto de la fila sin estirarse. */}
          <View>
            <Badge label={t('deload.activeTitle')} size="md" tone="warning" />
          </View>
          {until === null ? null : (
            <Text color="secondary" numberOfLines={1} role="footnote" style={styles.bannerLabel}>
              {t('deload.until', { date: dateFormat.format(until) })}
            </Text>
          )}
          <PressableScale
            accessibilityLabel={`${t('deload.end')}, ${t('deload.activeTitle')}`}
            accessibilityRole="button"
            onPress={onEnd}
            style={styles.end}
          >
            <Text color="tint" role="headline">
              {t('deload.end')}
            </Text>
          </PressableScale>
        </Animated.View>
      ) : (
        <Card style={styles.card} variant="raised">
          {/* La pastilla dice de entrada que esto se puede ignorar: la card no manda, propone. */}
          <Badge label={t('deload.badge')} tone="warning" />
          <Text accessibilityRole="header" role="headline">
            {t('deload.title')}
          </Text>
          <Text color="secondary" role="footnote">
            {t(state.reason === 'stall' ? 'deload.reasonStall' : 'deload.reasonRpe')}
          </Text>
          <View style={styles.actions}>
            {/* `tinted` y no `hero`: la card es un consejo y el degradado ya lo tiene el CTA del
                pie (§12.3, uno solo a la vista). Además deja sonar el Success de la pantalla. */}
            <View style={styles.action}>
              <Button onPress={onStart} title={t('deload.start')} variant="tinted" />
            </View>
            {/* "Ahora no" solo no dice a qué: el título está arriba, pero el lector puede caer
                directo en el botón (rotor de controles) y ahí no hay contexto. */}
            <Button
              accessibilityLabel={`${t('deload.dismiss')}, ${t('deload.title')}`}
              onPress={onDismiss}
              title={t('deload.dismiss')}
              variant="plain"
            />
          </View>
        </Card>
      )}
    </Animated.View>
  )
}
