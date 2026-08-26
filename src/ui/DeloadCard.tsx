import type { ComponentProps } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { FadeOut } from 'react-native-reanimated'
import { locale, t } from '@/i18n'
import type { DeloadState } from '@/lib/progression'
import Button from './Button'
import Card from './Card'
import { RowLayout, Timing, useEnterFade } from './motion'
import PressableScale from './PressableScale'
import Text from './Text'
import { colors, MIN_TARGET, radius, spacing } from './tokens'

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
  actions: { flexDirection: 'row', gap: spacing[2], paddingTop: spacing[1] },
  action: { flex: 1 },
  banner: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing[2],
    overflow: 'hidden',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  // `colors.tint` es un PlatformColor: no se le puede poner alpha, así que el lavado va aparte
  // (mismo truco que la variante `tinted` de ui/Button).
  wash: { opacity: 0.12 },
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
    <Animated.View
      entering={entering}
      exiting={FadeOut.duration(Timing.fast.duration).easing(Timing.fast.easing)}
      layout={RowLayout}
    >
      {state.active ? (
        // La card se va sin `exiting` (no retiene el alto) y el cartel entra sobre el hueco que
        // RowLayout está cerrando: si no, sería lo único del cambio que no anima (§7.1).
        <Animated.View entering={bannerFade('banner')} style={styles.banner}>
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.wash, { backgroundColor: colors.tint }]}
          />
          <Text color="tint" role="footnote" style={styles.bannerLabel}>
            {until === null
              ? t('deload.activeTitle')
              : `${t('deload.activeTitle')} · ${t('deload.until', {
                  date: dateFormat.format(until),
                })}`}
          </Text>
          <PressableScale
            accessibilityLabel={`${t('deload.end')}, ${t('deload.activeTitle')}`}
            onPress={onEnd}
            style={styles.end}
          >
            <Text color="tint" role="headline">
              {t('deload.end')}
            </Text>
          </PressableScale>
        </Animated.View>
      ) : (
        <Card style={styles.card}>
          <Text accessibilityRole="header" role="headline">
            {t('deload.title')}
          </Text>
          <Text color="secondary" role="footnote">
            {t(state.reason === 'stall' ? 'deload.reasonStall' : 'deload.reasonRpe')}
          </Text>
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button onPress={onStart} title={t('deload.start')} variant="tinted" />
            </View>
            <View style={styles.action}>
              {/* "Ahora no" solo no dice a qué: el título está arriba, pero el lector puede caer
                  directo en el botón (rotor de controles) y ahí no hay contexto. */}
              <Button
                accessibilityLabel={`${t('deload.dismiss')}, ${t('deload.title')}`}
                onPress={onDismiss}
                title={t('deload.dismiss')}
                variant="plain"
              />
            </View>
          </View>
        </Card>
      )}
    </Animated.View>
  )
}
