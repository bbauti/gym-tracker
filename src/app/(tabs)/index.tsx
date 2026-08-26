import { router, useIsFocused } from 'expo-router'
import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { createSession, getActiveSessionId, getSessionTree } from '@/db/queries/session'
import { useQuery } from '@/db/useQuery'
import { t } from '@/i18n'
import { elapsedMs } from '@/lib/rest'
import { formatDuration } from '@/lib/units'
import { ensureNotificationPermission } from '@/notifications'
import Button from '@/ui/Button'
import Card from '@/ui/Card'
import EmptyState from '@/ui/EmptyState'
import PressableScale from '@/ui/PressableScale'
import { useNow } from '@/ui/RestTimer'
import Text from '@/ui/Text'
import { colors, MIN_TARGET, spacing } from '@/ui/tokens'

const SESSION_TABLES = ['session']

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  // La tab no tiene header propio: la fila del engranaje hace de barra y come el inset de arriba.
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing[2] },
  gear: {
    alignItems: 'center',
    minHeight: MIN_TARGET,
    justifyContent: 'center',
    width: MIN_TARGET,
  },
  body: { flex: 1, justifyContent: 'center', padding: spacing[4] },
  card: { gap: spacing[1] },
  footer: { padding: spacing[4] },
})

/**
 * Empezar o continuar es el momento tranquilo para pedir el permiso: en Android el diálogo del
 * sistema es otra Activity y manda la app a background. Pedirlo desde el primer descanso lo hacía
 * justo mientras la fila animaba el tilde, y una animación de Reanimated que arranca con la app
 * atrás no progresa: la serie quedaba completada en la base pero sin pintar. Acá no hay ninguna
 * animación en vuelo. Es idempotente (se cachea la respuesta) y nunca tira: si dicen que no, todo
 * lo de notificaciones sigue siendo un no-op silencioso.
 */
function askNotifications() {
  void ensureNotificationPermission()
}

function activeSession() {
  const id = getActiveSessionId()
  return id === null ? null : (getSessionTree(id)?.session ?? null)
}

export default function TrainScreen() {
  const insets = useSafeAreaInsets()
  const current = useQuery(activeSession, SESSION_TABLES)
  // Mismo cronómetro que la pantalla de sesión: derivado del reloj, 1 Hz. No tica en pausa, sin
  // sesión, ni con la tab atrás (las tabs nativas dejan las pantallas montadas).
  const focused = useIsFocused()
  const now = useNow(
    current ? current.startedAt + current.pausedMs : 0,
    focused && current !== null && current.pausedAt === null,
  )
  const elapsed = current
    ? formatDuration(elapsedMs(current.startedAt, current.pausedMs, current.pausedAt, now))
    : ''

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <PressableScale
          accessibilityLabel={t('settings.title')}
          onPress={() => router.push('/settings')}
          style={styles.gear}
        >
          <SymbolView
            fallback={<Text role="title">⚙</Text>}
            name={{ ios: 'gearshape' as SFSymbol, android: 'settings' as AndroidSymbol }}
            size={24}
            tintColor={colors.label}
          />
        </PressableScale>
      </View>

      {current ? (
        <View style={styles.body}>
          <PressableScale
            // La card es un solo elemento para el lector: el cronómetro va en su label o no se lee.
            accessibilityLabel={[
              t('session.continue'),
              current.name ?? t('session.untitled'),
              t('session.elapsed', { time: elapsed }),
              current.pausedAt === null ? null : t('session.paused'),
            ]
              .filter(Boolean)
              .join(', ')}
            onPress={() => {
              askNotifications()
              router.push({ params: { id: current.id }, pathname: '/session/[id]' })
            }}
            scale={0.98}
          >
            <Card style={styles.card}>
              <Text role="headline">{current.name ?? t('session.untitled')}</Text>
              <Text color="secondary" role="footnote" tabular>
                {current.pausedAt === null ? elapsed : `${elapsed} · ${t('session.paused')}`}
              </Text>
              <Text color="tint" role="callout">
                {t('session.continue')}
              </Text>
            </Card>
          </PressableScale>
        </View>
      ) : (
        <>
          <EmptyState
            description={t('train.empty.description')}
            md="fitness_center"
            sf="figure.strengthtraining.traditional"
            title={t('train.empty.title')}
          />
          <View style={styles.footer}>
            <Button
              onPress={() => {
                askNotifications()
                const id = createSession()
                router.push({ params: { id }, pathname: '/session/[id]' })
              }}
              title={t('session.start')}
            />
          </View>
        </>
      )}
    </View>
  )
}
